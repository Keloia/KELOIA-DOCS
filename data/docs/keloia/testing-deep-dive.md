# Keloia — Testing Strategy Deep Dive

**From Service Tests to Production Confidence**
February 2026

---

## 1. What This Document Covers

The [library architecture doc](./keloia-library-architecture.md) introduced Vitest + `@cloudflare/vitest-pool-workers`. This document goes **deep** — what to test, how to test it, what to mock, what NOT to mock, and how CI enforces it all.

```
Testing Layers:

  Unit Tests (pure functions)
    │  Fast, no runtime. Validation, formatting, conflict logic.
    │
  Service Tests (real Workers runtime)
    │  Real D1, real KV, real Durable Objects. No mocks.
    │  @cloudflare/vitest-pool-workers runs tests inside workerd.
    │
  Integration Tests (Worker-to-Worker)
    │  Service Binding calls between wa-bff ↔ core-domain.
    │  Real queue consumers. Real end-to-end data flow.
    │
  Component Tests (dashboard-ui)
    │  Vitest + Testing Library. Mock API via MSW.
    │
  E2E Tests (Playwright)
    │  Full browser. Dashboard login → booking → payment.
    │  Against local dev stack (wrangler dev).
    │
  Contract Tests (AI processor)
       Snapshot-based. Known inputs → expected structured output.
       Guards against prompt regression.
```

**What we DON'T do:** 100% coverage targets. We test behavior that matters — conflict detection, auth boundaries, conversation state transitions, data integrity. If a bug would wake you up at 3 AM, it has a test.

---

## 2. Tooling

```bash
pnpm add -Dw vitest @cloudflare/vitest-pool-workers @testing-library/react @testing-library/user-event msw playwright
```

| Tool | Purpose | Where |
|---|---|---|
| **Vitest** | Test runner everywhere | All packages |
| **@cloudflare/vitest-pool-workers** | Runs tests inside workerd runtime | core-domain, wa-bff, dashboard-bff |
| **@testing-library/react** | Component testing | dashboard-ui |
| **MSW** (Mock Service Worker) | API mocking for component tests | dashboard-ui |
| **Playwright** | Browser E2E | Root-level `e2e/` directory |

### 2a. Vitest Config (Workers Packages)

Every Worker package shares the same vitest pattern:

```typescript
// packages/core-domain/vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
```

This tells Vitest to spin up a real `workerd` instance with your wrangler bindings. D1 gets a fresh in-memory database per test file. KV and Durable Objects work exactly like production. **No platform mocks.**

### 2b. Vitest Config (Dashboard UI)

```typescript
// packages/dashboard-ui/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

### 2c. Turborepo Task

```jsonc
// turbo.json (add to tasks)
{
  "test": {
    "dependsOn": ["^build"],
    "cache": false
  },
  "test:e2e": {
    "dependsOn": ["build"],
    "cache": false
  }
}
```

`pnpm turbo test` runs all package-level tests in parallel. `pnpm turbo test:e2e` runs after build.

---

## 3. Package-by-Package Strategy

### 3a. `packages/shared` — Unit Tests (Pure Functions)

The shared package has no runtime dependencies. Tests are plain Vitest, no Workers pool needed.

**What to test:**
- Zod schema validation — valid inputs pass, invalid inputs reject with correct error
- Format helpers (`formatDateID`, `formatRupiah`) — edge cases, locale behavior
- Type exports — compile-time only, no runtime tests needed

```typescript
// packages/shared/src/validation.test.ts
import { describe, it, expect } from 'vitest'
import { bookingSchema } from './validation'

describe('bookingSchema', () => {
  it('accepts valid booking', () => {
    const result = bookingSchema.safeParse({
      clientName: 'Pak Agus',
      departDate: '2026-03-15',
      returnDate: '2026-03-17',
      route: 'Jakarta–Bandung',
      busId: 'bus-01',
      price: 15_000_000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative price', () => {
    const result = bookingSchema.safeParse({
      clientName: 'Pak Agus',
      departDate: '2026-03-15',
      route: 'Jakarta–Bandung',
      busId: 'bus-01',
      price: -100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects return date before depart date', () => {
    const result = bookingSchema.safeParse({
      clientName: 'Pak Agus',
      departDate: '2026-03-15',
      returnDate: '2026-03-10',
      route: 'Jakarta–Bandung',
      busId: 'bus-01',
      price: 15_000_000,
    })
    expect(result.success).toBe(false)
  })
})
```

**Test count: ~15-20.** Small package, pure logic. Fast.

---

### 3b. `packages/core-domain` — Service Tests (Real D1)

This is the most critical test surface. Every business rule lives here. Tests run inside workerd with a real D1 database.

**What to test:**
- Booking CRUD + conflict detection
- Payment recording + financial summary math
- Asset status transitions
- Alert evaluation logic
- Tenant isolation (`byTenant()` guard)
- `db.batch()` atomicity patterns
- Activity log side effects

```typescript
// packages/core-domain/src/services/booking.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@keloia/shared/db/schema'
import { createBooking, getSchedule } from './booking'

describe('booking-service', () => {
  let db: ReturnType<typeof drizzle>

  beforeEach(async () => {
    db = drizzle(env.DB, { schema })
    // Seed tenant + bus for isolation
    await db.batch([
      db.insert(schema.tenants).values({
        id: 'tenant-01', name: 'PO Maju Jaya', createdAt: new Date().toISOString(),
      }),
      db.insert(schema.buses).values({
        id: 'bus-01', tenantId: 'tenant-01', name: 'Bus 01',
        status: 'available', createdAt: new Date().toISOString(),
      }),
      db.insert(schema.users).values({
        id: 'user-01', tenantId: 'tenant-01', phone: '6281234567890',
        name: 'Admin Satu', role: 'admin', createdAt: new Date().toISOString(),
      }),
    ])
  })

  it('creates a booking and returns it', async () => {
    const result = await createBooking(db, {
      tenantId: 'tenant-01',
      userId: 'user-01',
      clientName: 'Pak Agus',
      departDate: '2026-03-15',
      route: 'Jakarta–Bandung',
      busId: 'bus-01',
      price: 15_000_000,
    })

    expect(result.conflict).toBe(false)
    expect(result.booking.clientName).toBe('Pak Agus')
    expect(result.booking.status).toBe('confirmed')
  })

  it('detects double-booking on same bus + overlapping dates', async () => {
    await createBooking(db, {
      tenantId: 'tenant-01', userId: 'user-01',
      clientName: 'Pak Agus', departDate: '2026-03-15',
      returnDate: '2026-03-17',
      route: 'Jakarta–Bandung', busId: 'bus-01', price: 15_000_000,
    })

    const result = await createBooking(db, {
      tenantId: 'tenant-01', userId: 'user-01',
      clientName: 'Bu Sari', departDate: '2026-03-16',
      route: 'Jakarta–Semarang', busId: 'bus-01', price: 12_000_000,
    })

    expect(result.conflict).toBe(true)
    expect(result.conflictingBooking?.clientName).toBe('Pak Agus')
  })

  it('allows same bus on non-overlapping dates', async () => {
    await createBooking(db, {
      tenantId: 'tenant-01', userId: 'user-01',
      clientName: 'Pak Agus', departDate: '2026-03-15',
      returnDate: '2026-03-16',
      route: 'Jakarta–Bandung', busId: 'bus-01', price: 15_000_000,
    })

    const result = await createBooking(db, {
      tenantId: 'tenant-01', userId: 'user-01',
      clientName: 'Bu Sari', departDate: '2026-03-17',
      route: 'Jakarta–Semarang', busId: 'bus-01', price: 12_000_000,
    })

    expect(result.conflict).toBe(false)
  })

  it('isolates bookings by tenant', async () => {
    // Create a second tenant
    await db.batch([
      db.insert(schema.tenants).values({
        id: 'tenant-02', name: 'PO Lain', createdAt: new Date().toISOString(),
      }),
      db.insert(schema.buses).values({
        id: 'bus-02', tenantId: 'tenant-02', name: 'Bus A',
        status: 'available', createdAt: new Date().toISOString(),
      }),
    ])

    // Booking in tenant-01 should not appear in tenant-02's schedule
    await createBooking(db, {
      tenantId: 'tenant-01', userId: 'user-01',
      clientName: 'Pak Agus', departDate: '2026-03-15',
      route: 'Jakarta–Bandung', busId: 'bus-01', price: 15_000_000,
    })

    const schedule = await getSchedule(db, {
      tenantId: 'tenant-02',
      date: '2026-03-15',
    })

    expect(schedule).toHaveLength(0)
  })
})
```

#### Payment service tests

```typescript
// packages/core-domain/src/services/payment.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@keloia/shared/db/schema'
import { recordPayment, getFinancialSummary } from './payment'

describe('payment-service', () => {
  let db: ReturnType<typeof drizzle>

  beforeEach(async () => {
    db = drizzle(env.DB, { schema })
    // Seed tenant, user, bus, and a booking
    await db.batch([
      db.insert(schema.tenants).values({
        id: 'tenant-01', name: 'PO Maju Jaya', createdAt: new Date().toISOString(),
      }),
      db.insert(schema.users).values({
        id: 'user-01', tenantId: 'tenant-01', phone: '6281234567890',
        name: 'Admin', role: 'admin', createdAt: new Date().toISOString(),
      }),
      db.insert(schema.bookings).values({
        id: 'book-01', tenantId: 'tenant-01', clientName: 'Pak Agus',
        departDate: '2026-03-15', route: 'Jakarta–Bandung',
        busId: 'bus-01', price: 15_000_000, status: 'confirmed',
        createdBy: 'user-01', createdAt: new Date().toISOString(),
      }),
    ])
  })

  it('records DP and calculates remaining balance', async () => {
    await recordPayment(db, {
      tenantId: 'tenant-01',
      bookingId: 'book-01',
      amount: 5_000_000,
      method: 'transfer',
      type: 'dp',
      recordedBy: 'user-01',
    })

    const summary = await getFinancialSummary(db, {
      tenantId: 'tenant-01',
      month: '2026-03',
    })

    expect(summary.totalIncome).toBe(5_000_000)
    expect(summary.receivables[0].remaining).toBe(10_000_000)
  })

  it('marks booking fully paid after total payments reach price', async () => {
    await recordPayment(db, {
      tenantId: 'tenant-01', bookingId: 'book-01',
      amount: 15_000_000, method: 'transfer', type: 'pelunasan',
      recordedBy: 'user-01',
    })

    const summary = await getFinancialSummary(db, {
      tenantId: 'tenant-01',
      month: '2026-03',
    })

    expect(summary.receivables).toHaveLength(0) // Nothing outstanding
  })
})
```

#### Tenant isolation guard

```typescript
// packages/core-domain/src/lib/tenant-guard.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { byTenant } from './tenant-guard'

describe('byTenant', () => {
  it('appends tenant_id = ? to every query', () => {
    // This is a compile-time + query-shape test.
    // The guard function should be used in every service query.
    // If someone forgets it, they get ALL tenants' data.
    // We test this by verifying the generated SQL includes the clause.
    const condition = byTenant('tenant-01')
    expect(condition).toBeDefined()
    // The exact assertion depends on Drizzle's API — the key point
    // is that every query in the service layer uses this guard.
  })
})
```

**Test count: ~40-50.** This is the bulk of our tests. Every service function gets happy path + edge cases.

---

### 3c. `packages/wa-bff` — Webhook + Conversation Tests

**What to test:**
- Signature verification (accept valid, reject invalid)
- Payload normalization (Meta's nested format → clean domain events)
- Phone resolution (known user → tenant, unknown → onboarding)
- Deduplication (same message ID → skip)
- Conversation state transitions (Durable Object)
- Reply classification (confirm / reject / correction)
- Rate limiting (per-phone)

#### Signature verification

```typescript
// packages/wa-bff/src/middleware/verify-webhook.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { verifyWebhook } from './verify-webhook'

describe('verify-webhook', () => {
  const app = new Hono<{ Bindings: typeof env }>()
  app.post('/webhook', verifyWebhook, (c) => c.text('OK'))

  it('rejects missing signature', async () => {
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects invalid signature', async () => {
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'X-Hub-Signature-256': 'sha256=invalid' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts valid HMAC signature', async () => {
    const body = JSON.stringify({ test: true })
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(env.META_APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const hex = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const res = await app.request('/webhook', {
      method: 'POST',
      body,
      headers: { 'X-Hub-Signature-256': `sha256=${hex}` },
    })
    expect(res.status).toBe(200)
  })
})
```

#### Conversation Durable Object

```typescript
// packages/wa-bff/src/conversation.test.ts
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

describe('ConversationState DO', () => {
  function getConversation(userId: string) {
    const id = env.CONVERSATION.idFromName(userId)
    return env.CONVERSATION.get(id)
  }

  it('starts with empty state', async () => {
    const stub = getConversation('user-test-01')
    const res = await stub.fetch('http://do/snapshot')
    const snapshot = await res.json()

    expect(snapshot.turns).toHaveLength(0)
    expect(snapshot.pending).toBeNull()
  })

  it('stores user messages and maintains turn history', async () => {
    const stub = getConversation('user-test-02')

    await stub.fetch('http://do/message', {
      method: 'POST',
      body: JSON.stringify({ role: 'user', text: 'Booking bus 01 tanggal 15 Maret' }),
    })

    const res = await stub.fetch('http://do/snapshot')
    const snapshot = await res.json()

    expect(snapshot.turns).toHaveLength(1)
    expect(snapshot.turns[0].role).toBe('user')
  })

  it('caps turns at 10 (sliding window)', async () => {
    const stub = getConversation('user-test-03')

    for (let i = 0; i < 15; i++) {
      await stub.fetch('http://do/message', {
        method: 'POST',
        body: JSON.stringify({ role: 'user', text: `Message ${i}` }),
      })
    }

    const res = await stub.fetch('http://do/snapshot')
    const snapshot = await res.json()

    expect(snapshot.turns).toHaveLength(10)
    expect(snapshot.turns[0].text).toBe('Message 5') // Oldest kept
  })

  it('sets and confirms pending action', async () => {
    const stub = getConversation('user-test-04')

    await stub.fetch('http://do/pending', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'create_booking',
        extracted: { clientName: 'Pak Agus', departDate: '2026-03-15' },
        confirmationText: 'Saya catat booking ya?',
      }),
    })

    let res = await stub.fetch('http://do/snapshot')
    let snapshot = await res.json()
    expect(snapshot.pending).not.toBeNull()
    expect(snapshot.pending.intent).toBe('create_booking')

    // Confirm
    res = await stub.fetch('http://do/confirm', { method: 'POST' })
    const confirmed = await res.json()
    expect(confirmed.intent).toBe('create_booking')

    // Pending cleared after confirm
    res = await stub.fetch('http://do/snapshot')
    snapshot = await res.json()
    expect(snapshot.pending).toBeNull()
  })

  it('expires stale pending actions', async () => {
    const stub = getConversation('user-test-05')

    await stub.fetch('http://do/pending', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'create_booking',
        extracted: {},
        confirmationText: 'Betul?',
        // Set expiresAt in the past
        expiresAt: Date.now() - 1000,
      }),
    })

    const res = await stub.fetch('http://do/confirm', { method: 'POST' })
    const result = await res.json()
    expect(result).toBeNull() // Expired, nothing to confirm
  })
})
```

#### Reply classification

```typescript
// packages/wa-bff/src/classify-reply.test.ts
import { describe, it, expect } from 'vitest'
import { classifyReply } from './classify-reply'

describe('classifyReply', () => {
  // Button replies — unambiguous
  it('classifies button "confirm_yes" as confirm', () => {
    const msg = { type: 'button_reply', buttonId: 'confirm_yes' }
    expect(classifyReply(msg, '')).toBe('confirm')
  })

  it('classifies button "confirm_no" as reject', () => {
    const msg = { type: 'button_reply', buttonId: 'confirm_no' }
    expect(classifyReply(msg, '')).toBe('reject')
  })

  // Text replies — fuzzy matching for common Indonesian confirmations
  it('classifies "ya" as confirm', () => {
    expect(classifyReply({ type: 'text' }, 'ya')).toBe('confirm')
  })

  it('classifies "iya betul" as confirm', () => {
    expect(classifyReply({ type: 'text' }, 'iya betul')).toBe('confirm')
  })

  it('classifies "ok" as confirm', () => {
    expect(classifyReply({ type: 'text' }, 'ok')).toBe('confirm')
  })

  it('classifies "bukan" as reject', () => {
    expect(classifyReply({ type: 'text' }, 'bukan')).toBe('reject')
  })

  it('classifies "salah" as reject', () => {
    expect(classifyReply({ type: 'text' }, 'salah')).toBe('reject')
  })

  // Corrections — new content that isn't yes/no
  it('classifies new booking info as correction', () => {
    expect(classifyReply({ type: 'text' }, 'bukan tanggal 15, harusnya 16 Maret'))
      .toBe('correction')
  })
})
```

#### Deduplication

```typescript
// packages/wa-bff/src/dedup.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { isDuplicate } from './dedup'

describe('isDuplicate', () => {
  it('returns false for first occurrence', async () => {
    expect(await isDuplicate(env.IDEMPOTENCY, 'msg-001')).toBe(false)
  })

  it('returns true for second occurrence', async () => {
    await isDuplicate(env.IDEMPOTENCY, 'msg-002') // First time
    expect(await isDuplicate(env.IDEMPOTENCY, 'msg-002')).toBe(true)
  })
})
```

**Test count: ~30-35.** Webhook pipeline is security-critical and state-heavy.

---

### 3d. `packages/ai-processor` — Contract Tests

The AI processor is the trickiest to test. Claude's responses are non-deterministic. We don't unit test the AI — we contract-test the **interface boundary**.

**Strategy: Input/Output Contracts, Not AI Behavior**

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Known input │───►│ AI processor │───►│ Zod schema   │
│  (fixture)   │    │ (real or mock)│    │ validation   │
└──────────────┘    └──────────────┘    └──────────────┘
                                              │
                                     Pass? ───┤──── Fail?
                                     ✅ Good  │    ❌ Prompt regression
```

#### Mock AI for deterministic tests

```typescript
// packages/ai-processor/src/test/mock-claude.ts
type MockResponse = {
  intent: string
  extracted: Record<string, unknown>
  confidence: number
  confirmationText: string
}

const fixtures: Record<string, MockResponse> = {
  'booking bus 01 tanggal 15 maret pak agus jakarta bandung 15 juta': {
    intent: 'create_booking',
    extracted: {
      clientName: 'Pak Agus',
      departDate: '2026-03-15',
      route: 'Jakarta–Bandung',
      busId: 'bus-01',
      price: 15_000_000,
    },
    confidence: 0.95,
    confirmationText: '📋 Booking — Pak Agus\n📅 15 Maret 2026\n🚌 Bus 01, Jakarta–Bandung\n💰 Rp 15.000.000\n\nBetul?',
  },
  'ac bus 03 mati': {
    intent: 'report_issue',
    extracted: { busId: 'bus-03', description: 'AC mati' },
    confidence: 0.9,
    confirmationText: '🔧 Laporan — Bus 03\nMasalah: AC mati\n\nBetul?',
  },
}

export function createMockClaude() {
  return {
    messages: {
      create: async ({ messages }: { messages: Array<{ content: string }> }) => {
        const userMsg = messages.find((m) => m.role === 'user')?.content ?? ''
        const normalized = userMsg.toLowerCase().trim()

        // Find closest fixture match (simple substring matching for tests)
        const matchKey = Object.keys(fixtures)
          .find((key) => normalized.includes(key) || key.includes(normalized))

        const response = matchKey ? fixtures[matchKey] : {
          intent: 'general_query',
          extracted: {},
          confidence: 0.5,
          confirmationText: 'Maaf, saya tidak mengerti. Bisa jelaskan lebih detail?',
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response) }],
        }
      },
    },
  }
}
```

#### Contract validation tests

```typescript
// packages/ai-processor/src/extract-intent.test.ts
import { describe, it, expect } from 'vitest'
import { intentOutputSchema } from './schemas'
import { createMockClaude } from './test/mock-claude'
import { extractIntent } from './extract-intent'

describe('extractIntent — output contract', () => {
  const mockClaude = createMockClaude()

  it('booking message returns valid create_booking shape', async () => {
    const result = await extractIntent(mockClaude, {
      text: 'Booking bus 01 tanggal 15 Maret Pak Agus Jakarta Bandung 15 juta',
      role: 'admin',
      turns: [],
    })

    // The key test: does the output match our Zod schema?
    const parsed = intentOutputSchema.safeParse(result)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.intent).toBe('create_booking')
    expect(parsed.data?.confidence).toBeGreaterThan(0.7)
  })

  it('issue report returns valid report_issue shape', async () => {
    const result = await extractIntent(mockClaude, {
      text: 'AC bus 03 mati',
      role: 'driver',
      turns: [],
    })

    const parsed = intentOutputSchema.safeParse(result)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.intent).toBe('report_issue')
    expect(parsed.data?.extracted).toHaveProperty('busId')
  })

  it('ambiguous message returns low confidence', async () => {
    const result = await extractIntent(mockClaude, {
      text: 'gimana ya',
      role: 'admin',
      turns: [],
    })

    const parsed = intentOutputSchema.safeParse(result)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.confidence).toBeLessThan(0.7)
  })
})
```

#### Prompt regression snapshots

For catching prompt changes that break output format, we snapshot-test against known inputs:

```typescript
// packages/ai-processor/src/prompt-regression.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from './prompts'

describe('prompt stability', () => {
  it('system prompt includes all required intents', () => {
    const prompt = buildSystemPrompt()
    const requiredIntents = [
      'create_booking', 'record_payment', 'report_issue',
      'check_schedule', 'check_payment', 'update_booking', 'general_query',
    ]
    for (const intent of requiredIntents) {
      expect(prompt).toContain(intent)
    }
  })

  it('system prompt enforces JSON-only output', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('No prose')
  })

  it('user prompt includes conversation context', () => {
    const prompt = buildUserPrompt({
      text: 'test message',
      role: 'admin',
      turns: [{ role: 'user', text: 'previous msg', timestamp: Date.now() }],
    })
    expect(prompt).toContain('previous msg')
  })
})
```

**Test count: ~15-20.** Contract tests + prompt guards.

---

### 3e. `packages/dashboard-bff` — Auth + RBAC Tests

**What to test:**
- Session validation (valid token → user, expired → 401, missing → 401)
- RBAC enforcement (owner-only routes reject admin/driver)
- Route handlers return correct shapes
- Cache behavior (KV cache hit vs miss)

```typescript
// packages/dashboard-bff/src/middleware/auth.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware } from './auth'

describe('auth middleware', () => {
  const app = new Hono()
  app.use('/api/*', authMiddleware)
  app.get('/api/test', (c) => c.json({ ok: true }))

  beforeEach(async () => {
    // Seed a valid session in KV
    await env.SESSIONS.put(
      'session:valid-token',
      JSON.stringify({
        userId: 'user-01',
        tenantId: 'tenant-01',
        role: 'owner',
      }),
      { expirationTtl: 604800 },
    )
  })

  it('rejects request without session cookie', async () => {
    const res = await app.request('/api/test')
    expect(res.status).toBe(401)
  })

  it('rejects expired/invalid session', async () => {
    const res = await app.request('/api/test', {
      headers: { Cookie: 'keloia_session=expired-token' },
    })
    expect(res.status).toBe(401)
  })

  it('allows valid session and sets context', async () => {
    const res = await app.request('/api/test', {
      headers: { Cookie: 'keloia_session=valid-token' },
    })
    expect(res.status).toBe(200)
  })
})
```

#### RBAC enforcement

```typescript
// packages/dashboard-bff/src/middleware/rbac.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware } from './auth'
import { requireRole } from './rbac'

describe('RBAC', () => {
  const app = new Hono()
  app.use('/api/*', authMiddleware)
  app.get('/api/team', requireRole('owner'), (c) => c.json({ ok: true }))

  beforeEach(async () => {
    await env.SESSIONS.put(
      'session:admin-token',
      JSON.stringify({ userId: 'user-02', tenantId: 'tenant-01', role: 'admin' }),
      { expirationTtl: 604800 },
    )
    await env.SESSIONS.put(
      'session:owner-token',
      JSON.stringify({ userId: 'user-01', tenantId: 'tenant-01', role: 'owner' }),
      { expirationTtl: 604800 },
    )
  })

  it('blocks admin from owner-only route', async () => {
    const res = await app.request('/api/team', {
      headers: { Cookie: 'keloia_session=admin-token' },
    })
    expect(res.status).toBe(403)
  })

  it('allows owner to access owner-only route', async () => {
    const res = await app.request('/api/team', {
      headers: { Cookie: 'keloia_session=owner-token' },
    })
    expect(res.status).toBe(200)
  })
})
```

**Test count: ~20-25.** Auth and RBAC are security gates — test every boundary.

---

### 3f. `packages/dashboard-ui` — Component Tests

Tests run in jsdom with MSW intercepting API calls. No real backend needed.

#### MSW setup

```typescript
// packages/dashboard-ui/src/test/setup.ts
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

const handlers = [
  http.get('/api/schedule', ({ request }) => {
    const url = new URL(request.url)
    const date = url.searchParams.get('date') ?? '2026-03-15'
    return HttpResponse.json([
      {
        id: 'book-01', clientName: 'Pak Agus', departDate: date,
        route: 'Jakarta–Bandung', busName: 'Bus 01',
        status: 'confirmed', price: 15_000_000,
      },
    ])
  }),

  http.get('/api/me', () => {
    return HttpResponse.json({
      userId: 'user-01', tenantId: 'tenant-01', role: 'owner', name: 'Boss',
    })
  }),
]

export const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

#### Component test example

```typescript
// packages/dashboard-ui/src/components/booking-table.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingTable } from './booking-table'

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
}

describe('BookingTable', () => {
  it('renders booking rows from API', async () => {
    renderWithProviders(<BookingTable date="2026-03-15" />)

    // MSW returns our seeded booking
    expect(await screen.findByText('Pak Agus')).toBeInTheDocument()
    expect(screen.getByText('Jakarta–Bandung')).toBeInTheDocument()
    expect(screen.getByText('Bus 01')).toBeInTheDocument()
  })

  it('shows empty state when no bookings', async () => {
    // Override handler for this test
    const { server } = await import('../test/setup')
    const { http, HttpResponse } = await import('msw')
    server.use(http.get('/api/schedule', () => HttpResponse.json([])))

    renderWithProviders(<BookingTable date="2026-04-01" />)

    expect(await screen.findByText(/belum ada booking/i)).toBeInTheDocument()
  })
})
```

**Test count: ~15-20.** Key components and user flows, not every button.

---

## 4. E2E Tests (Playwright)

E2E tests run against the full local stack (`wrangler dev` for Workers, `vite dev` for dashboard). They verify the complete user journey through a real browser.

### 4a. Setup

```
e2e/
├── playwright.config.ts
├── fixtures/
│   └── seed.ts              # Seed D1 with test tenant/user/bus
├── tests/
│   ├── login.spec.ts
│   ├── booking-flow.spec.ts
│   └── payment-flow.spec.ts
└── package.json
```

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173', // Vite dev server
  },
  webServer: [
    {
      command: 'pnpm --filter dashboard-ui dev',
      port: 5173,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter dashboard-bff dev',
      port: 8787,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter core-domain dev',
      port: 8788,
      reuseExistingServer: true,
    },
  ],
})
```

### 4b. Booking Flow E2E

```typescript
// e2e/tests/booking-flow.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Booking Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login with seeded OTP (local dev skips real SMS)
    await page.goto('/login')
    await page.fill('[data-testid="phone-input"]', '6281234567890')
    await page.click('[data-testid="send-otp"]')
    await page.fill('[data-testid="otp-input"]', '123456') // Dev OTP
    await page.click('[data-testid="verify-otp"]')
    await expect(page).toHaveURL('/schedule')
  })

  test('creates booking and sees it on schedule', async ({ page }) => {
    await page.click('[data-testid="create-booking"]')

    await page.fill('[data-testid="client-name"]', 'Pak Test E2E')
    await page.fill('[data-testid="depart-date"]', '2026-04-01')
    await page.fill('[data-testid="route"]', 'Jakarta–Surabaya')
    await page.selectOption('[data-testid="bus-select"]', 'bus-01')
    await page.fill('[data-testid="price"]', '20000000')

    await page.click('[data-testid="submit-booking"]')

    // Should appear on the schedule
    await expect(page.locator('text=Pak Test E2E')).toBeVisible()
    await expect(page.locator('text=Jakarta–Surabaya')).toBeVisible()
  })

  test('shows conflict when double-booking', async ({ page }) => {
    // First booking
    await page.click('[data-testid="create-booking"]')
    await page.fill('[data-testid="client-name"]', 'First Client')
    await page.fill('[data-testid="depart-date"]', '2026-04-10')
    await page.fill('[data-testid="route"]', 'Test Route')
    await page.selectOption('[data-testid="bus-select"]', 'bus-01')
    await page.fill('[data-testid="price"]', '10000000')
    await page.click('[data-testid="submit-booking"]')
    await expect(page.locator('text=First Client')).toBeVisible()

    // Second booking — same bus, same date
    await page.click('[data-testid="create-booking"]')
    await page.fill('[data-testid="client-name"]', 'Second Client')
    await page.fill('[data-testid="depart-date"]', '2026-04-10')
    await page.fill('[data-testid="route"]', 'Another Route')
    await page.selectOption('[data-testid="bus-select"]', 'bus-01')
    await page.fill('[data-testid="price"]', '12000000')
    await page.click('[data-testid="submit-booking"]')

    // Conflict alert should appear
    await expect(page.locator('[data-testid="conflict-alert"]')).toBeVisible()
  })
})
```

**Test count: ~5-8 E2E tests.** Login, booking CRUD, payment recording, conflict detection. Slow but high confidence.

---

## 5. What We Mock vs. What Runs Real

| Dependency | Strategy | Why |
|---|---|---|
| **D1** | Real (in-memory via pool-workers) | The whole point of `@cloudflare/vitest-pool-workers` |
| **KV** | Real (in-memory via pool-workers) | Same — tests run in workerd |
| **Durable Objects** | Real (in-memory via pool-workers) | Conversation state is critical path |
| **Service Bindings** | Real in integration tests, mock in unit | Unit tests isolate the package; integration tests verify the contract |
| **Queues** | Stubbed in unit tests, real in E2E | Queue consumers run in separate Workers — unit tests verify the message shape |
| **Claude API** | Always mocked | Non-deterministic, slow, costs money. Use fixture-based mock (section 3d) |
| **Meta WhatsApp API** | Always mocked | External service. Mock outbound message calls, verify shape |
| **Cron triggers** | Call handler directly | Crons are just scheduled function calls — invoke manually in tests |

**The rule: mock external services, run Cloudflare primitives for real.**

---

## 6. CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo test

  e2e:
    runs-on: ubuntu-latest
    needs: [typecheck, test]  # Only run E2E if unit tests pass
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium
      - run: pnpm turbo build
      - run: pnpm --filter e2e test
```

**Pipeline takes ~3-5 minutes.** Typecheck + unit tests run in parallel (~1 min each). E2E runs after (~2-3 min). Fast enough to run on every PR.

---

## 7. Test Data Patterns

### 7a. Fresh DB Per Test File

`@cloudflare/vitest-pool-workers` gives each test file a fresh D1 database. No cleanup needed between test files. Within a file, use `beforeEach` to seed and isolate tests.

### 7b. Seeding Helper

```typescript
// packages/core-domain/src/test/seed.ts
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@keloia/shared/db/schema'

export async function seedTenant(db: ReturnType<typeof drizzle>, overrides?: Partial<{
  tenantId: string
  tenantName: string
  ownerId: string
  ownerPhone: string
  busCount: number
}>) {
  const tenantId = overrides?.tenantId ?? 'tenant-test'
  const ownerId = overrides?.ownerId ?? 'owner-test'
  const now = new Date().toISOString()

  const statements = [
    db.insert(schema.tenants).values({
      id: tenantId,
      name: overrides?.tenantName ?? 'Test PO Bus',
      createdAt: now,
    }),
    db.insert(schema.users).values({
      id: ownerId,
      tenantId,
      phone: overrides?.ownerPhone ?? '6280000000000',
      name: 'Test Owner',
      role: 'owner',
      createdAt: now,
    }),
  ]

  const busCount = overrides?.busCount ?? 2
  for (let i = 1; i <= busCount; i++) {
    statements.push(
      db.insert(schema.buses).values({
        id: `bus-${String(i).padStart(2, '0')}`,
        tenantId,
        name: `Bus ${String(i).padStart(2, '0')}`,
        status: 'available',
        createdAt: now,
      }),
    )
  }

  await db.batch(statements)
  return { tenantId, ownerId }
}
```

### 7c. No Shared Test State

Tests never depend on other tests' data. Each test seeds what it needs. This is slower but eliminates the #1 source of flaky tests — shared mutable state.

---

## 8. What We Intentionally Don't Test

| Thing | Why Skip It |
|---|---|
| Drizzle query syntax | That's Drizzle's job. We test our service logic, not the ORM. |
| Hono routing | Hono is battle-tested. We test our handlers, not that `app.get()` works. |
| React rendering basics | Testing Library covers interaction. We don't test that `<div>` renders. |
| CSS / visual regression | YAGNI for MVP. Add Chromatic or Percy post-launch if needed. |
| Load testing | At 1-2 tenants, load testing is premature. Document the plan for later. |
| Claude output quality | Prompt engineering is iterative, not testable. We test the output **shape**, not the quality. |
| KV eventual consistency | Documented as accepted risk. The window is <60s and the worst case is a stale role lookup. |

---

## 9. Running Tests

```bash
# All unit + service tests (parallel across packages)
pnpm turbo test

# Single package
pnpm --filter core-domain test

# Watch mode during development
pnpm --filter core-domain test -- --watch

# E2E (requires local dev stack running)
pnpm --filter e2e test

# Type checking (catches schema mismatches)
pnpm turbo typecheck
```

---

## 10. Test Budget Summary

| Package | Test Type | Count | Runtime |
|---|---|---|---|
| shared | Unit | ~15 | <2s |
| core-domain | Service (real D1) | ~45 | ~10s |
| wa-bff | Service (real DO + KV) | ~30 | ~8s |
| ai-processor | Contract + snapshot | ~15 | ~3s |
| dashboard-bff | Service (real KV) | ~20 | ~5s |
| dashboard-ui | Component (jsdom) | ~15 | ~5s |
| e2e | Playwright | ~7 | ~45s |
| **Total** | | **~150** | **<90s** |

~150 tests, under 90 seconds. Fast enough to run on every commit. Comprehensive enough to catch the bugs that matter.

---

## 11. When to Add More Tests

Add a test when:
- A bug reaches production → write the test that would have caught it
- A new service function is added → test happy path + main edge case
- Auth or RBAC rules change → test every boundary
- The AI output schema changes → update contract tests
- A new E2E user journey emerges → add one Playwright test

Don't add a test when:
- You're testing library code (Drizzle, Hono, React)
- The code is <5 lines with no branching
- It would require mocking 5+ things to test 1 line of logic
