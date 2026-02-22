# Keloia — Dashboard BFF Deep Dive

**From Login to Real-Time Operational View**
February 2026

---

## 1. What This Document Covers

The [main architecture doc](./keloia-architecture.md) defines the Dashboard BFF as "authentication, RBAC enforcement, JSON API for the SPA, PDF generation trigger." This document goes **inside** — every middleware layer, every route, every caching decision, and the auth model from login to session expiry. Think of this as the implementation blueprint for the web side of Keloia.

```
Browser (SPA)                              Keloia Edge
─────────────                              ──────────

Dashboard UI    ─── GET /api/schedule ────► dashboard-bff Worker
(React + Vite)                                │
                                              ├─ 1. Cookie → session token
                                              ├─ 2. KV.get(session:{token}) → { tenantId, userId, role }
                                              ├─ 3. RBAC: role vs. route permission
                                              ├─ 4. Cache check (KV, 30s TTL)
                                              │      └─ miss → Service Binding → core-domain
                                              ├─ 5. Return JSON
                                              │
                                              ▼
                                         core-domain Worker
                                              │
                                              ├─ D1 query (tenant-scoped)
                                              └─ Return structured data

Dashboard UI    ◄── JSON response ───────◄ dashboard-bff
renders table
```

**Key difference from WA BFF:** The Dashboard BFF is entirely synchronous request/response. No queues, no Durable Objects, no AI processing. The user clicks, the page loads. Speed is the only metric that matters here.

---

## 2. Auth Model — Phone-Based, No Passwords

### 2a. Why No Username/Password

Keloia's users are bus operators, admins, and drivers in Indonesia. They live on WhatsApp. They don't have "work email addresses." Asking them to create a password for a dashboard they'll check twice a day is a friction wall that kills adoption.

**Auth flow: WhatsApp OTP → session cookie.**

The owner and admin already have verified phone numbers in the system (registered via WhatsApp onboarding). We leverage that existing identity.

### 2b. Login Flow

```
Browser                    dashboard-bff              core-domain          WhatsApp
───────                    ─────────────              ───────────          ────────

1. Visit /login
   → show phone input

2. POST /auth/request-otp
   { phone: "628123456789" }
                           ├─ KV.get(phone:628...)
                           │   → { tenantId, userId, role }
                           │   (same lookup as WA BFF)
                           │
                           ├─ If not found → 404 "Nomor tidak terdaftar"
                           │
                           ├─ Generate 6-digit OTP
                           │   code = crypto random [100000..999999]
                           │
                           ├─ KV.put(otp:{phone}, { code, attempts: 0 },
                           │         { expirationTtl: 300 })  // 5 min
                           │
                           └─ Queue → WA outbound ─────────────────────► "Kode login Keloia
                                                                          Anda: 847291.
                                                                          Berlaku 5 menit."

3. User reads OTP on phone

4. POST /auth/verify-otp
   { phone: "628...", code: "847291" }
                           ├─ KV.get(otp:{phone})
                           │   → { code, attempts }
                           │
                           ├─ If attempts >= 3 → 429 "Terlalu banyak percobaan"
                           │
                           ├─ If code !== submitted
                           │   → KV.put(otp:{phone}, { code, attempts: attempts+1 })
                           │   → 401 "Kode salah"
                           │
                           ├─ If code matches:
                           │   ├─ Generate session token (crypto.randomUUID)
                           │   ├─ KV.put(session:{token},
                           │   │         { userId, tenantId, role, phone },
                           │   │         { expirationTtl: 604800 })  // 7 days
                           │   ├─ KV.delete(otp:{phone})  // one-time use
                           │   └─ Set-Cookie: keloia_session={token};
                           │       HttpOnly; Secure; SameSite=Strict;
                           │       Path=/; Max-Age=604800
                           │
                           └─ 200 { user: { name, role, tenantName } }

5. Browser stores cookie,
   redirects to dashboard
```

### 2c. Why This, Not JWT/OAuth/Magic Links

| Alternative | Why not for Keloia |
|---|---|
| **JWT** | Stateless tokens can't be revoked. If an admin's phone is stolen, we need instant session kill. KV sessions can be deleted immediately. |
| **OAuth (Google/Facebook)** | Users don't have Google Workspace accounts. Facebook login adds Meta dependency complexity for zero user benefit. |
| **Magic links (email)** | Users don't check email. WhatsApp IS their inbox. OTP via WhatsApp is a magic link that actually gets read. |
| **Password** | One more thing to forget. Password reset flow = another WhatsApp OTP anyway. Skip the middleman. |
| **Passkeys/WebAuthn** | Great future option, but requires browser support education for non-tech users. Revisit post-MVP. |

### 2d. Session Implementation

```typescript
// packages/dashboard-bff/src/auth/session.ts
import { ulid } from '@keloia/shared'

type Session = {
  userId: string
  tenantId: string
  role: 'owner' | 'admin' | 'driver'
  phone: string
  createdAt: number
}

const SESSION_TTL = 7 * 24 * 60 * 60 // 7 days in seconds

export async function createSession(
  kv: KVNamespace,
  user: { userId: string; tenantId: string; role: string; phone: string },
): Promise<string> {
  const token = crypto.randomUUID()
  const session: Session = { ...user, createdAt: Date.now() }
  await kv.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  })
  return token
}

export async function getSession(
  kv: KVNamespace,
  token: string,
): Promise<Session | null> {
  const raw = await kv.get(`session:${token}`)
  if (!raw) return null
  return JSON.parse(raw) as Session
}

export async function destroySession(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(`session:${token}`)
}

export function sessionCookie(token: string): string {
  return [
    `keloia_session=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${SESSION_TTL}`,
  ].join('; ')
}

export function clearCookie(): string {
  return 'keloia_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
}
```

**Why KV for sessions, not D1:** Sessions are read on *every single request*. KV reads are sub-millisecond from cache. D1 reads require a query round-trip. At dashboard scale this difference is small, but there's no reason to pay it. KV's built-in TTL also handles session expiry automatically — no cleanup cron needed.

---

## 3. Middleware Stack

Every dashboard API request passes through three middleware layers in order. If any layer rejects, the request never reaches the route handler.

```
Request → [Auth] → [Tenant] → [RBAC] → Route Handler → Response
```

### 3a. Auth Middleware — Who Are You?

```typescript
// packages/dashboard-bff/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { getSession } from '../auth/session'

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'keloia_session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const session = await getSession(c.env.SESSIONS, token)
  if (!session) return c.json({ error: 'Session expired' }, 401)

  // Attach to context — available in all downstream handlers
  c.set('session', session)
  c.set('tenantId', session.tenantId)
  c.set('userId', session.userId)
  c.set('role', session.role)

  await next()
})
```

After this middleware runs, every route handler can access `c.get('tenantId')` and `c.get('role')` without any further auth logic. The tenant ID is **never** read from URL params or request body — it's always derived from the authenticated session.

### 3b. RBAC Middleware — Are You Allowed?

```typescript
// packages/dashboard-bff/src/middleware/rbac.ts
import { createMiddleware } from 'hono/factory'

type Role = 'owner' | 'admin' | 'driver'

// Route → minimum required roles
// More specific overrides (e.g., "financials read-only for admin") happen inside route handlers
const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  'GET:/api/schedule':        ['owner', 'admin'],
  'GET:/api/schedule/:id':    ['owner', 'admin'],
  'GET:/api/assets':          ['owner', 'admin'],
  'GET:/api/assets/:id':      ['owner', 'admin'],
  'GET:/api/financials':      ['owner', 'admin'],
  'POST:/api/financials':     ['owner'],              // only owner records payments via dashboard
  'GET:/api/alerts':          ['owner', 'admin'],
  'POST:/api/pdf/trip/:id':   ['owner', 'admin'],
  'GET:/api/settings/team':   ['owner'],
  'PUT:/api/settings/team/:id': ['owner'],
  'POST:/api/bookings':       ['owner', 'admin'],
  'PUT:/api/bookings/:id':    ['owner', 'admin'],
}

export function rbac(...allowedRoles: Role[]) {
  return createMiddleware(async (c, next) => {
    const role = c.get('role') as Role

    if (!allowedRoles.includes(role)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    await next()
  })
}
```

**Usage in routes:**

```typescript
// Clean per-route RBAC — reads like a sentence
app.get('/api/schedule', rbac('owner', 'admin'), handleGetSchedule)
app.get('/api/settings/team', rbac('owner'), handleGetTeam)
app.put('/api/settings/team/:id', rbac('owner'), handleUpdateTeamMember)
```

**Why not a single permission map middleware?** The map-based approach (checking `${method}:${path}` against a table) breaks with parameterized routes — `/api/schedule/abc123` doesn't match `/api/schedule/:id` in a string comparison. Hono's middleware chaining with explicit `rbac(...)` per route is cleaner, type-safe, and impossible to misconfigure.

### 3c. Why No Driver Dashboard Access (MVP)

Drivers interact with Keloia exclusively via WhatsApp. Their information needs are simple: "What's my trip today?" and "I need to report an issue." Both are served faster via WhatsApp notification than by opening a browser.

Post-MVP, a driver-facing mobile view might show upcoming trips. But for MVP, dashboard = owner + admin only.

---

## 4. Hono App Structure

```typescript
// packages/dashboard-bff/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authMiddleware } from './middleware/auth'
import { rbac } from './middleware/rbac'
import { authRoutes } from './routes/auth'
import { scheduleRoutes } from './routes/schedule'
import { assetRoutes } from './routes/assets'
import { financialRoutes } from './routes/financials'
import { alertRoutes } from './routes/alerts'
import { settingsRoutes } from './routes/settings'
import { pdfRoutes } from './routes/pdf'

type Env = {
  Bindings: {
    CORE: Fetcher                  // Service Binding → core-domain
    SESSIONS: KVNamespace
    CACHE: KVNamespace
    R2_EXPORTS: R2Bucket           // PDF storage
    WA_OUTBOUND: Queue             // For OTP delivery
  }
}

const app = new Hono<{ Bindings: Env['Bindings'] }>()

// CORS — allow dashboard SPA origin
app.use('/api/*', cors({
  origin: ['https://dashboard.keloia.id', 'http://localhost:5173'],
  credentials: true,  // needed for cookie auth
}))

// Public routes (no auth)
app.route('/auth', authRoutes)

// Protected routes (auth + RBAC)
app.use('/api/*', authMiddleware)
app.route('/api', scheduleRoutes)
app.route('/api', assetRoutes)
app.route('/api', financialRoutes)
app.route('/api', alertRoutes)
app.route('/api', settingsRoutes)
app.route('/api', pdfRoutes)

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Hono RPC: export type for dashboard-ui type safety
export type AppType = typeof app
export default app
```

**Key decisions:**
- Auth routes (`/auth/*`) are outside the `authMiddleware` — obviously, you can't require login to log in.
- `cors({ credentials: true })` is required for the browser to send cookies cross-origin. Without this, the `keloia_session` cookie is silently dropped on every request from the SPA.
- The `AppType` export enables Hono RPC — the dashboard-ui imports this type at build time for fully typed API calls with zero codegen.

---

## 5. REST API Specification

### 5a. Auth Routes (Public)

```typescript
// packages/dashboard-bff/src/routes/auth.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const authRoutes = new Hono()

// Request OTP
authRoutes.post('/request-otp',
  zValidator('json', z.object({
    phone: z.string().regex(/^628\d{8,12}$/, 'Format: 628xxxxxxxxx'),
  })),
  async (c) => {
    const { phone } = c.req.valid('json')
    // ... resolve user, generate OTP, queue WA message
    return c.json({ message: 'OTP terkirim ke WhatsApp Anda' })
  },
)

// Verify OTP → create session
authRoutes.post('/verify-otp',
  zValidator('json', z.object({
    phone: z.string(),
    code: z.string().length(6),
  })),
  async (c) => {
    const { phone, code } = c.req.valid('json')
    // ... verify OTP, create session, set cookie
    return c.json({ user: { name, role, tenantName } })
  },
)

// Logout
authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, 'keloia_session')
  if (token) await destroySession(c.env.SESSIONS, token)
  c.header('Set-Cookie', clearCookie())
  return c.json({ message: 'Logged out' })
})

// Who am I? (used by SPA on page load to check existing session)
authRoutes.get('/me', async (c) => {
  const token = getCookie(c, 'keloia_session')
  if (!token) return c.json(null, 401)
  const session = await getSession(c.env.SESSIONS, token)
  if (!session) return c.json(null, 401)
  return c.json({
    userId: session.userId,
    role: session.role,
    tenantId: session.tenantId,
  })
})
```

### 5b. Schedule Routes

```typescript
// packages/dashboard-bff/src/routes/schedule.ts
import { Hono } from 'hono'
import { rbac } from '../middleware/rbac'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { withCache } from '../cache'

export const scheduleRoutes = new Hono()

// GET /api/schedule — today's bookings (or by date range)
scheduleRoutes.get('/schedule',
  rbac('owner', 'admin'),
  zValidator('query', z.object({
    date: z.string().optional(),           // ISO date, defaults to today
    from: z.string().optional(),           // range start
    to: z.string().optional(),             // range end
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
    busId: z.string().optional(),
  })),
  async (c) => {
    const query = c.req.valid('query')
    const tenantId = c.get('tenantId')
    const date = query.date ?? new Date().toISOString().split('T')[0]

    const cacheKey = `schedule:${tenantId}:${date}:${query.status ?? 'all'}:${query.busId ?? 'all'}`

    const data = await withCache(c.env.CACHE, cacheKey, 30, async () => {
      return callCore(c.env.CORE, '/internal/schedule', {
        tenantId,
        date: query.from ? undefined : date,
        from: query.from,
        to: query.to,
        status: query.status,
        busId: query.busId,
      })
    })

    return c.json(data)
  },
)

// GET /api/schedule/:id — single booking detail
scheduleRoutes.get('/schedule/:id',
  rbac('owner', 'admin'),
  async (c) => {
    const tenantId = c.get('tenantId')
    const bookingId = c.req.param('id')

    // No cache for single records — always fresh
    const data = await callCore(c.env.CORE, '/internal/schedule/detail', {
      tenantId,
      bookingId,
    })

    if (!data) return c.json({ error: 'Booking tidak ditemukan' }, 404)
    return c.json(data)
  },
)

// POST /api/bookings — create booking from dashboard
scheduleRoutes.post('/bookings',
  rbac('owner', 'admin'),
  zValidator('json', z.object({
    clientName: z.string().min(1),
    clientPhone: z.string().optional(),
    routeFrom: z.string().min(1),
    routeTo: z.string().min(1),
    departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    departTime: z.string().optional(),
    returnDate: z.string().optional(),
    busId: z.string().optional(),
    driverId: z.string().optional(),
    agreedPrice: z.number().int().positive().optional(),
    notes: z.string().optional(),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const result = await callCore(c.env.CORE, '/internal/bookings/create', {
      ...body,
      tenantId,
      createdBy: userId,
    })

    if (result.conflict) {
      return c.json({
        error: 'Konflik jadwal',
        detail: result.conflictDetail,
        suggestion: result.availableBuses,
      }, 409)
    }

    // Invalidate schedule cache for this date
    await invalidateCache(c.env.CACHE, `schedule:${tenantId}:${body.departDate}`)

    return c.json(result.booking, 201)
  },
)

// PUT /api/bookings/:id — update booking
scheduleRoutes.put('/bookings/:id',
  rbac('owner', 'admin'),
  zValidator('json', z.object({
    clientName: z.string().optional(),
    routeFrom: z.string().optional(),
    routeTo: z.string().optional(),
    departDate: z.string().optional(),
    departTime: z.string().optional(),
    busId: z.string().optional(),
    driverId: z.string().optional(),
    agreedPrice: z.number().int().positive().optional(),
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
    notes: z.string().optional(),
  })),
  async (c) => {
    const bookingId = c.req.param('id')
    const body = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const result = await callCore(c.env.CORE, '/internal/bookings/update', {
      ...body,
      bookingId,
      tenantId,
      updatedBy: userId,
    })

    if (!result.found) return c.json({ error: 'Booking tidak ditemukan' }, 404)
    if (result.conflict) return c.json({ error: 'Konflik jadwal', detail: result.conflictDetail }, 409)

    // Invalidate relevant cache entries
    await invalidateCache(c.env.CACHE, `schedule:${tenantId}:*`)

    return c.json(result.booking)
  },
)
```

### 5c. Asset Routes

```typescript
// packages/dashboard-bff/src/routes/assets.ts
import { Hono } from 'hono'
import { rbac } from '../middleware/rbac'

export const assetRoutes = new Hono()

// GET /api/assets — all buses with current status
assetRoutes.get('/assets',
  rbac('owner', 'admin'),
  async (c) => {
    const tenantId = c.get('tenantId')

    const data = await withCache(c.env.CACHE, `assets:${tenantId}`, 60, async () => {
      return callCore(c.env.CORE, '/internal/assets/list', { tenantId })
    })

    // Returns: [{ id, name, capacity, features, status, lastMaintenance, nextDue }]
    return c.json(data)
  },
)

// GET /api/assets/:id — single bus detail + maintenance history
assetRoutes.get('/assets/:id',
  rbac('owner', 'admin'),
  async (c) => {
    const tenantId = c.get('tenantId')
    const busId = c.req.param('id')

    const data = await callCore(c.env.CORE, '/internal/assets/detail', {
      tenantId,
      busId,
    })

    if (!data) return c.json({ error: 'Bus tidak ditemukan' }, 404)

    // Returns: { ...bus, maintenanceLogs: [...], upcomingBookings: [...] }
    return c.json(data)
  },
)
```

### 5d. Financial Routes

```typescript
// packages/dashboard-bff/src/routes/financials.ts
import { Hono } from 'hono'
import { rbac } from '../middleware/rbac'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const financialRoutes = new Hono()

// GET /api/financials — payment summary + receivables
financialRoutes.get('/financials',
  rbac('owner', 'admin'),
  zValidator('query', z.object({
    period: z.enum(['week', 'month', 'custom']).default('week'),
    from: z.string().optional(),
    to: z.string().optional(),
  })),
  async (c) => {
    const tenantId = c.get('tenantId')
    const role = c.get('role')
    const query = c.req.valid('query')

    const data = await callCore(c.env.CORE, '/internal/financials/summary', {
      tenantId,
      period: query.period,
      from: query.from,
      to: query.to,
    })

    // Admin sees read-only summary. Owner sees full detail.
    if (role === 'admin') {
      return c.json({
        totalIncome: data.totalIncome,
        totalBookings: data.totalBookings,
        // Strip detailed per-client breakdown and margins for admin
        receivables: data.receivables.map(({ clientName, outstanding }) => ({
          clientName,
          outstanding,
        })),
      })
    }

    // Owner gets everything
    return c.json(data)
  },
)

// POST /api/financials — record payment from dashboard (owner only)
financialRoutes.post('/financials',
  rbac('owner'),
  zValidator('json', z.object({
    bookingId: z.string(),
    amount: z.number().int().positive(),
    type: z.enum(['dp', 'pelunasan', 'refund', 'other']),
    method: z.string().optional(),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const result = await callCore(c.env.CORE, '/internal/financials/record', {
      ...body,
      tenantId,
      recordedBy: userId,
    })

    if (!result.bookingFound) return c.json({ error: 'Booking tidak ditemukan' }, 404)

    return c.json(result.payment, 201)
  },
)
```

### 5e. Alert Routes

```typescript
// packages/dashboard-bff/src/routes/alerts.ts
import { Hono } from 'hono'
import { rbac } from '../middleware/rbac'

export const alertRoutes = new Hono()

// GET /api/alerts — pending alerts for current user
alertRoutes.get('/alerts',
  rbac('owner', 'admin'),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const role = c.get('role')

    const data = await callCore(c.env.CORE, '/internal/alerts/pending', {
      tenantId,
      userId,
      role,
    })

    // Returns: [{ id, type, message, severity, createdAt, relatedEntity }]
    // type: 'booking_conflict' | 'payment_overdue' | 'maintenance_due' | 'unconfirmed_booking'
    return c.json(data)
  },
)

// PUT /api/alerts/:id/dismiss — mark alert as read
alertRoutes.put('/alerts/:id/dismiss',
  rbac('owner', 'admin'),
  async (c) => {
    const alertId = c.req.param('id')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    await callCore(c.env.CORE, '/internal/alerts/dismiss', {
      tenantId,
      alertId,
      dismissedBy: userId,
    })

    return c.json({ ok: true })
  },
)
```

### 5f. Settings Routes (Owner Only)

```typescript
// packages/dashboard-bff/src/routes/settings.ts
import { Hono } from 'hono'
import { rbac } from '../middleware/rbac'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const settingsRoutes = new Hono()

// GET /api/settings/team — list team members
settingsRoutes.get('/settings/team',
  rbac('owner'),
  async (c) => {
    const tenantId = c.get('tenantId')

    const data = await callCore(c.env.CORE, '/internal/team/list', { tenantId })

    // Returns: [{ userId, name, phone, role, createdAt }]
    return c.json(data)
  },
)

// PUT /api/settings/team/:id — update team member role
settingsRoutes.put('/settings/team/:id',
  rbac('owner'),
  zValidator('json', z.object({
    role: z.enum(['admin', 'driver']),
    name: z.string().optional(),
  })),
  async (c) => {
    const memberId = c.req.param('id')
    const body = c.req.valid('json')
    const tenantId = c.get('tenantId')

    // Prevent owner from demoting themselves
    if (memberId === c.get('userId')) {
      return c.json({ error: 'Tidak bisa mengubah role sendiri' }, 400)
    }

    const result = await callCore(c.env.CORE, '/internal/team/update', {
      tenantId,
      memberId,
      ...body,
    })

    if (!result.found) return c.json({ error: 'Anggota tidak ditemukan' }, 404)

    // Update phone lookup in KV (role may have changed)
    await c.env.SESSIONS // Note: PHONE_LOOKUP is in wa-bff, so this goes through core-domain
    // Core-domain handles KV update as side effect of role change

    return c.json(result.member)
  },
)
```

---

## 6. Service Binding — Calling Core Domain

### 6a. The Bridge Function

All data reads/writes go through a single function. The Dashboard BFF never touches D1 directly — it always calls `core-domain` via Service Binding.

```typescript
// packages/dashboard-bff/src/core-client.ts

export async function callCore<T>(
  core: Fetcher,
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await core.fetch(
    new Request(`http://core${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )

  if (!res.ok) {
    const error = await res.text().catch(() => 'Unknown error')
    throw new CoreError(res.status, error)
  }

  return res.json() as Promise<T>
}

class CoreError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`Core domain error ${status}: ${detail}`)
  }
}
```

**Why `http://core` as the URL?** Service Bindings don't make real HTTP calls. The URL is just a routing hint for Hono inside the core-domain Worker. `http://core/internal/schedule` → the core-domain Worker matches `/internal/schedule` and runs the handler. No DNS, no TLS, no network.

### 6b. Why Dashboard BFF Doesn't Touch D1

| Temptation | Why we resist |
|---|---|
| "Just read D1 directly, skip the hop" | Tenant isolation logic lives in core-domain. Bypassing it means duplicating `WHERE tenant_id = ?` in two places. One missed check = data leak. |
| "Only reads, no writes — safe to bypass" | Today it's reads. Tomorrow someone adds a filter. Business logic creeps in. The line blurs. Keep it clean: BFF = protocol, core = logic. |
| "Service Binding is slow" | It's in-process RPC. Same isolate. The overhead is a function call, not a network hop. Measured at <1ms added latency. |

---

## 7. Caching Strategy

### 7a. The Cache Layer

Dashboard data is read-heavy. Schedule views, bus status, payment summaries — the same queries repeat across page loads. We cache aggressively in KV with short TTLs.

```typescript
// packages/dashboard-bff/src/cache.ts

export async function withCache<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await kv.get(key)
  if (cached) return JSON.parse(cached) as T

  const fresh = await fetcher()
  // Non-blocking — don't wait for cache write to respond
  kv.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds })
  return fresh
}

export async function invalidateCache(
  kv: KVNamespace,
  pattern: string,
): Promise<void> {
  if (pattern.endsWith(':*')) {
    // KV doesn't support prefix delete natively.
    // For MVP: list keys with prefix, delete each.
    // At scale: switch to short TTLs and let expiry handle it.
    const prefix = pattern.replace(':*', ':')
    const keys = await kv.list({ prefix })
    await Promise.all(keys.keys.map((k) => kv.delete(k.name)))
  } else {
    await kv.delete(pattern)
  }
}
```

### 7b. TTL Strategy Per Resource

| Resource | TTL | Why |
|---|---|---|
| **Schedule (today)** | 30s | Changes frequently when bookings are added via WhatsApp. Short TTL keeps dashboard near-real-time without polling. |
| **Schedule (future dates)** | 60s | Less frequently updated. Slightly longer TTL reduces D1 reads. |
| **Bus list + status** | 60s | Bus inventory changes rarely. Status changes (available/booked) propagate within a minute. |
| **Financial summary** | 120s | Payment data changes when someone records a payment. 2-minute lag is acceptable for summary views. |
| **Alerts** | 0 (no cache) | Alerts are the "what needs attention now" view. Must always be fresh. |
| **Settings/team** | 0 (no cache) | Rarely accessed, must be accurate when accessed. |

### 7c. Cache Invalidation on Write

When the Dashboard BFF writes data (e.g., creates a booking), it proactively invalidates relevant cache keys:

```
POST /api/bookings (create booking for March 15)
  → core-domain writes to D1
  → dashboard-bff deletes KV key: schedule:{tenantId}:2026-03-15:*
  → next GET /api/schedule hits D1 (fresh data)
```

When data is written via WhatsApp BFF (e.g., driver reports bus issue), the dashboard cache is NOT proactively invalidated. It expires naturally via TTL. This is intentional — adding cross-BFF cache invalidation would couple the two systems. The 30-60s TTL window is acceptable for dashboard freshness.

---

## 8. PDF Generation

### 8a. MVP Approach — jsPDF (No Browser Rendering)

For MVP, we generate PDFs using `jsPDF` — a pure JavaScript PDF library that runs natively in Workers. No headless browser, no external service, no Puppeteer.

**Why not Cloudflare Browser Rendering?** Browser Rendering is powerful (render HTML → PDF via Puppeteer), but it's a paid addon and adds complexity. Our PDFs are structured documents (trip confirmations, payment receipts), not rendered web pages. `jsPDF` handles this natively.

```typescript
// packages/dashboard-bff/src/routes/pdf.ts
import { Hono } from 'hono'
import { rbac } from '../middleware/rbac'
import { jsPDF } from 'jspdf'

export const pdfRoutes = new Hono()

// POST /api/pdf/trip/:id — generate trip confirmation PDF
pdfRoutes.post('/pdf/trip/:id',
  rbac('owner', 'admin'),
  async (c) => {
    const tenantId = c.get('tenantId')
    const bookingId = c.req.param('id')

    // Fetch booking details from core-domain
    const booking = await callCore(c.env.CORE, '/internal/schedule/detail', {
      tenantId,
      bookingId,
    })

    if (!booking) return c.json({ error: 'Booking tidak ditemukan' }, 404)

    const pdf = generateTripConfirmation(booking, tenantId)

    // Store in R2 for later access
    const filename = `trip-${bookingId}-${Date.now()}.pdf`
    const r2Key = `${tenantId}/pdfs/${filename}`
    await c.env.R2_EXPORTS.put(r2Key, pdf)

    // Return presigned-style URL (R2 public bucket or signed URL)
    return c.json({
      filename,
      url: `/api/pdf/download/${r2Key}`,
    })
  },
)

// GET /api/pdf/download/:key — serve PDF from R2
pdfRoutes.get('/pdf/download/*',
  rbac('owner', 'admin'),
  async (c) => {
    const key = c.req.path.replace('/api/pdf/download/', '')
    const tenantId = c.get('tenantId')

    // Tenant isolation: key must start with the user's tenantId
    if (!key.startsWith(`${tenantId}/`)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const object = await c.env.R2_EXPORTS.get(key)
    if (!object) return c.json({ error: 'File tidak ditemukan' }, 404)

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
      },
    })
  },
)
```

### 8b. PDF Content Builder

```typescript
// packages/dashboard-bff/src/pdf/trip-confirmation.ts

export function generateTripConfirmation(
  booking: BookingDetail,
  tenantId: string,
): ArrayBuffer {
  const doc = new jsPDF()

  // Header
  doc.setFontSize(18)
  doc.text('KONFIRMASI TRIP', 105, 20, { align: 'center' })

  doc.setFontSize(10)
  doc.text(`Tanggal cetak: ${new Date().toLocaleDateString('id-ID')}`, 105, 28, { align: 'center' })

  // Booking details table
  doc.setFontSize(12)
  let y = 45

  const rows = [
    ['Klien', booking.clientName],
    ['No. HP Klien', booking.clientPhone ?? '-'],
    ['Rute', `${booking.routeFrom} → ${booking.routeTo}`],
    ['Tanggal Berangkat', formatDate(booking.departDate)],
    ['Jam Berangkat', booking.departTime ?? 'TBD'],
    ['Tanggal Kembali', booking.returnDate ? formatDate(booking.returnDate) : '-'],
    ['Bus', booking.busName ?? 'Belum ditentukan'],
    ['Supir', booking.driverName ?? 'Belum ditentukan'],
    ['Harga', booking.agreedPrice ? `Rp ${booking.agreedPrice.toLocaleString('id-ID')}` : 'TBD'],
    ['Status', booking.status.toUpperCase()],
  ]

  for (const [label, value] of rows) {
    doc.setFont(undefined, 'bold')
    doc.text(label, 20, y)
    doc.setFont(undefined, 'normal')
    doc.text(String(value), 80, y)
    y += 8
  }

  // Payment status
  if (booking.payments?.length) {
    y += 10
    doc.setFontSize(14)
    doc.text('Status Pembayaran', 20, y)
    y += 8
    doc.setFontSize(11)

    let totalPaid = 0
    for (const payment of booking.payments) {
      doc.text(
        `${payment.type.toUpperCase()} — Rp ${payment.amount.toLocaleString('id-ID')} (${formatDate(payment.paidAt)})`,
        25, y,
      )
      totalPaid += payment.amount
      y += 7
    }

    y += 5
    const outstanding = (booking.agreedPrice ?? 0) - totalPaid
    doc.setFont(undefined, 'bold')
    doc.text(`Total dibayar: Rp ${totalPaid.toLocaleString('id-ID')}`, 25, y)
    y += 7
    if (outstanding > 0) {
      doc.text(`Sisa: Rp ${outstanding.toLocaleString('id-ID')}`, 25, y)
    } else {
      doc.text('LUNAS', 25, y)
    }
  }

  // Footer
  doc.setFontSize(8)
  doc.setTextColor(150)
  doc.text('Dokumen ini dibuat otomatis oleh Keloia', 105, 285, { align: 'center' })
  doc.text(`Booking ID: ${booking.id}`, 105, 290, { align: 'center' })

  return doc.output('arraybuffer')
}
```

### 8c. Post-MVP: Browser Rendering Upgrade Path

When PDFs need branded headers, logos, or more complex layouts, upgrade to Cloudflare Browser Rendering:

```
HTML template (in R2 or inline) → Browser Rendering API → PDF → R2 → presigned URL
```

The route handler interface stays the same. Only the internal generation function changes. The SPA doesn't notice.

---

## 9. Error Handling

### 9a. Global Error Handler

```typescript
// packages/dashboard-bff/src/middleware/error-handler.ts
import { ErrorHandler } from 'hono'

export const errorHandler: ErrorHandler = (err, c) => {
  // Zod validation errors → 400
  if (err.name === 'ZodError') {
    return c.json({
      error: 'Validation failed',
      details: err.issues,
    }, 400)
  }

  // Core domain errors → forward status
  if (err instanceof CoreError) {
    return c.json({ error: err.detail }, err.status)
  }

  // Everything else → 500 (log, don't leak internals)
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}

// Register in app:
// app.onError(errorHandler)
```

### 9b. Error Response Shape

Every error response follows the same shape for the SPA to parse consistently:

```typescript
type ErrorResponse = {
  error: string               // Human-readable message (shown in UI)
  details?: unknown           // Optional structured detail (Zod issues, conflict info)
}
```

The SPA's React Query error handler checks for `response.error` on any non-2xx status and renders it in a toast.

---

## 10. SPA Integration — Hono RPC

### 10a. Type-Safe API Client

The dashboard-ui imports the BFF's types at build time. No OpenAPI spec, no code generation, no runtime schema.

```typescript
// packages/dashboard-ui/src/lib/api.ts
import type { AppType } from '@keloia/dashboard-bff'
import { hc } from 'hono/client'

export const api = hc<AppType>(
  import.meta.env.PROD
    ? 'https://api.keloia.id'
    : 'http://localhost:8787',
  {
    // Include cookies in cross-origin requests
    init: { credentials: 'include' },
  },
)

// Usage in components:
// const res = await api.api.schedule.$get({ query: { date: '2026-03-15' } })
// const bookings = await res.json()
// ^ fully typed — TypeScript knows the exact shape of the response
```

### 10b. React Query Integration

```typescript
// packages/dashboard-ui/src/hooks/use-schedule.ts
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useSchedule(date: string) {
  return useQuery({
    queryKey: ['schedule', date],
    queryFn: async () => {
      const res = await api.api.schedule.$get({ query: { date } })
      if (!res.ok) throw new Error('Failed to load schedule')
      return res.json()
    },
    refetchInterval: 30_000, // Re-fetch every 30s to stay near-real-time
    staleTime: 15_000,       // Consider data fresh for 15s
  })
}
```

**Why `refetchInterval: 30_000`?** The dashboard should feel "live" without WebSockets. Polling every 30 seconds aligns with the KV cache TTL (also 30s), so each poll gets fresh data. At MVP scale, this is ~2 requests/minute/user — negligible load.

---

## 11. CORS & Cookie Gotchas

### 11a. The Cross-Origin Cookie Problem

The dashboard SPA lives on `dashboard.keloia.id` (Cloudflare Pages). The BFF API lives on `api.keloia.id` (Cloudflare Worker). These are different origins — browsers block cookies by default on cross-origin requests.

The fix is a three-part configuration:

**1. BFF: CORS with `credentials: true`**
```typescript
app.use('/api/*', cors({
  origin: ['https://dashboard.keloia.id'],
  credentials: true,
}))
```

**2. BFF: Cookie with `SameSite=None; Secure`**

Wait — `SameSite=Strict` (from our session code) blocks cross-origin cookies entirely. If the SPA and API are on different subdomains, we need:

```
Set-Cookie: keloia_session={token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=604800
```

However, `SameSite=None` exposes us to CSRF. So we add:

**3. BFF: CSRF protection via `Origin` header check**
```typescript
// The CORS middleware already validates Origin.
// Additionally, for state-changing requests (POST/PUT/DELETE),
// verify the Origin header matches our allowed list.
```

### 11b. Alternative: Same-Domain Setup

To avoid the cross-origin cookie mess entirely, serve both SPA and API from the same domain:

```
dashboard.keloia.id/          → Cloudflare Pages (SPA)
dashboard.keloia.id/api/*     → Cloudflare Worker (BFF)
```

Cloudflare supports this via Workers Routes — a Worker can intercept requests matching a pattern on the same domain as a Pages project. This lets us use `SameSite=Strict` (most secure) since everything is same-origin.

**This is the recommended MVP approach.** Cross-origin cookies are a debugging nightmare.

---

## 12. Wrangler Config (Complete)

```toml
# packages/dashboard-bff/wrangler.toml
name = "keloia-dashboard-bff"
main = "src/index.ts"
compatibility_date = "2025-01-01"

# Serve API under the same domain as the Pages SPA
routes = [
  { pattern = "dashboard.keloia.id/api/*", zone_name = "keloia.id" },
  { pattern = "dashboard.keloia.id/auth/*", zone_name = "keloia.id" },
]

# Service Binding to core-domain
[[services]]
binding = "CORE"
service = "keloia-core-domain"

# KV namespaces
[[kv_namespaces]]
binding = "SESSIONS"
id = "xxx"

[[kv_namespaces]]
binding = "CACHE"
id = "yyy"

[[kv_namespaces]]
binding = "PHONE_LOOKUP"
id = "zzz"

# R2 for PDF exports
[[r2_buckets]]
binding = "R2_EXPORTS"
bucket_name = "keloia-exports"

# Queue for OTP delivery via WhatsApp
[[queues.producers]]
binding = "WA_OUTBOUND"
queue = "keloia-wa-outbound"

# Secrets (set via `wrangler secret put`):
# (none for dashboard-bff — auth uses KV sessions, no signing keys needed)
```

---

## 13. File Structure (Final)

```
packages/dashboard-bff/
├── src/
│   ├── index.ts                  # Hono app, route mounting, AppType export
│   ├── auth/
│   │   ├── otp.ts                # OTP generation, verification, rate limiting
│   │   └── session.ts            # KV session CRUD, cookie helpers
│   ├── middleware/
│   │   ├── auth.ts               # Session verification middleware
│   │   ├── rbac.ts               # Role-based access control
│   │   └── error-handler.ts      # Global error handler
│   ├── routes/
│   │   ├── auth.ts               # /auth/* (public: OTP, verify, logout, me)
│   │   ├── schedule.ts           # /api/schedule, /api/bookings
│   │   ├── assets.ts             # /api/assets
│   │   ├── financials.ts         # /api/financials
│   │   ├── alerts.ts             # /api/alerts
│   │   ├── settings.ts           # /api/settings/team (owner only)
│   │   └── pdf.ts                # /api/pdf/* (generate + download)
│   ├── pdf/
│   │   └── trip-confirmation.ts  # jsPDF template for trip PDFs
│   ├── cache.ts                  # KV cache helpers (withCache, invalidate)
│   ├── core-client.ts            # Service Binding wrapper
│   └── types.ts                  # Dashboard-specific types
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## 14. What This Doc Does NOT Cover (Next Deep Dives)

| Topic | What's Needed | Doc |
|---|---|---|
| **Core Domain Worker** | Booking conflict detection, payment linking, alert evaluation, Service Binding API shape | `keloia-core-domain-deep-dive.md` |
| **Dashboard UI** | React component structure, page layouts, React Query hooks, real-time polling UX | `keloia-dashboard-ui-deep-dive.md` |
| **AI Processor** | Full prompt engineering, confidence calibration, multi-turn clarification | `keloia-ai-processor-deep-dive.md` |
| **Onboarding Flow** | Tenant creation, invite code system, first-user setup | `keloia-onboarding-deep-dive.md` |
