# Keloia — Library & Architecture Decisions

**Tech Stack for Fast Delivery**
February 2026

---

## 1. Guiding Principles

Every choice here follows three rules:

1. **One way to do things** — no two libraries solving the same problem
2. **Cloudflare-native first** — if CF has a primitive for it, use it
3. **Type safety end-to-end** — from DB schema to WhatsApp response, TypeScript catches errors before runtime

---

## 2. The Stack

```
┌─────────────────────────────────────────────────────┐
│  RUNTIME          Cloudflare Workers                │
│  FRAMEWORK        Hono                              │
│  ORM              Drizzle ORM (D1 dialect)          │
│  VALIDATION       Zod                               │
│  DASHBOARD UI     React + Vite (CF Pages)           │
│  AI               Anthropic SDK (@anthropic-ai/sdk) │
│  MONOREPO         pnpm workspaces + Turborepo       │
│  LANGUAGE         TypeScript (strict mode)           │
└─────────────────────────────────────────────────────┘
```

---

## 3. Library Decisions

### 3a. Hono — API Framework (all Workers)

**Why Hono, not raw Workers:**
- Built by a Cloudflare employee, used internally by CF for D1, KV, Queues, Workers Logs
- First-class bindings access via typed generics (`Hono<{ Bindings: Env }>`)
- Built-in middleware: CORS, auth, logging, rate limiting — no reinventing
- `hono/validator` + Zod = request validation in one line
- ~14KB minified, zero dependencies

**Why not Express/Fastify:** They need Node.js. Workers run on V8, not Node.

**Key feature — Hono RPC:**
```typescript
// dashboard-bff defines routes with typed responses
const routes = app
  .get('/api/schedule', async (c) => c.json(await getSchedule(c)))
  .get('/api/assets', async (c) => c.json(await getAssets(c)))

export type AppType = typeof routes

// dashboard-ui imports the TYPE (zero runtime cost)
import type { AppType } from '@keloia/dashboard-bff'
import { hc } from 'hono/client'

const client = hc<AppType>('/') // full autocomplete, type-safe
const schedule = await client.api.schedule.$get()
```

This gives us end-to-end type safety between BFF and SPA with zero codegen, no GraphQL, no OpenAPI. Change a return type in the BFF → TypeScript error in the SPA immediately.

### 3b. Drizzle ORM — Database (D1)

**Why Drizzle, not raw SQL:**
- Schema-as-code: TypeScript types derived from schema definition, not manually maintained
- D1-native: uses `drizzle-orm/d1` driver, no adapter hacks
- Migration generation via `drizzle-kit generate` → SQL files → `wrangler d1 migrations apply`
- Relational queries without raw JOINs
- ~40KB, no heavy runtime

**Why not Prisma:** Prisma needs a binary engine (~15MB), doesn't run natively in Workers. Drizzle is pure TypeScript.

**Why not raw D1:** Manual SQL is fine for 5 queries. We have ~30+ across three pillars. Type-safe queries prevent "column name typo" bugs that take hours to debug in production.

**Schema example (replaces raw SQL from architecture doc):**
```typescript
// packages/core-domain/src/db/schema.ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const tenants = sqliteTable('tenants', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const bookings = sqliteTable('bookings', {
  id:          text('id').primaryKey(),
  tenantId:    text('tenant_id').notNull().references(() => tenants.id),
  clientName:  text('client_name').notNull(),
  clientPhone: text('client_phone'),
  routeFrom:   text('route_from').notNull(),
  routeTo:     text('route_to').notNull(),
  departDate:  text('depart_date').notNull(),
  departTime:  text('depart_time'),
  returnDate:  text('return_date'),
  busId:       text('bus_id').references(() => buses.id),
  driverId:    text('driver_id').references(() => users.id),
  status:      text('status', { enum: ['pending','confirmed','completed','cancelled'] })
                 .notNull().default('pending'),
  agreedPrice: integer('agreed_price'),
  notes:       text('notes'),
  createdBy:   text('created_by').references(() => users.id),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_bookings_tenant_date').on(table.tenantId, table.departDate),
  index('idx_bookings_bus_date').on(table.busId, table.departDate),
])

// TypeScript types auto-derived:
// type Booking = typeof bookings.$inferSelect
// type NewBooking = typeof bookings.$inferInsert
```

**Migration workflow:**
```bash
# Generate migration from schema changes
pnpm drizzle-kit generate

# Apply locally
pnpm wrangler d1 migrations apply keloia-db --local

# Apply to production
pnpm wrangler d1 migrations apply keloia-db --remote
```

### 3c. Zod — Validation

**Why Zod:** Already a dependency of both Hono (`hono/validator`) and Drizzle (`drizzle-zod`). One validation library, three uses:

1. **Request validation** (Hono middleware):
```typescript
import { zValidator } from '@hono/zod-validator'

app.post('/api/bookings',
  zValidator('json', createBookingSchema),
  async (c) => { /* validated body */ }
)
```

2. **AI output parsing** (structured extraction):
```typescript
const intentSchema = z.object({
  intent: z.enum(['create_booking', 'record_payment', 'report_issue']),
  confidence: z.number(),
  extracted: z.record(z.unknown()),
})
// Parse Claude's response safely
const result = intentSchema.safeParse(aiResponse)
```

3. **Schema-to-Zod** (Drizzle integration):
```typescript
import { createInsertSchema } from 'drizzle-zod'
const insertBookingSchema = createInsertSchema(bookings)
// Reuse DB schema as API validation — zero duplication
```

### 3d. React + Vite — Dashboard UI

**Why React:** Largest ecosystem for hiring and components. The dashboard is simple CRUD views — React is more than enough.

**Why Vite:** Cloudflare's official Vite plugin (`@cloudflare/vite-plugin`) gives local dev with real Workers bindings. No mocking.

**Why not Next.js/Remix:** Overkill. The dashboard is a client-side SPA that calls the Dashboard BFF. No SSR needed — the BFF does all data fetching. Pages hosts static assets for free.

**Styling: Tailwind CSS.** Utility-first, no context switching to CSS files. Pairs with shadcn/ui for pre-built accessible components (dialogs, tables, dropdowns) without a heavy component library.

**Key libraries:**
| Library | Purpose | Why |
|---|---|---|
| `hono/client` | API client | Type-safe RPC from BFF types, zero codegen |
| `@tanstack/react-query` | Server state | Caching, refetching, loading states — solves 80% of dashboard data concerns |
| `tailwindcss` | Styling | Utility-first, no CSS files, fast iteration |
| `shadcn/ui` | Components | Copy-paste components, no version lock-in |
| `date-fns` | Date formatting | Lightweight, tree-shakeable (vs moment.js) |

### 3e. Anthropic SDK — AI Processing

**Why `@anthropic-ai/sdk`:** Official SDK, works in Workers (uses `fetch` internally, no Node deps).

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: INTENT_EXTRACTION_PROMPT,
  messages: [{ role: 'user', content: userMessage }],
})
```

**Cost control:** Sonnet for intent extraction (~$3/1M input tokens). No need for Opus — structured extraction is Sonnet's sweet spot.

### 3f. WhatsApp — Direct Meta API

**No SDK.** The Meta WhatsApp Business API is simple REST. A thin wrapper (~50 lines) is cleaner than pulling a third-party SDK:

```typescript
// packages/wa-bff/src/wa-client.ts
export async function sendMessage(env: Env, to: string, text: string) {
  await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })
}
```

---

## 4. Monorepo Structure

```
keloia/
├── packages/
│   ├── shared/                  # Shared types, Drizzle schema, Zod schemas
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # Drizzle table definitions (source of truth)
│   │   │   │   └── index.ts
│   │   │   ├── types.ts               # Domain types (derived from schema)
│   │   │   └── validation.ts          # Shared Zod schemas (API + AI)
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   │
│   ├── core-domain/             # Business logic Worker
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   ├── booking.ts
│   │   │   │   ├── payment.ts
│   │   │   │   ├── asset.ts
│   │   │   │   ├── alert.ts
│   │   │   │   └── tenant.ts
│   │   │   └── index.ts              # Hono app, Service Binding target
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   ├── wa-bff/                  # WhatsApp BFF Worker
│   │   ├── src/
│   │   │   ├── webhook.ts
│   │   │   ├── wa-client.ts           # Thin Meta API wrapper
│   │   │   ├── conversation.ts        # Durable Object
│   │   │   └── index.ts              # Hono app
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   ├── ai-processor/            # AI Queue Consumer Worker
│   │   ├── src/
│   │   │   ├── extract-intent.ts
│   │   │   ├── prompts.ts
│   │   │   └── index.ts
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   ├── dashboard-bff/           # Dashboard API Worker
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── schedule.ts
│   │   │   │   ├── assets.ts
│   │   │   │   ├── financials.ts
│   │   │   │   └── settings.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   └── rbac.ts
│   │   │   └── index.ts              # Hono app, exports AppType
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── dashboard-ui/            # React SPA (CF Pages)
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   └── main.tsx
│       ├── vite.config.ts
│       └── package.json
│
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json           # Shared TS config, extended by each package
└── package.json
```

### Why `shared/` package exists

The original architecture doc inlines types into `core-domain`. Problem: `dashboard-ui` needs the same types for Hono RPC, and `ai-processor` needs the same Zod schemas for output parsing. Extracting `shared/` keeps everything DRY:

```
shared/db/schema.ts    → core-domain (queries), dashboard-bff (types), drizzle-kit (migrations)
shared/types.ts        → everyone
shared/validation.ts   → dashboard-bff (request validation), ai-processor (output parsing)
```

One schema change → all consumers update → TypeScript catches mismatches at build time.

---

## 5. Monorepo Config

### 5a. `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
```

### 5b. `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "deploy": {
      "dependsOn": ["build"]
    },
    "db:generate": {
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

### 5c. `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "paths": {
      "@keloia/shared": ["./packages/shared/src"],
      "@keloia/shared/*": ["./packages/shared/src/*"]
    }
  }
}
```

Each package extends this:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

---

## 6. Dependency Map

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  dashboard-ui ──(hono/client types)──→ dashboard-bff     │
│       │                                     │            │
│       │                                     │            │
│       └──────────→ shared ←─────────────────┘            │
│                      ↑                                   │
│                      │                                   │
│          ┌───────────┼───────────┐                       │
│          │           │           │                       │
│      wa-bff    core-domain  ai-processor                 │
│          │           │           │                       │
│          └───────────┼───────────┘                       │
│                      │                                   │
│              Service Bindings                            │
│              (wa-bff, dashboard-bff → core-domain)       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Compile-time dependencies** (types only, no runtime import):
- `dashboard-ui` → `dashboard-bff` (Hono RPC types)
- Every package → `shared` (schemas, types, validation)

**Runtime dependencies** (Service Bindings):
- `wa-bff` → `core-domain`
- `dashboard-bff` → `core-domain`

---

## 7. Dev Workflow

### Local development

```bash
# Start all workers + dashboard in parallel
pnpm turbo dev

# Each package runs its own dev command:
# wa-bff:        wrangler dev
# dashboard-bff: wrangler dev
# core-domain:   wrangler dev
# ai-processor:  wrangler dev
# dashboard-ui:  vite dev (with @cloudflare/vite-plugin)
```

Wrangler runs `workerd` locally with real D1, KV, Durable Objects, Queues emulation. No Docker, no local Postgres. What runs locally IS what runs in production.

### Database changes

```bash
# 1. Edit packages/shared/src/db/schema.ts
# 2. Generate migration
cd packages/shared && pnpm drizzle-kit generate
# 3. Apply locally
pnpm wrangler d1 migrations apply keloia-db --local
# 4. Apply to prod (after merge)
pnpm wrangler d1 migrations apply keloia-db --remote
```

### Deploy

```bash
# Deploy all workers
pnpm turbo deploy

# Or deploy individually
cd packages/wa-bff && pnpm wrangler deploy
cd packages/dashboard-ui && pnpm wrangler pages deploy dist
```

---

## 8. Full Dependency List Per Package

### `packages/shared`
```json
{
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.0"
  }
}
```

### `packages/core-domain`
```json
{
  "dependencies": {
    "@keloia/shared": "workspace:*",
    "hono": "^4.7.0",
    "drizzle-orm": "^0.44.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

### `packages/wa-bff`
```json
{
  "dependencies": {
    "@keloia/shared": "workspace:*",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

### `packages/ai-processor`
```json
{
  "dependencies": {
    "@keloia/shared": "workspace:*",
    "@anthropic-ai/sdk": "^0.39.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

### `packages/dashboard-bff`
```json
{
  "dependencies": {
    "@keloia/shared": "workspace:*",
    "hono": "^4.7.0",
    "@hono/zod-validator": "^0.5.0",
    "drizzle-orm": "^0.44.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

### `packages/dashboard-ui`
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "hono": "^4.7.0",
    "@tanstack/react-query": "^5.0.0",
    "date-fns": "^4.0.0"
  },
  "devDependencies": {
    "@keloia/dashboard-bff": "workspace:*",
    "@cloudflare/vite-plugin": "^1.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

Note: `dashboard-bff` is a **devDependency** of `dashboard-ui` — it's only used for type imports via Hono RPC. No runtime code is pulled in.

---

## 9. What We're NOT Using (And Why)

| Rejected | Why |
|---|---|
| **GraphQL** | Hono RPC gives type-safe API calls with zero schema overhead. GraphQL adds complexity we don't need for a single SPA consumer. |
| **Prisma** | Binary engine doesn't run in Workers. Drizzle is pure TS, D1-native. |
| **tRPC** | Great, but Hono RPC does the same thing and we're already using Hono. One less dependency. |
| **Next.js / Remix** | SSR is unnecessary — the dashboard is an internal tool. A pure SPA on Pages is simpler and cheaper. |
| **Express / Fastify** | Node.js frameworks. Workers run on V8, not Node. Hono is purpose-built for this. |
| **Moment.js** | 300KB. `date-fns` is tree-shakeable, import only what you use. |
| **Axios** | Workers have native `fetch`. Zero reason for an HTTP client library. |
| **Jest** | Vitest + `@cloudflare/vitest-pool-workers` runs tests in the actual Workers runtime. |
| **Separate OpenAPI spec** | Hono can auto-generate OpenAPI from Zod schemas if we ever need it. YAGNI for now. |
| **WhatsApp SDK** | The API is ~3 endpoints. A 50-line wrapper is cleaner than a dependency. |

---

## 10. Testing Strategy

```bash
pnpm add -Dw vitest @cloudflare/vitest-pool-workers
```

**Why `@cloudflare/vitest-pool-workers`:** Tests run inside the actual Workers runtime (workerd), not Node.js. D1 queries, KV lookups, Durable Object calls — all real. No mocking the platform.

```typescript
// packages/core-domain/src/services/booking.test.ts
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { createBooking, getSchedule } from './booking'

describe('booking-service', () => {
  it('detects double-booking on same bus + date', async () => {
    const db = drizzle(env.DB)
    await createBooking(db, { busId: 'bus-01', departDate: '2026-03-15', ... })
    
    const result = await createBooking(db, { busId: 'bus-01', departDate: '2026-03-15', ... })
    expect(result.conflict).toBe(true)
  })
})
```

---

## 11. MVP Build Order

Sequenced to deliver value at each step:

```
Week 1-2:  shared (schema + types) → core-domain (booking CRUD + conflict detection)
Week 3:    wa-bff (webhook + confirm-before-log) → ai-processor (intent extraction)
Week 4:    dashboard-bff (schedule + assets read) → dashboard-ui (schedule view)
Week 5:    Integration testing, first PO Bus partner onboarding
Week 6:    Payment tracking, alert service, polish
```

Each week produces a testable increment. Week 3 = WhatsApp booking flow works end-to-end. Week 4 = dashboard shows real data.

---

## 12. Summary — Why This Stack

| Concern | Solution | Benefit |
|---|---|---|
| Type safety DB → API → UI | Drizzle schema → Zod validation → Hono RPC | Change a column name, get errors everywhere instantly |
| Cloudflare-native | Hono + Wrangler + D1 + KV + DO | Zero cold start, local dev = production, free tier covers MVP |
| Fast iteration | pnpm + Turbo + Vite | `pnpm turbo dev` starts everything, hot reload everywhere |
| Minimal dependencies | ~10 core libs total | Less to learn, less to break, less to update |
| Team onboarding | Standard tools (React, Tailwind, TypeScript) | New developer productive in days, not weeks |

Total new-to-learn surface: **Hono** (if you know Express, you know Hono) and **Drizzle** (if you know SQL, you know Drizzle). Everything else is standard TypeScript/React.
