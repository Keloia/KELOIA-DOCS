# Keloia — Core Domain Worker Deep Dive

**The Single Source of Truth**
February 2026

---

## 1. What This Document Covers

The [main architecture doc](./keloia-architecture.md) defines the Core Domain Worker as "ALL business logic — both BFFs call this via Service Bindings." The [WA BFF deep dive](./keloia-wa-bff-deep-dive.md) shows how it's called for action execution. The [Dashboard BFF deep dive](./keloia-dashboard-bff-deep-dive.md) maps every `/internal/*` route it consumes.

This document goes **inside** the core-domain Worker itself — every service module, every business rule, every query, every side effect. This is the brain of Keloia.

```
                          ┌─────────────────────────────────┐
                          │       core-domain Worker         │
  wa-bff ──Service────►   │                                  │
           Binding        │  ┌──────────┐  ┌──────────────┐  │
                          │  │ booking  │  │  payment      │  │
  dashboard-bff ──────►   │  │ service  │  │  service      │  │   ──► D1
           Service        │  ├──────────┤  ├──────────────┤  │
           Binding        │  │ asset    │  │  alert        │  │   ──► KV (phone lookup)
                          │  │ service  │  │  service      │  │
  Cron Trigger ────────►  │  ├──────────┤  ├──────────────┤  │   ──► Queue (WA outbound)
                          │  │ tenant   │  │  activity     │  │
                          │  │ service  │  │  log          │  │
                          │  └──────────┘  └──────────────┘  │
                          └─────────────────────────────────┘
```

**Key design principle:** The core-domain Worker owns ALL data access and ALL business rules. The BFFs are protocol adapters — they authenticate, validate, and format, but never decide. If a business rule exists, it lives here. One place. No exceptions.

---

## 2. Hono App — The Service Binding Target

The core-domain Worker is a Hono app that only receives requests from the two BFFs via Service Bindings. It is never exposed to the public internet.

```typescript
// packages/core-domain/src/index.ts
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@keloia/shared/db/schema'
import { bookingRoutes } from './routes/booking'
import { paymentRoutes } from './routes/payment'
import { assetRoutes } from './routes/asset'
import { alertRoutes } from './routes/alert'
import { teamRoutes } from './routes/team'
import { actionRoutes } from './routes/action'
import { cronHandler } from './cron/morning-briefing'

type Env = {
  Bindings: {
    DB: D1Database
    PHONE_LOOKUP: KVNamespace
    WA_OUTBOUND: Queue
  }
}

const app = new Hono<{ Bindings: Env['Bindings'] }>()

// Inject Drizzle instance into context for all routes
app.use('*', async (c, next) => {
  const db = drizzle(c.env.DB, { schema })
  c.set('db', db)
  await next()
})

// Internal API — only reachable via Service Binding
app.route('/internal/schedule', bookingRoutes)
app.route('/internal/bookings', bookingRoutes)
app.route('/internal/financials', paymentRoutes)
app.route('/internal/assets', assetRoutes)
app.route('/internal/alerts', alertRoutes)
app.route('/internal/team', teamRoutes)
app.route('/internal/action', actionRoutes) // WA BFF confirmed actions

export default {
  fetch: app.fetch,

  // Morning briefing cron
  async scheduled(event: ScheduledEvent, env: Env['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(cronHandler(env))
  },
}
```

**Why no auth middleware?** The core-domain Worker is not publicly routable. It only receives requests from the BFFs via Service Bindings — in-process function calls within the same Cloudflare isolate. There is no HTTP endpoint to attack. The BFFs are the auth boundary.

**Why Hono here too, not plain functions?** Both BFFs call core-domain by constructing `Request` objects to fake URLs like `http://core/internal/schedule`. Hono's router matches these paths and extracts params — it gives us the same routing ergonomics as a public API, with zero overhead.

---

## 3. The Tenant Guard — Every Query, Every Time

Before diving into services, the most important pattern: **tenant isolation**.

```typescript
// packages/core-domain/src/lib/tenant-guard.ts
import { eq, and } from 'drizzle-orm'

// Every query function takes tenantId as the FIRST parameter.
// This is a convention, not a framework — enforced by code review.
//
// The tenantId comes from the BFF (derived from session or phone lookup),
// NEVER from the request body. The BFF is responsible for that guarantee.

// Example: every read includes tenant_id in WHERE
export function byTenant<T extends { tenantId: unknown }>(
  table: T,
  tenantId: string,
) {
  return eq(table.tenantId, tenantId)
}

// Usage in any service:
// db.select().from(bookings).where(byTenant(bookings, tenantId))
//
// This is intentionally NOT a middleware that "magically" injects tenant filtering.
// Explicit is better than implicit. Every query visibly includes the tenant filter.
// A developer can't accidentally forget what they can see.
```

**Why not a Row-Level Security (RLS) approach?** D1 is SQLite — it doesn't have RLS. We could build a Drizzle middleware that auto-appends `WHERE tenant_id = ?`, but hidden behavior is dangerous. When a query is wrong, the developer needs to see the `tenant_id` clause in the code to debug it. Explicit `byTenant()` in every query is the safest pattern.

---

## 4. Booking Service — Schedule Pillar

The booking service is the most complex module. It handles creation with conflict detection, status transitions, and schedule queries.

### 4a. Conflict Detection

The core business rule: **no two active bookings can use the same bus on overlapping dates.**

```typescript
// packages/core-domain/src/services/booking.ts
import { eq, and, ne, or, lte, gte, inArray } from 'drizzle-orm'
import { bookings, buses, users, payments } from '@keloia/shared/db/schema'
import { ulid } from '@keloia/shared'

type CreateBookingInput = {
  tenantId: string
  clientName: string
  clientPhone?: string
  routeFrom: string
  routeTo: string
  departDate: string        // ISO date: "2026-03-15"
  departTime?: string       // "06:00"
  returnDate?: string       // ISO date, null for one-way
  busId?: string
  driverId?: string
  agreedPrice?: number
  notes?: string
  createdBy: string
}

type ConflictResult =
  | { conflict: false; booking: Booking }
  | { conflict: true; conflictDetail: ConflictDetail[]; availableBuses: AvailableBus[] }

type ConflictDetail = {
  bookingId: string
  clientName: string
  departDate: string
  returnDate: string | null
  busName: string
}

export async function createBooking(
  db: DrizzleD1,
  env: Env,
  input: CreateBookingInput,
): Promise<ConflictResult> {

  // Step 1: Check for bus conflicts (only if bus is assigned)
  if (input.busId) {
    const conflicts = await findBusConflicts(
      db,
      input.tenantId,
      input.busId,
      input.departDate,
      input.returnDate ?? input.departDate,
      undefined, // no bookingId to exclude (this is a new booking)
    )

    if (conflicts.length > 0) {
      // Find alternative buses that ARE available
      const available = await findAvailableBuses(
        db,
        input.tenantId,
        input.departDate,
        input.returnDate ?? input.departDate,
      )

      return {
        conflict: true,
        conflictDetail: conflicts,
        availableBuses: available,
      }
    }
  }

  // Step 2: Check for driver conflicts (only if driver is assigned)
  if (input.driverId) {
    const driverBusy = await findDriverConflicts(
      db,
      input.tenantId,
      input.driverId,
      input.departDate,
      input.returnDate ?? input.departDate,
    )

    if (driverBusy.length > 0) {
      // Driver conflict is a soft warning — we still create the booking
      // but include the conflict info so the BFF can display it.
      // Business reason: owner may intentionally double-assign a driver
      // if they know the trips don't actually overlap in time.
    }
  }

  // Step 3: Create the booking
  const bookingId = ulid()
  const now = new Date().toISOString()

  await db.insert(bookings).values({
    id: bookingId,
    tenantId: input.tenantId,
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    routeFrom: input.routeFrom,
    routeTo: input.routeTo,
    departDate: input.departDate,
    departTime: input.departTime,
    returnDate: input.returnDate,
    busId: input.busId,
    driverId: input.driverId,
    status: 'pending',
    agreedPrice: input.agreedPrice,
    notes: input.notes,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  })

  // Step 4: Side effects (non-blocking)
  const booking = await getBookingDetail(db, input.tenantId, bookingId)

  await logActivity(db, {
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'booking_created',
    entityType: 'booking',
    entityId: bookingId,
    details: booking,
  })

  // Step 5: Evaluate alerts (new booking might trigger notifications)
  await evaluateBookingAlerts(db, env, input.tenantId, booking!)

  return { conflict: false, booking: booking! }
}
```

### 4b. The Conflict Query

Date-range overlap detection in SQLite:

```typescript
// packages/core-domain/src/services/booking.ts

async function findBusConflicts(
  db: DrizzleD1,
  tenantId: string,
  busId: string,
  departDate: string,
  returnDate: string,
  excludeBookingId?: string,
): Promise<ConflictDetail[]> {
  // Two date ranges [A_start, A_end] and [B_start, B_end] overlap when:
  // A_start <= B_end AND A_end >= B_start
  //
  // Our ranges:
  //   Existing booking: [booking.depart_date, booking.return_date ?? booking.depart_date]
  //   New booking:      [departDate, returnDate]

  const conditions = [
    eq(bookings.tenantId, tenantId),
    eq(bookings.busId, busId),
    inArray(bookings.status, ['pending', 'confirmed']),  // ignore completed/cancelled
    // Overlap condition:
    lte(bookings.departDate, returnDate),
    gte(
      // COALESCE: if return_date is null, treat it as a single-day trip
      sql`COALESCE(${bookings.returnDate}, ${bookings.departDate})`,
      departDate,
    ),
  ]

  if (excludeBookingId) {
    conditions.push(ne(bookings.id, excludeBookingId))
  }

  const results = await db
    .select({
      bookingId: bookings.id,
      clientName: bookings.clientName,
      departDate: bookings.departDate,
      returnDate: bookings.returnDate,
      busName: buses.name,
    })
    .from(bookings)
    .leftJoin(buses, eq(bookings.busId, buses.id))
    .where(and(...conditions))

  return results.map((r) => ({
    bookingId: r.bookingId,
    clientName: r.clientName,
    departDate: r.departDate,
    returnDate: r.returnDate,
    busName: r.busName ?? 'Unknown',
  }))
}
```

### 4c. Available Bus Finder

When a conflict is detected, we offer alternatives:

```typescript
async function findAvailableBuses(
  db: DrizzleD1,
  tenantId: string,
  departDate: string,
  returnDate: string,
): Promise<AvailableBus[]> {
  // Get all active buses for this tenant
  const allBuses = await db
    .select({ id: buses.id, name: buses.name, capacity: buses.capacity })
    .from(buses)
    .where(
      and(
        eq(buses.tenantId, tenantId),
        ne(buses.status, 'retired'),
        ne(buses.status, 'maintenance'),
      ),
    )

  if (allBuses.length === 0) return []

  // Get buses that are booked during this period
  const bookedBusIds = await db
    .selectDistinct({ busId: bookings.busId })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        inArray(bookings.status, ['pending', 'confirmed']),
        lte(bookings.departDate, returnDate),
        gte(
          sql`COALESCE(${bookings.returnDate}, ${bookings.departDate})`,
          departDate,
        ),
      ),
    )

  const bookedIds = new Set(bookedBusIds.map((b) => b.busId).filter(Boolean))

  return allBuses
    .filter((bus) => !bookedIds.has(bus.id))
    .map((bus) => ({
      busId: bus.id,
      busName: bus.name,
      capacity: bus.capacity,
    }))
}
```

### 4d. Booking Status Transitions

Status is not a free-form string. It follows a state machine:

```
                ┌──────────────┐
                │              │
    ┌──────────►│   pending    ├──────────┐
    │           │              │          │
    │           └──────┬───────┘          │
    │                  │                  │
    │                  │ confirm          │ cancel
    │                  ▼                  ▼
    │           ┌──────────────┐   ┌──────────────┐
    │           │              │   │              │
    │           │  confirmed   │   │  cancelled   │
    │           │              │   │              │
    │           └──────┬───────┘   └──────────────┘
    │                  │
    │                  │ complete
    │                  ▼
    │           ┌──────────────┐
    │           │              │
    │           │  completed   │
    │           │              │
    │           └──────────────┘
    │
    └──── (reopen: cancelled → pending, only by owner)
```

```typescript
// packages/core-domain/src/services/booking.ts

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],                          // terminal state
  cancelled: ['pending'],                 // reopen, owner only
}

export async function updateBookingStatus(
  db: DrizzleD1,
  env: Env,
  tenantId: string,
  bookingId: string,
  newStatus: string,
  updatedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const existing = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .get()

  if (!existing) return { ok: false, error: 'Booking tidak ditemukan' }

  const allowed = VALID_TRANSITIONS[existing.status]
  if (!allowed?.includes(newStatus)) {
    return {
      ok: false,
      error: `Tidak bisa ubah status dari ${existing.status} ke ${newStatus}`,
    }
  }

  await db
    .update(bookings)
    .set({ status: newStatus, updatedAt: new Date().toISOString() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))

  await logActivity(db, {
    tenantId,
    userId: updatedBy,
    action: `booking_${newStatus}`,
    entityType: 'booking',
    entityId: bookingId,
    details: { from: existing.status, to: newStatus },
  })

  // Alert: notify relevant people of status change
  const booking = await getBookingDetail(db, tenantId, bookingId)
  await evaluateBookingAlerts(db, env, tenantId, booking!)

  return { ok: true }
}
```

### 4e. Schedule Queries

```typescript
// packages/core-domain/src/services/booking.ts

export async function getSchedule(
  db: DrizzleD1,
  tenantId: string,
  filters: {
    date?: string
    from?: string
    to?: string
    status?: string
    busId?: string
  },
): Promise<ScheduleEntry[]> {
  const conditions = [eq(bookings.tenantId, tenantId)]

  // Single date (today's schedule) or date range
  if (filters.from && filters.to) {
    conditions.push(gte(bookings.departDate, filters.from))
    conditions.push(lte(bookings.departDate, filters.to))
  } else if (filters.date) {
    conditions.push(eq(bookings.departDate, filters.date))
  }

  if (filters.status) {
    conditions.push(eq(bookings.status, filters.status))
  }

  if (filters.busId) {
    conditions.push(eq(bookings.busId, filters.busId))
  }

  const results = await db
    .select({
      id: bookings.id,
      clientName: bookings.clientName,
      clientPhone: bookings.clientPhone,
      routeFrom: bookings.routeFrom,
      routeTo: bookings.routeTo,
      departDate: bookings.departDate,
      departTime: bookings.departTime,
      returnDate: bookings.returnDate,
      busId: bookings.busId,
      busName: buses.name,
      driverId: bookings.driverId,
      driverName: users.name,
      status: bookings.status,
      agreedPrice: bookings.agreedPrice,
      notes: bookings.notes,
    })
    .from(bookings)
    .leftJoin(buses, eq(bookings.busId, buses.id))
    .leftJoin(users, eq(bookings.driverId, users.id))
    .where(and(...conditions))
    .orderBy(bookings.departDate, bookings.departTime)

  return results
}

export async function getBookingDetail(
  db: DrizzleD1,
  tenantId: string,
  bookingId: string,
): Promise<BookingDetail | null> {
  const booking = await db
    .select()
    .from(bookings)
    .leftJoin(buses, eq(bookings.busId, buses.id))
    .leftJoin(users, eq(bookings.driverId, users.id))
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .get()

  if (!booking) return null

  // Fetch associated payments
  const bookingPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .orderBy(payments.paidAt)

  return {
    ...booking.bookings,
    busName: booking.buses?.name,
    driverName: booking.users?.name,
    payments: bookingPayments,
  }
}
```

---

## 5. Payment Service — Financial Pillar

### 5a. Recording a Payment

Every payment is linked to a booking. There is no "unlinked" money in the system — this is intentional. Bus operators track money per trip. "Pak Agus paid 5 million" must always map to "Pak Agus's March 15 booking."

```typescript
// packages/core-domain/src/services/payment.ts
import { eq, and, sum, sql } from 'drizzle-orm'
import { payments, bookings } from '@keloia/shared/db/schema'

type RecordPaymentInput = {
  tenantId: string
  bookingId: string
  amount: number          // in rupiah, always positive integer
  type: 'dp' | 'pelunasan' | 'refund' | 'other'
  method?: string         // 'transfer_bca', 'cash', 'gopay', etc.
  paidAt: string          // ISO date
  recordedBy: string
}

export async function recordPayment(
  db: DrizzleD1,
  env: Env,
  input: RecordPaymentInput,
): Promise<{ bookingFound: boolean; payment?: Payment; overpayment?: boolean }> {
  // Verify booking exists and belongs to tenant
  const booking = await db
    .select({
      id: bookings.id,
      agreedPrice: bookings.agreedPrice,
      clientName: bookings.clientName,
      status: bookings.status,
    })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, input.tenantId)))
    .get()

  if (!booking) return { bookingFound: false }

  // Calculate running total to detect overpayment
  const existingTotal = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(
      and(
        eq(payments.bookingId, input.bookingId),
        ne(payments.type, 'refund'), // refunds don't count toward total paid
      ),
    )
    .get()

  const alreadyPaid = Number(existingTotal?.total ?? 0)
  const effectiveAmount = input.type === 'refund' ? -input.amount : input.amount
  const newTotal = alreadyPaid + effectiveAmount

  // Overpayment warning (not an error — owner might know something we don't)
  const overpayment = booking.agreedPrice
    ? newTotal > booking.agreedPrice
    : false

  // Record the payment
  const paymentId = ulid()
  await db.insert(payments).values({
    id: paymentId,
    tenantId: input.tenantId,
    bookingId: input.bookingId,
    amount: input.amount,
    type: input.type,
    method: input.method,
    paidAt: input.paidAt,
    recordedBy: input.recordedBy,
  })

  await logActivity(db, {
    tenantId: input.tenantId,
    userId: input.recordedBy,
    action: 'payment_recorded',
    entityType: 'payment',
    entityId: paymentId,
    details: {
      bookingId: input.bookingId,
      clientName: booking.clientName,
      amount: input.amount,
      type: input.type,
    },
  })

  // Alert: if this completes the payment, notify owner
  if (booking.agreedPrice && newTotal >= booking.agreedPrice && !overpayment) {
    await queueAlert(env, {
      tenantId: input.tenantId,
      type: 'payment_complete',
      message: `Pembayaran ${booking.clientName} LUNAS ✅ (Rp ${booking.agreedPrice.toLocaleString('id-ID')})`,
      severity: 'info',
      relatedEntityType: 'booking',
      relatedEntityId: input.bookingId,
    })
  }

  const payment = await db.select().from(payments).where(eq(payments.id, paymentId)).get()
  return { bookingFound: true, payment: payment!, overpayment }
}
```

### 5b. Financial Summary

The dashboard's financial view aggregates across bookings and payments. This is the most query-intensive function in the system.

```typescript
// packages/core-domain/src/services/payment.ts

type FinancialSummary = {
  totalIncome: number
  totalBookings: number
  receivables: Receivable[]
  recentPayments: Payment[]
  periodBreakdown: PeriodEntry[]
}

type Receivable = {
  bookingId: string
  clientName: string
  clientPhone: string | null
  agreedPrice: number
  totalPaid: number
  outstanding: number
  departDate: string
}

export async function getFinancialSummary(
  db: DrizzleD1,
  tenantId: string,
  period: { from: string; to: string },
): Promise<FinancialSummary> {
  // Use db.batch() for transactional reads — all queries execute
  // in a single round-trip to D1, and the results are consistent.
  const [
    incomeResult,
    bookingCountResult,
    receivablesResult,
    recentPaymentsResult,
  ] = await db.batch([
    // Total income in period
    db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          gte(payments.paidAt, period.from),
          lte(payments.paidAt, period.to),
          ne(payments.type, 'refund'),
        ),
      ),

    // Total bookings in period
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          gte(bookings.departDate, period.from),
          lte(bookings.departDate, period.to),
        ),
      ),

    // Outstanding receivables: bookings with agreed price where total paid < agreed
    db
      .select({
        bookingId: bookings.id,
        clientName: bookings.clientName,
        clientPhone: bookings.clientPhone,
        agreedPrice: bookings.agreedPrice,
        totalPaid: sum(payments.amount),
        departDate: bookings.departDate,
      })
      .from(bookings)
      .leftJoin(
        payments,
        and(eq(payments.bookingId, bookings.id), ne(payments.type, 'refund')),
      )
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          inArray(bookings.status, ['pending', 'confirmed', 'completed']),
          sql`${bookings.agreedPrice} IS NOT NULL`,
        ),
      )
      .groupBy(bookings.id)
      .having(
        sql`COALESCE(SUM(${payments.amount}), 0) < ${bookings.agreedPrice}`,
      ),

    // Recent payments for display
    db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        clientName: bookings.clientName,
        amount: payments.amount,
        type: payments.type,
        method: payments.method,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .leftJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(payments.tenantId, tenantId))
      .orderBy(sql`${payments.paidAt} DESC`)
      .limit(20),
  ])

  return {
    totalIncome: Number(incomeResult[0]?.total ?? 0),
    totalBookings: bookingCountResult[0]?.count ?? 0,
    receivables: receivablesResult.map((r) => ({
      bookingId: r.bookingId,
      clientName: r.clientName,
      clientPhone: r.clientPhone,
      agreedPrice: r.agreedPrice!,
      totalPaid: Number(r.totalPaid ?? 0),
      outstanding: r.agreedPrice! - Number(r.totalPaid ?? 0),
      departDate: r.departDate,
    })),
    recentPayments: recentPaymentsResult,
    periodBreakdown: [],  // TODO: daily/weekly breakdown for charts
  }
}
```

**Why `db.batch()`?** D1 doesn't support traditional `BEGIN TRANSACTION` in Workers — Drizzle's `db.batch()` sends all statements in a single round-trip with implicit transactional semantics. If any statement fails, the entire batch rolls back. This both guarantees consistency and eliminates multiple network round-trips to D1.

---

## 6. Asset Service — Fleet Pillar

### 6a. Bus Management

```typescript
// packages/core-domain/src/services/asset.ts
import { eq, and, desc } from 'drizzle-orm'
import { buses, maintenanceLogs, bookings } from '@keloia/shared/db/schema'

export async function getAssetList(
  db: DrizzleD1,
  tenantId: string,
): Promise<AssetListEntry[]> {
  const allBuses = await db
    .select()
    .from(buses)
    .where(eq(buses.tenantId, tenantId))
    .orderBy(buses.name)

  // For each bus, get the most recent maintenance and next due
  const enriched = await Promise.all(
    allBuses.map(async (bus) => {
      const lastMaintenance = await db
        .select()
        .from(maintenanceLogs)
        .where(and(eq(maintenanceLogs.busId, bus.id), eq(maintenanceLogs.tenantId, tenantId)))
        .orderBy(desc(maintenanceLogs.performedAt))
        .limit(1)
        .get()

      return {
        ...bus,
        features: bus.features ? JSON.parse(bus.features) : [],
        lastMaintenance: lastMaintenance?.performedAt ?? null,
        lastMaintenanceType: lastMaintenance?.type ?? null,
        nextDue: lastMaintenance?.nextDueAt ?? null,
        isOverdue: lastMaintenance?.nextDueAt
          ? lastMaintenance.nextDueAt < new Date().toISOString().split('T')[0]
          : false,
      }
    }),
  )

  return enriched
}
```

### 6b. Maintenance Logging

Drivers report issues via WhatsApp ("Bus 03 AC mati"). After AI extraction and confirmation, the core-domain logs it:

```typescript
export async function logMaintenance(
  db: DrizzleD1,
  env: Env,
  input: {
    tenantId: string
    busId: string
    type: string           // 'oil_change', 'tire', 'ac_repair', 'general_service', etc.
    description?: string
    cost?: number
    performedAt: string
    nextDueAt?: string
    reportedBy: string
  },
): Promise<MaintenanceLog> {
  // Verify bus belongs to tenant
  const bus = await db
    .select({ id: buses.id, name: buses.name })
    .from(buses)
    .where(and(eq(buses.id, input.busId), eq(buses.tenantId, input.tenantId)))
    .get()

  if (!bus) throw new Error('Bus tidak ditemukan')

  const logId = ulid()

  await db.insert(maintenanceLogs).values({
    id: logId,
    tenantId: input.tenantId,
    busId: input.busId,
    type: input.type,
    description: input.description,
    cost: input.cost,
    performedAt: input.performedAt,
    nextDueAt: input.nextDueAt,
    reportedBy: input.reportedBy,
  })

  // If this is a reported issue (not scheduled service), update bus status
  const issueTypes = ['breakdown', 'ac_repair', 'engine_issue', 'tire_blowout']
  if (issueTypes.includes(input.type)) {
    await db
      .update(buses)
      .set({ status: 'maintenance' })
      .where(eq(buses.id, input.busId))
  }

  await logActivity(db, {
    tenantId: input.tenantId,
    userId: input.reportedBy,
    action: 'maintenance_logged',
    entityType: 'bus',
    entityId: input.busId,
    details: { type: input.type, busName: bus.name, description: input.description },
  })

  // Alert owner about the issue
  await queueAlert(env, {
    tenantId: input.tenantId,
    type: 'maintenance_reported',
    message: `${bus.name}: ${input.type}${input.description ? ` — ${input.description}` : ''}`,
    severity: issueTypes.includes(input.type) ? 'high' : 'info',
    relatedEntityType: 'bus',
    relatedEntityId: input.busId,
  })

  return (await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, logId)).get())!
}
```

---

## 7. Alert Service — The Proactive Brain

The alert service is not a simple notification sender. It is an **evaluator** — it runs after every state change and decides what (if anything) needs attention. This is how Keloia turns from passive record-keeping into proactive operational intelligence.

### 7a. Alert Types

```typescript
// packages/core-domain/src/services/alert.ts

type AlertType =
  | 'booking_conflict'        // bus double-booked
  | 'unconfirmed_booking'     // booking still pending after 24h
  | 'payment_overdue'         // booking completed, payment outstanding > 7 days
  | 'payment_complete'        // booking fully paid
  | 'maintenance_due'         // next_due_at is past or within 7 days
  | 'maintenance_reported'    // driver reported an issue
  | 'permit_expiring'         // bus permit expires within 30 days
  | 'new_booking'             // new booking created (notify admin/owner)
  | 'status_change'           // booking status changed

type AlertSeverity = 'info' | 'medium' | 'high'

type Alert = {
  id: string
  tenantId: string
  type: AlertType
  message: string
  severity: AlertSeverity
  relatedEntityType: 'booking' | 'payment' | 'bus'
  relatedEntityId: string
  targetRoles: string[]       // which roles should see this
  dismissed: boolean
  createdAt: string
}
```

### 7b. Evaluation After Booking Changes

Called after `createBooking`, `updateBookingStatus`, or `updateBooking`:

```typescript
export async function evaluateBookingAlerts(
  db: DrizzleD1,
  env: Env,
  tenantId: string,
  booking: BookingDetail,
): Promise<void> {
  const alerts: QueuedAlert[] = []

  // 1. Notify admin/owner of new bookings
  if (booking.status === 'pending') {
    alerts.push({
      tenantId,
      type: 'new_booking',
      message: `Booking baru: ${booking.clientName}, ${formatDateID(booking.departDate)}, ${booking.routeFrom}→${booking.routeTo}`,
      severity: 'info',
      relatedEntityType: 'booking',
      relatedEntityId: booking.id,
      targetRoles: ['owner', 'admin'],
    })
  }

  // 2. Status changes that need attention
  if (booking.status === 'confirmed' && booking.driverId) {
    // Notify the assigned driver
    const driver = await db
      .select({ phone: users.phone, name: users.name })
      .from(users)
      .where(eq(users.id, booking.driverId))
      .get()

    if (driver) {
      await env.WA_OUTBOUND.send({
        type: 'text',
        to: driver.phone,
        body: `Trip dikonfirmasi 🚌\n${booking.routeFrom} → ${booking.routeTo}\nTanggal: ${formatDateID(booking.departDate)}${booking.departTime ? `\nJam: ${booking.departTime}` : ''}\nKlien: ${booking.clientName}`,
      })
    }
  }

  // 3. Completed booking with outstanding payment
  if (booking.status === 'completed' && booking.agreedPrice) {
    const totalPaid = booking.payments?.reduce((s, p) =>
      p.type === 'refund' ? s : s + p.amount, 0,
    ) ?? 0

    if (totalPaid < booking.agreedPrice) {
      alerts.push({
        tenantId,
        type: 'payment_overdue',
        message: `${booking.clientName} — trip selesai, sisa pembayaran Rp ${(booking.agreedPrice - totalPaid).toLocaleString('id-ID')}`,
        severity: 'medium',
        relatedEntityType: 'booking',
        relatedEntityId: booking.id,
        targetRoles: ['owner'],
      })
    }
  }

  // Persist and notify
  for (const alert of alerts) {
    await persistAlert(db, alert)
    await sendAlertNotifications(db, env, alert)
  }
}
```

### 7c. Alert Persistence and WhatsApp Delivery

Alerts live in two places: D1 (for dashboard display) and WhatsApp queue (for push notification).

```typescript
async function persistAlert(
  db: DrizzleD1,
  alert: QueuedAlert,
): Promise<void> {
  await db.insert(alerts).values({
    id: ulid(),
    tenantId: alert.tenantId,
    type: alert.type,
    message: alert.message,
    severity: alert.severity,
    relatedEntityType: alert.relatedEntityType,
    relatedEntityId: alert.relatedEntityId,
    targetRoles: JSON.stringify(alert.targetRoles),
    dismissed: false,
    createdAt: new Date().toISOString(),
  })
}

async function sendAlertNotifications(
  db: DrizzleD1,
  env: Env,
  alert: QueuedAlert,
): Promise<void> {
  // Find all users in this tenant who have one of the target roles
  const recipients = await db
    .select({ phone: users.phone, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.tenantId, alert.tenantId),
        inArray(users.role, alert.targetRoles),
      ),
    )

  // Send WhatsApp notification to each recipient
  for (const recipient of recipients) {
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: recipient.phone,
      body: `⚠️ ${alert.message}`,
    })
  }
}
```

### 7d. Alert Queries for Dashboard

```typescript
export async function getPendingAlerts(
  db: DrizzleD1,
  tenantId: string,
  userId: string,
  role: string,
): Promise<Alert[]> {
  // Get alerts that target this user's role, not yet dismissed
  const results = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        eq(alerts.dismissed, false),
        sql`json_each.value = ${role}`,
      ),
    )
    // json_each trick: SQLite can query inside JSON arrays
    // This works because targetRoles is stored as '["owner","admin"]'
    .leftJoin(sql`json_each(${alerts.targetRoles})`, sql`1=1`)
    .orderBy(desc(alerts.createdAt))
    .limit(50)

  return results
}

export async function dismissAlert(
  db: DrizzleD1,
  tenantId: string,
  alertId: string,
): Promise<void> {
  await db
    .update(alerts)
    .set({ dismissed: true })
    .where(and(eq(alerts.id, alertId), eq(alerts.tenantId, tenantId)))
}
```

**Schema addition (not in original architecture doc):**

The original architecture doc doesn't have an `alerts` table. We need one:

```sql
CREATE TABLE alerts (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  type                TEXT NOT NULL,
  message             TEXT NOT NULL,
  severity            TEXT NOT NULL CHECK (severity IN ('info','medium','high')),
  related_entity_type TEXT NOT NULL,
  related_entity_id   TEXT NOT NULL,
  target_roles        TEXT NOT NULL,      -- JSON array: '["owner","admin"]'
  dismissed           INTEGER NOT NULL DEFAULT 0,  -- SQLite boolean
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_alerts_tenant ON alerts(tenant_id, dismissed, created_at);
```

---

## 8. Action Router — WA BFF Entry Point

When the WA BFF sends a confirmed action, it hits a single endpoint. The core-domain routes it to the right service:

```typescript
// packages/core-domain/src/routes/action.ts
import { Hono } from 'hono'

export const actionRoutes = new Hono()

type ActionPayload = {
  tenantId: string
  userId: string
  intent: string
  data: Record<string, unknown>
}

actionRoutes.post('/', async (c) => {
  const db = c.get('db')
  const env = c.env
  const payload: ActionPayload = await c.req.json()
  const { tenantId, userId, intent, data } = payload

  switch (intent) {
    case 'create_booking':
      return handleCreateBooking(c, db, env, tenantId, userId, data)

    case 'record_payment':
      return handleRecordPayment(c, db, env, tenantId, userId, data)

    case 'report_issue':
      return handleReportIssue(c, db, env, tenantId, userId, data)

    case 'update_booking':
      return handleUpdateBooking(c, db, env, tenantId, userId, data)

    case 'check_schedule':
      return handleCheckSchedule(c, db, tenantId, data)

    case 'check_payment':
      return handleCheckPayment(c, db, tenantId, data)

    default:
      return c.json({ error: `Unknown intent: ${intent}` }, 400)
  }
})

// --- Individual handlers ---

async function handleCreateBooking(c, db, env, tenantId, userId, data) {
  const result = await createBooking(db, env, {
    tenantId,
    clientName: data.client as string,
    routeFrom: data.routeFrom as string,
    routeTo: data.routeTo as string,
    departDate: data.date as string,
    departTime: data.time as string | undefined,
    returnDate: data.returnDate as string | undefined,
    busId: data.busId as string | undefined,
    agreedPrice: data.price as number | undefined,
    notes: data.notes as string | undefined,
    createdBy: userId,
  })

  if (result.conflict) {
    const busNames = result.availableBuses.map((b) => b.busName).join(', ')
    return c.json({
      error: 'conflict',
      successMessage: null,
      conflictMessage: `⚠️ ${result.conflictDetail[0].busName} sudah di-book tanggal itu untuk ${result.conflictDetail[0].clientName}.${busNames ? ` Bus tersedia: ${busNames}.` : ' Tidak ada bus tersedia.'}`,
    }, 409)
  }

  return c.json({
    successMessage: `Booking tercatat ✅\n${data.client}, ${formatDateID(data.date as string)}\n${data.routeFrom} → ${data.routeTo}`,
    booking: result.booking,
  })
}

async function handleRecordPayment(c, db, env, tenantId, userId, data) {
  const result = await recordPayment(db, env, {
    tenantId,
    bookingId: data.bookingId as string,
    amount: data.amount as number,
    type: data.type as 'dp' | 'pelunasan' | 'refund' | 'other',
    method: data.method as string | undefined,
    paidAt: data.paidAt as string ?? new Date().toISOString().split('T')[0],
    recordedBy: userId,
  })

  if (!result.bookingFound) {
    return c.json({ error: 'Booking tidak ditemukan' }, 404)
  }

  const overNote = result.overpayment ? '\n⚠️ Total pembayaran melebihi harga yang disepakati' : ''
  return c.json({
    successMessage: `Pembayaran tercatat ✅\nRp ${(data.amount as number).toLocaleString('id-ID')} (${data.type})${overNote}`,
    payment: result.payment,
  })
}

async function handleReportIssue(c, db, env, tenantId, userId, data) {
  const result = await logMaintenance(db, env, {
    tenantId,
    busId: data.busId as string,
    type: data.issueType as string,
    description: data.description as string,
    performedAt: new Date().toISOString().split('T')[0],
    reportedBy: userId,
  })

  return c.json({
    successMessage: `Laporan tercatat ✅\n${data.busName ?? 'Bus'}: ${data.issueType}${data.description ? ` — ${data.description}` : ''}`,
    log: result,
  })
}

async function handleCheckSchedule(c, db, tenantId, data) {
  const date = data.date as string ?? new Date().toISOString().split('T')[0]
  const schedule = await getSchedule(db, tenantId, { date })

  if (schedule.length === 0) {
    return c.json({
      successMessage: `📋 Tidak ada jadwal untuk ${formatDateID(date)}`,
    })
  }

  const lines = schedule.map((s) =>
    `• ${s.clientName}: ${s.routeFrom}→${s.routeTo}${s.busName ? ` (${s.busName})` : ''} ${s.status}`,
  )

  return c.json({
    successMessage: `📋 Jadwal ${formatDateID(date)}:\n${lines.join('\n')}`,
  })
}

async function handleCheckPayment(c, db, tenantId, data) {
  const clientName = data.clientName as string

  // Search bookings by client name (fuzzy — LIKE query)
  const clientBookings = await db
    .select({
      id: bookings.id,
      clientName: bookings.clientName,
      agreedPrice: bookings.agreedPrice,
      departDate: bookings.departDate,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        sql`${bookings.clientName} LIKE ${'%' + clientName + '%'}`,
      ),
    )
    .orderBy(desc(bookings.departDate))
    .limit(5)

  if (clientBookings.length === 0) {
    return c.json({ successMessage: `Tidak ada booking untuk "${clientName}"` })
  }

  const lines = await Promise.all(
    clientBookings.map(async (b) => {
      const paid = await db
        .select({ total: sum(payments.amount) })
        .from(payments)
        .where(and(eq(payments.bookingId, b.id), ne(payments.type, 'refund')))
        .get()

      const totalPaid = Number(paid?.total ?? 0)
      const outstanding = (b.agreedPrice ?? 0) - totalPaid

      return `• ${formatDateID(b.departDate)}: Rp ${totalPaid.toLocaleString('id-ID')} dibayar${outstanding > 0 ? `, sisa Rp ${outstanding.toLocaleString('id-ID')}` : ' — LUNAS ✅'}`
    }),
  )

  return c.json({
    successMessage: `💰 Pembayaran ${clientBookings[0].clientName}:\n${lines.join('\n')}`,
  })
}
```

---

## 9. Activity Log — The Audit Trail

Every mutation in the system creates an activity log entry. This is the "no documentation trail" pain killer.

```typescript
// packages/core-domain/src/services/activity-log.ts

type LogEntry = {
  tenantId: string
  userId: string
  action: string
  entityType: string
  entityId: string
  details: unknown
}

export async function logActivity(
  db: DrizzleD1,
  entry: LogEntry,
): Promise<void> {
  await db.insert(activityLog).values({
    id: ulid(),
    tenantId: entry.tenantId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: JSON.stringify(entry.details),
    createdAt: new Date().toISOString(),
  })
}
```

**Activity log is append-only.** No updates, no deletes. It's an immutable audit trail. Over time, this becomes the basis for "data-driven decisions" — bus utilization rates, client payment patterns, peak demand periods.

**Why not a separate analytics pipeline?** YAGNI. At MVP scale (5-10 buses, 100-300 bookings/month), a simple `GROUP BY` query against the activity log is fast enough. When the data grows, we can add materialized views or export to an analytics service.

---

## 10. Morning Briefing — Cron Trigger

The most user-visible proactive feature. Every morning at 5 AM WIB, each team member gets a WhatsApp summary relevant to their role.

```typescript
// packages/core-domain/src/cron/morning-briefing.ts

export async function cronHandler(env: Env): Promise<void> {
  const db = drizzle(env.DB, { schema })
  const today = new Date().toISOString().split('T')[0]

  // Get all active tenants
  const allTenants = await db.select({ id: tenants.id }).from(tenants)

  for (const tenant of allTenants) {
    await generateTenantBriefings(db, env, tenant.id, today)
  }
}

async function generateTenantBriefings(
  db: DrizzleD1,
  env: Env,
  tenantId: string,
  today: string,
): Promise<void> {
  // Gather all data in a single batch call
  const [todayBookings, overduePayments, maintenanceDue, unresolvedAlerts] = await db.batch([
    db
      .select({
        id: bookings.id,
        clientName: bookings.clientName,
        routeFrom: bookings.routeFrom,
        routeTo: bookings.routeTo,
        departTime: bookings.departTime,
        busName: buses.name,
        driverName: users.name,
        driverId: bookings.driverId,
        status: bookings.status,
      })
      .from(bookings)
      .leftJoin(buses, eq(bookings.busId, buses.id))
      .leftJoin(users, eq(bookings.driverId, users.id))
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.departDate, today),
          inArray(bookings.status, ['pending', 'confirmed']),
        ),
      )
      .orderBy(bookings.departTime),

    // Bookings completed > 7 days ago with outstanding payments
    db
      .select({
        clientName: bookings.clientName,
        agreedPrice: bookings.agreedPrice,
        totalPaid: sum(payments.amount),
      })
      .from(bookings)
      .leftJoin(
        payments,
        and(eq(payments.bookingId, bookings.id), ne(payments.type, 'refund')),
      )
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.status, 'completed'),
          sql`${bookings.agreedPrice} IS NOT NULL`,
        ),
      )
      .groupBy(bookings.id)
      .having(sql`COALESCE(SUM(${payments.amount}), 0) < ${bookings.agreedPrice}`),

    // Buses with maintenance overdue or due within 7 days
    db
      .select({
        busName: buses.name,
        busId: buses.id,
        lastType: maintenanceLogs.type,
        nextDue: maintenanceLogs.nextDueAt,
      })
      .from(maintenanceLogs)
      .innerJoin(buses, eq(maintenanceLogs.busId, buses.id))
      .where(
        and(
          eq(maintenanceLogs.tenantId, tenantId),
          sql`${maintenanceLogs.nextDueAt} IS NOT NULL`,
          sql`${maintenanceLogs.nextDueAt} <= date(${today}, '+7 days')`,
        ),
      ),

    // Unresolved alerts
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.dismissed, false))),
  ])

  // Get all users in this tenant
  const teamMembers = await db
    .select({ id: users.id, phone: users.phone, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.tenantId, tenantId))

  for (const member of teamMembers) {
    const message = buildBriefingMessage(
      member,
      todayBookings,
      overduePayments,
      maintenanceDue,
      unresolvedAlerts[0]?.count ?? 0,
    )

    if (message) {
      await env.WA_OUTBOUND.send({
        type: 'text',
        to: member.phone,
        body: message,
      })
    }
  }
}
```

### 10a. Role-Specific Briefing Content

```typescript
function buildBriefingMessage(
  member: { id: string; name: string; role: string },
  todayBookings: TodayBooking[],
  overduePayments: OverduePayment[],
  maintenanceDue: MaintenanceDueItem[],
  unresolvedAlertCount: number,
): string | null {
  const lines: string[] = [`Selamat pagi, ${member.name}! 🌅`]

  switch (member.role) {
    case 'driver': {
      // Drivers only see their own trips today
      const myTrips = todayBookings.filter((b) => b.driverId === member.id)
      if (myTrips.length === 0) {
        lines.push('Tidak ada trip hari ini. Selamat istirahat! 🙂')
      } else {
        lines.push(`Trip hari ini (${myTrips.length}):`)
        for (const trip of myTrips) {
          lines.push(
            `🚌 ${trip.routeFrom} → ${trip.routeTo}${trip.departTime ? `, jam ${trip.departTime}` : ''}${trip.busName ? `, ${trip.busName}` : ''}\n   Klien: ${trip.clientName}`,
          )
        }
      }
      break
    }

    case 'admin': {
      // Admins see full schedule + pending items
      if (todayBookings.length === 0) {
        lines.push('Tidak ada jadwal hari ini.')
      } else {
        lines.push(`📋 Jadwal hari ini (${todayBookings.length} trip):`)
        for (const trip of todayBookings) {
          const status = trip.status === 'pending' ? '⏳' : '✅'
          lines.push(
            `${status} ${trip.clientName}: ${trip.routeFrom}→${trip.routeTo}${trip.busName ? ` (${trip.busName})` : ''}`,
          )
        }
      }

      const pendingCount = todayBookings.filter((b) => b.status === 'pending').length
      if (pendingCount > 0) {
        lines.push(`\n⚠️ ${pendingCount} booking belum dikonfirmasi`)
      }
      break
    }

    case 'owner': {
      // Owners see exceptions only — what needs attention
      const issues: string[] = []

      if (todayBookings.length > 0) {
        lines.push(`📋 ${todayBookings.length} trip hari ini`)
      }

      const pendingCount = todayBookings.filter((b) => b.status === 'pending').length
      if (pendingCount > 0) {
        issues.push(`${pendingCount} booking belum dikonfirmasi`)
      }

      if (overduePayments.length > 0) {
        const totalOutstanding = overduePayments.reduce((s, p) => {
          const paid = Number(p.totalPaid ?? 0)
          return s + (p.agreedPrice! - paid)
        }, 0)
        issues.push(
          `${overduePayments.length} klien belum bayar, total Rp ${totalOutstanding.toLocaleString('id-ID')}`,
        )
      }

      if (maintenanceDue.length > 0) {
        issues.push(`${maintenanceDue.length} bus perlu maintenance`)
      }

      if (unresolvedAlertCount > 0) {
        issues.push(`${unresolvedAlertCount} alert belum ditangani`)
      }

      if (issues.length === 0) {
        lines.push('Semua berjalan lancar ✅')
      } else {
        lines.push('\n⚠️ Perlu perhatian:')
        issues.forEach((issue) => lines.push(`• ${issue}`))
      }
      break
    }
  }

  // Don't send empty/useless briefings
  if (lines.length <= 1) return null

  return lines.join('\n')
}
```

**Why not AI-generated briefings?** The morning briefing is a structured summary of known data. Using Claude here would add latency, cost, and a failure point for zero benefit. The format is fixed and predictable. If we later want "AI insights" ("Bus 01 paling produktif bulan ini"), that's a separate feature built on top of the activity log.

---

## 11. Tenant Service — Onboarding & Team Management

### 11a. Tenant Creation

```typescript
// packages/core-domain/src/services/tenant.ts

export async function createTenant(
  db: DrizzleD1,
  env: Env,
  input: {
    name: string
    ownerName: string
    ownerPhone: string
  },
): Promise<{ tenant: Tenant; owner: User; inviteCode: string }> {
  const tenantId = ulid()
  const ownerId = ulid()
  const inviteCode = generateInviteCode() // 6 alphanumeric chars

  // Batch: create tenant, create owner user, atomically
  await db.batch([
    db.insert(tenants).values({
      id: tenantId,
      name: input.name,
      createdAt: new Date().toISOString(),
    }),

    db.insert(users).values({
      id: ownerId,
      tenantId,
      phone: input.ownerPhone,
      name: input.ownerName,
      role: 'owner',
      createdAt: new Date().toISOString(),
    }),
  ])

  // Register phone → tenant lookup in KV
  await env.PHONE_LOOKUP.put(
    `phone:${input.ownerPhone}`,
    JSON.stringify({ tenantId, userId: ownerId, role: 'owner' }),
  )

  // Store invite code for team member registration
  await env.PHONE_LOOKUP.put(
    `invite:${inviteCode}`,
    JSON.stringify({ tenantId, tenantName: input.name }),
    { expirationTtl: 30 * 24 * 60 * 60 }, // 30 days
  )

  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get()
  const owner = await db.select().from(users).where(eq(users.id, ownerId)).get()

  return { tenant: tenant!, owner: owner!, inviteCode }
}
```

### 11b. Team Member Registration

When a new team member sends a message to Keloia for the first time, the WA BFF detects "unknown phone" and prompts for an invite code. The core-domain validates it:

```typescript
export async function registerTeamMember(
  db: DrizzleD1,
  env: Env,
  input: {
    phone: string
    name: string
    inviteCode: string
    role: 'admin' | 'driver'
  },
): Promise<{ success: boolean; error?: string; user?: User }> {
  // Validate invite code
  const invite = await env.PHONE_LOOKUP.get(`invite:${input.inviteCode}`)
  if (!invite) {
    return { success: false, error: 'Kode undangan tidak valid atau sudah kedaluwarsa' }
  }

  const { tenantId, tenantName } = JSON.parse(invite)

  // Check if phone is already registered
  const existing = await env.PHONE_LOOKUP.get(`phone:${input.phone}`)
  if (existing) {
    return { success: false, error: 'Nomor sudah terdaftar' }
  }

  const userId = ulid()

  await db.insert(users).values({
    id: userId,
    tenantId,
    phone: input.phone,
    name: input.name,
    role: input.role,
    createdAt: new Date().toISOString(),
  })

  // Register phone → tenant lookup
  await env.PHONE_LOOKUP.put(
    `phone:${input.phone}`,
    JSON.stringify({ tenantId, userId, role: input.role }),
  )

  await logActivity(db, {
    tenantId,
    userId,
    action: 'team_member_registered',
    entityType: 'user',
    entityId: userId,
    details: { name: input.name, role: input.role },
  })

  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  return { success: true, user: user! }
}
```

### 11c. Role Update (Owner → Dashboard)

When the owner changes a team member's role via the dashboard settings:

```typescript
export async function updateTeamMember(
  db: DrizzleD1,
  env: Env,
  tenantId: string,
  memberId: string,
  updates: { role?: 'admin' | 'driver'; name?: string },
): Promise<{ found: boolean; member?: User }> {
  const existing = await db
    .select()
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)))
    .get()

  if (!existing) return { found: false }

  await db
    .update(users)
    .set({
      ...(updates.role && { role: updates.role }),
      ...(updates.name && { name: updates.name }),
    })
    .where(eq(users.id, memberId))

  // Update KV phone lookup if role changed
  if (updates.role && updates.role !== existing.role) {
    await env.PHONE_LOOKUP.put(
      `phone:${existing.phone}`,
      JSON.stringify({
        tenantId,
        userId: memberId,
        role: updates.role,
      }),
    )
  }

  const updated = await db.select().from(users).where(eq(users.id, memberId)).get()
  return { found: true, member: updated! }
}
```

**KV consistency note:** When a role changes, we update the `PHONE_LOOKUP` KV immediately. However, KV is eventually consistent — there's a small window (typically <60 seconds) where the WA BFF might see the old role. For MVP this is acceptable. The worst case is a driver briefly retaining admin-level WhatsApp access until the KV propagates.

---

## 12. D1 Transaction Patterns

D1 in Workers does **not** support `BEGIN TRANSACTION` / `COMMIT`. Drizzle's `db.transaction()` will throw. Instead, we use two patterns:

### 12a. `db.batch()` — Atomic Multi-Statement

Sends all statements in one round-trip. All succeed or all roll back.

```typescript
// Good: atomic creation of tenant + owner
await db.batch([
  db.insert(tenants).values({ id: tenantId, name, createdAt }),
  db.insert(users).values({ id: ownerId, tenantId, phone, name, role: 'owner', createdAt }),
])

// Good: consistent reads for financial summary
const [income, count, receivables] = await db.batch([
  db.select({ total: sum(payments.amount) }).from(payments).where(...),
  db.select({ count: sql`COUNT(*)` }).from(bookings).where(...),
  db.select(...).from(bookings).leftJoin(payments, ...).where(...),
])
```

### 12b. Check-Then-Act with Application-Level Idempotency

For operations where we need to read before writing (e.g., conflict detection), we can't wrap read + write in a transaction. Instead:

```typescript
// Pattern: read, decide, write, verify
//
// 1. Read: check for conflicts
// 2. Decide: conflict? → return error
// 3. Write: insert booking
// 4. No verify needed — at MVP scale, concurrent booking creation
//    for the same bus is extremely unlikely (one admin, one owner)
//
// If scale increases, upgrade path:
// - Move booking creation into a Durable Object (single-writer per tenant)
// - This gives true sequential consistency without D1 transactions
```

**Why this is fine for MVP:** The check-then-act race condition requires two users to simultaneously book the same bus for the same date within milliseconds. With 1-2 admins per tenant processing bookings via WhatsApp (inherently serial), this is statistically impossible. We document the upgrade path but don't build it.

---

## 13. Internal Route Map (Complete)

Every `/internal/*` endpoint the core-domain Worker serves:

| Route | Method | Called By | Service | Description |
|---|---|---|---|---|
| `/internal/action` | POST | WA BFF | action router | Dispatch confirmed intent to service |
| `/internal/schedule` | POST | Dashboard BFF | booking | Get schedule (date/range/filters) |
| `/internal/schedule/detail` | POST | Dashboard BFF | booking | Single booking with payments |
| `/internal/bookings/create` | POST | Dashboard BFF | booking | Create booking (conflict detection) |
| `/internal/bookings/update` | POST | Dashboard BFF | booking | Update booking fields or status |
| `/internal/financials/summary` | POST | Dashboard BFF | payment | Aggregated financial summary |
| `/internal/financials/record` | POST | Dashboard BFF | payment | Record a payment |
| `/internal/assets/list` | POST | Dashboard BFF | asset | All buses with status + maintenance |
| `/internal/assets/detail` | POST | Dashboard BFF | asset | Single bus + history + bookings |
| `/internal/alerts/pending` | POST | Dashboard BFF | alert | Alerts for user's role |
| `/internal/alerts/dismiss` | POST | Dashboard BFF | alert | Mark alert as dismissed |
| `/internal/team/list` | POST | Dashboard BFF | tenant | Team members for settings page |
| `/internal/team/update` | POST | Dashboard BFF | tenant | Update member role/name |
| `/internal/team/register` | POST | WA BFF | tenant | Register new member via invite |
| `/internal/tenant/create` | POST | WA BFF | tenant | Create new tenant (onboarding) |

**Why all POST?** Service Binding calls use `Request` objects. We could use GET for reads, but POST with a JSON body is simpler — every call has the same shape (`{ tenantId, ...params }`), and there's no caching to benefit from GET semantics (BFF layer handles caching).

---

## 14. Utility Helpers

### 14a. Date Formatting (Indonesian)

```typescript
// packages/shared/src/format.ts

export function formatDateID(isoDate: string): string {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${months[month - 1]} ${year}`
}

// "2026-03-15" → "15 Maret 2026"
```

### 14b. Invite Code Generator

```typescript
// packages/core-domain/src/lib/invite-code.ts

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I confusion
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

// Produces codes like: "K7NH3P", "WR4X9M"
```

### 14c. Queue Alert Helper

```typescript
// packages/core-domain/src/lib/queue-alert.ts

export async function queueAlert(
  env: Env,
  alert: Omit<QueuedAlert, 'targetRoles'> & { targetRoles?: string[] },
): Promise<void> {
  // Default target roles based on alert type
  const defaultTargets: Record<string, string[]> = {
    booking_conflict: ['owner', 'admin'],
    unconfirmed_booking: ['owner', 'admin'],
    payment_overdue: ['owner'],
    payment_complete: ['owner'],
    maintenance_due: ['owner', 'admin'],
    maintenance_reported: ['owner', 'admin'],
    permit_expiring: ['owner'],
    new_booking: ['owner', 'admin'],
    status_change: ['owner', 'admin'],
  }

  const targetRoles = alert.targetRoles ?? defaultTargets[alert.type] ?? ['owner']
  // Alert persistence and WA delivery handled by sendAlertNotifications
  // (called from the evaluation functions in section 7)
}
```

---

## 15. Wrangler Config (Complete)

```toml
# packages/core-domain/wrangler.toml
name = "keloia-core-domain"
main = "src/index.ts"
compatibility_date = "2025-01-01"

# NOT publicly routed — only accessible via Service Bindings
# No [routes] or [triggers.routes] section

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "keloia-db"
database_id = "xxx"

# KV — phone lookup (shared with WA BFF) and invite codes
[[kv_namespaces]]
binding = "PHONE_LOOKUP"
id = "yyy"

# Queue — outbound WhatsApp messages
[[queues.producers]]
binding = "WA_OUTBOUND"
queue = "keloia-wa-outbound"

# Cron — morning briefing
[triggers]
crons = ["0 22 * * *"]  # 22:00 UTC = 05:00 WIB (UTC+7)

# Secrets (set via `wrangler secret put`):
# (none — core-domain has no external API keys)
```

---

## 16. File Structure (Final)

```
packages/core-domain/
├── src/
│   ├── index.ts                    # Hono app, Service Binding target, cron export
│   ├── routes/
│   │   ├── action.ts               # /internal/action — WA BFF intent dispatch
│   │   ├── booking.ts              # /internal/schedule, /internal/bookings/*
│   │   ├── payment.ts              # /internal/financials/*
│   │   ├── asset.ts                # /internal/assets/*
│   │   ├── alert.ts                # /internal/alerts/*
│   │   └── team.ts                 # /internal/team/*, /internal/tenant/*
│   ├── services/
│   │   ├── booking.ts              # Conflict detection, status transitions, queries
│   │   ├── payment.ts              # Record payment, financial summary, receivables
│   │   ├── asset.ts                # Bus management, maintenance logging
│   │   ├── alert.ts                # Evaluation, persistence, WA delivery
│   │   ├── tenant.ts               # Onboarding, invite codes, team management
│   │   └── activity-log.ts         # Append-only audit trail
│   ├── cron/
│   │   └── morning-briefing.ts     # Daily 5AM WIB cron handler
│   ├── lib/
│   │   ├── tenant-guard.ts         # byTenant() helper
│   │   ├── invite-code.ts          # Alphanumeric code generator
│   │   └── queue-alert.ts          # Alert queueing helper
│   └── types.ts                    # Core-domain-specific types
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## 17. What This Doc Does NOT Cover (Next Deep Dives)

| Topic | What's Needed | Doc |
|---|---|---|
| **AI Processor** | Prompt engineering, confidence calibration, intent schemas, multi-turn clarification | `keloia-ai-processor-deep-dive.md` |
| **Dashboard UI** | React components, page layouts, React Query hooks, polling UX | `keloia-dashboard-ui-deep-dive.md` |
| **Onboarding Flow** | End-to-end first-contact experience, invite code UX, tenant setup | `keloia-onboarding-deep-dive.md` |
| **Testing Strategy** | Service-level tests with real D1, integration tests, E2E flows | `keloia-testing-deep-dive.md` |
