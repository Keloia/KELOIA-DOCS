# Keloia System Architecture

**BFF Pattern on Cloudflare**
February 2026

---

## 1. Architecture Overview

Keloia uses the **Backend-for-Frontend (BFF)** pattern with two distinct frontends — WhatsApp and Web Dashboard — each served by a dedicated BFF Worker. Both BFFs share a common domain core via Service Bindings, keeping business logic DRY while letting each frontend handle its own protocol concerns.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE EDGE                              │
│                                                                     │
│  ┌──────────────┐          ┌──────────────┐                         │
│  │  WhatsApp     │          │  Dashboard    │                        │
│  │  BFF Worker   │          │  BFF Worker   │                        │
│  │              │          │              │                        │
│  │  • Webhook    │          │  • REST API   │                        │
│  │  • Msg Parse  │          │  • Auth/RBAC  │                        │
│  │  • WA Format  │          │  • PDF Gen    │                        │
│  └──────┬───────┘          └──────┬───────┘                         │
│         │    Service Bindings     │                                  │
│         └──────────┬──────────────┘                                  │
│                    ▼                                                 │
│  ┌─────────────────────────────────────────┐                        │
│  │         Core Domain Worker              │                        │
│  │                                         │                        │
│  │  booking-service  │  payment-service     │                        │
│  │  asset-service    │  alert-service       │                        │
│  │  tenant-service   │  permission-service  │                        │
│  └──────────┬──────────────────┬───────────┘                        │
│             │                  │                                     │
│     ┌───────┴────┐    ┌───────┴─────┐                               │
│     │   D1 (SQL) │    │  KV (Cache) │                               │
│     └────────────┘    └─────────────┘                               │
│                                                                     │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────────┐             │
│  │  Queue       │  │ R2 (Files) │  │ Durable Objects  │             │
│  │  (Async)     │  │ (PDFs)     │  │ (Conversations)  │             │
│  └─────────────┘  └────────────┘  └──────────────────┘             │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │  Cron Triggers (Scheduled Jobs)      │                           │
│  │  • Morning briefings                 │                           │
│  │  • Maintenance reminders             │                           │
│  │  • Payment follow-ups                │                           │
│  └──────────────────────────────────────┘                           │
│                                                                     │
│  ┌──────────────┐                                                   │
│  │  Pages (SPA) │  ← Dashboard frontend                            │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘

External:
  • Meta WhatsApp Business API (inbound/outbound messages)
  • Anthropic Claude API (NLU + intent extraction)
```

---

## 2. Why BFF for Keloia

The two frontends have fundamentally different interaction models:

| Concern | WhatsApp BFF | Dashboard BFF |
|---|---|---|
| **Protocol** | Webhook (Meta sends POST) | REST API (SPA fetches) |
| **Auth** | Phone number → tenant lookup | Session token + RBAC |
| **Input shape** | Free-form Indonesian text | Structured API calls |
| **Response format** | WhatsApp message (text, buttons, lists) | JSON for React components |
| **Latency model** | Async — user tolerates 2-5s for AI | Sync — dashboard must feel instant |
| **State** | Conversation flow (confirm-before-log) | Stateless request/response |

A single API trying to serve both would leak WhatsApp concerns into the dashboard and vice versa. BFF keeps each thin and focused.

---

## 3. Cloudflare Primitives Mapping

| Cloudflare Service | Keloia Role | Why This, Not That |
|---|---|---|
| **Workers** | BFF layers + Core Domain | Runs at edge, zero cold start, Service Bindings for internal RPC |
| **D1** | Primary database (three pillars) | SQLite at edge, free tier generous for SME scale, no connection pooling needed |
| **KV** | Session cache, rate limits, phone→tenant lookup | Sub-millisecond reads, perfect for auth hot path |
| **Durable Objects** | Conversation state per user | Single-threaded actor model — perfect for confirm-before-log flow where order matters |
| **Queues** | Async: AI calls, outbound WA messages, alerts | Decouples webhook response from slow AI processing |
| **R2** | PDF storage, export files | S3-compatible, no egress fees, serves PDFs via presigned URLs |
| **Pages** | Dashboard SPA hosting | Automatic deploys, CDN-backed, pairs with Workers for API |
| **Cron Triggers** | Scheduled alerts, daily briefings | Native to Workers, no external scheduler needed |

---

## 4. Worker Topology

### 4a. WhatsApp BFF Worker (`wa-bff`)

Responsibilities: webhook verification, message parsing, WhatsApp-specific formatting, conversation orchestration.

```
POST /webhook (from Meta)
  │
  ├─ Verify signature (X-Hub-Signature-256)
  ├─ Parse message type (text, button reply, list reply)
  ├─ KV.get(phone_number) → resolve tenant + user role
  │
  ├─ If in active conversation flow:
  │    └─ DurableObject.getConversation(userId)
  │         → process reply in context (e.g., user confirms booking)
  │         → Service Binding → core-domain (write confirmed data)
  │
  ├─ If new message:
  │    └─ Queue.send({ type: "process_message", payload })
  │         → AI Worker picks up, extracts intent
  │         → Returns structured action
  │         → DurableObject stores pending confirmation
  │         → Outbound WA message: "Saya catat sebagai booking ya?"
  │
  └─ Respond 200 to Meta (within 5s SLA)
```

Key design: the webhook handler responds `200` immediately, then processes asynchronously via Queue. This prevents Meta from retrying due to timeout.

### 4b. Dashboard BFF Worker (`dashboard-bff`)

Responsibilities: authentication, RBAC enforcement, JSON API for the SPA, PDF generation trigger.

```
Routes:
  GET  /api/schedule          → today's bookings, calendar view
  GET  /api/schedule/:id      → single booking detail
  GET  /api/assets            → bus list with status
  GET  /api/assets/:id        → single bus detail + maintenance log
  GET  /api/financials        → payment summary, receivables
  GET  /api/alerts            → pending alerts for this user
  POST /api/pdf/trip/:id      → generate trip confirmation PDF
  GET  /api/settings/team     → team members + permissions (owner only)
  PUT  /api/settings/team/:id → update permissions (owner only)

Middleware:
  1. Auth: verify session token (KV-backed sessions)
  2. Tenant: extract tenant_id from session
  3. RBAC: check user.role against route permission map
  4. Service Binding → core-domain (all data reads/writes)
```

### 4c. Core Domain Worker (`core-domain`)

Responsibilities: ALL business logic. Both BFFs call this via Service Bindings (in-process RPC, no network hop).

```
Services (modules, not separate workers):
  ├─ booking-service
  │    • createBooking, updateBooking, getSchedule
  │    • conflictDetection (overlapping dates + same bus)
  │    • statusTransitions (pending → confirmed → completed)
  │
  ├─ payment-service
  │    • recordPayment (DP, pelunasan, refund)
  │    • getOutstandingByClient, getWeeklySummary
  │    • linkPaymentToBooking
  │
  ├─ asset-service
  │    • updateBusStatus, logMaintenance
  │    • getAvailableBuses(dateRange)
  │    • checkMaintenanceDue → returns overdue items
  │
  ├─ alert-service
  │    • evaluateAlerts (called after any state change)
  │    • queueAlert → Queue → outbound WA message
  │    • morning briefing generator
  │
  ├─ tenant-service
  │    • onboarding, team member registration
  │    • phone number → (tenant_id, user_id, role) mapping
  │
  └─ permission-service
       • role definitions: owner, admin, driver
       • per-role visibility rules (financial hidden from drivers)
       • owner can customize via dashboard
```

### 4d. AI Processing Worker (`ai-processor`)

Consumes from Queue. Isolated so AI latency doesn't block anything.

```
Queue message: { type: "process_message", tenantId, userId, text, conversationId }

Pipeline:
  1. Load conversation context from Durable Object
  2. Build prompt with:
     - System: Keloia intent extraction rules
     - Context: recent conversation turns, user role, tenant data
     - User message: the raw text
  3. Call Claude API → structured response:
     {
       intent: "create_booking",
       confidence: 0.92,
       extracted: {
         client: "Pak Agus",
         date: "2026-03-15",
         route: "Jogja-Semarang",
         bus: "Bus 01",
         price: 15000000
       },
       confirmation_message: "Saya catat sebagai: Booking — Pak Agus, ..."
     }
  4. Store pending action in Durable Object
  5. Queue outbound WhatsApp message (confirmation prompt)
```

---

## 5. Data Architecture

### 5a. D1 Schema (Core Tables)

```sql
-- Multi-tenant isolation via tenant_id on every table

-- TENANT & USERS
CREATE TABLE tenants (
  id         TEXT PRIMARY KEY,  -- ulid
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  phone      TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','driver')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, phone)
);

-- PILLAR 1: SCHEDULE
CREATE TABLE bookings (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  client_name TEXT NOT NULL,
  client_phone TEXT,
  route_from  TEXT NOT NULL,
  route_to    TEXT NOT NULL,
  depart_date TEXT NOT NULL,  -- ISO date
  depart_time TEXT,           -- HH:MM or null
  return_date TEXT,
  bus_id      TEXT REFERENCES buses(id),
  driver_id   TEXT REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','completed','cancelled')),
  agreed_price INTEGER,       -- in rupiah
  notes       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bookings_tenant_date ON bookings(tenant_id, depart_date);
CREATE INDEX idx_bookings_bus_date ON bookings(bus_id, depart_date);

-- PILLAR 2: FINANCIAL
CREATE TABLE payments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  booking_id  TEXT NOT NULL REFERENCES bookings(id),
  amount      INTEGER NOT NULL,  -- in rupiah
  type        TEXT NOT NULL CHECK (type IN ('dp','pelunasan','refund','other')),
  method      TEXT,               -- 'transfer_bca', 'cash', etc.
  recorded_by TEXT REFERENCES users(id),
  paid_at     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_payments_booking ON payments(booking_id);

-- PILLAR 3: ASSETS
CREATE TABLE buses (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,     -- "Bus 01", "Bus Jogja"
  capacity     INTEGER,
  features     TEXT,              -- JSON: ["AC","toilet","reclining"]
  status       TEXT NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available','booked','maintenance','retired')),
  permit_expiry TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE maintenance_logs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  bus_id      TEXT NOT NULL REFERENCES buses(id),
  type        TEXT NOT NULL,      -- 'oil_change', 'tire', 'general_service', etc.
  description TEXT,
  cost        INTEGER,
  performed_at TEXT NOT NULL,
  next_due_at  TEXT,              -- estimated next service date
  reported_by TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_maintenance_bus ON maintenance_logs(bus_id, performed_at);

-- AUDIT TRAIL (for "no documentation trail" pain)
CREATE TABLE activity_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,      -- 'booking_created', 'payment_recorded', etc.
  entity_type TEXT NOT NULL,      -- 'booking', 'payment', 'bus'
  entity_id   TEXT NOT NULL,
  details     TEXT,               -- JSON snapshot of change
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_tenant ON activity_log(tenant_id, created_at);
```

### 5b. KV Namespaces

| Namespace | Key Pattern | Value | TTL |
|---|---|---|---|
| `PHONE_LOOKUP` | `phone:{number}` | `{ tenantId, userId, role }` | None (updated on team changes) |
| `SESSIONS` | `session:{token}` | `{ userId, tenantId, role }` | 7 days |
| `RATE_LIMIT` | `rl:{phone}:{minute}` | counter | 60s |
| `CACHE` | `schedule:{tenantId}:{date}` | JSON schedule | 30s |

### 5c. Durable Objects

**ConversationState** — one instance per active user conversation.

```
State:
  - recentTurns: last 10 messages (for AI context)
  - pendingAction: the extracted intent awaiting user confirmation
  - lastActivity: timestamp (auto-hibernate after 30min inactivity)

Methods:
  - addMessage(role, text)
  - setPendingAction(action)
  - confirmAction() → returns action, clears pending
  - rejectAction() → clears pending
  - getContext() → returns turns + pending for AI prompt
```

Why Durable Objects here: the confirm-before-log flow requires ordered, single-writer semantics. If two messages arrive for the same user simultaneously (e.g., user sends "ya" while AI is still processing), a Durable Object guarantees they're processed sequentially.

---

## 6. Key Flows

### 6a. Inbound WhatsApp Message (Happy Path)

```
Meta Webhook → wa-bff
  │
  ├─ 1. Verify signature ✓
  ├─ 2. KV.get("phone:+628123456") → { tenantId, userId, role: "admin" }
  ├─ 3. DO.get(userId).getPendingAction()
  │
  ├─ [If pending action exists AND message is "ya"/"betul"/"ok"]
  │    ├─ 4a. DO.confirmAction() → returns structured booking data
  │    ├─ 4b. Service Binding → core-domain.bookingService.create(data)
  │    ├─ 4c. core-domain.alertService.evaluate(newBooking)
  │    │       → detects: admin needs schedule update
  │    │       → Queue: send WA to admin "Booking baru: Pak Agus 15 Maret"
  │    └─ 4d. Queue: send WA to user "Booking tercatat ✓"
  │
  ├─ [If pending action exists AND message is correction]
  │    ├─ 5a. Queue → ai-processor (re-extract with correction context)
  │    └─ 5b. New confirmation message sent
  │
  └─ [If no pending action (fresh message)]
       ├─ 6a. DO.addMessage("user", text)
       ├─ 6b. Queue → ai-processor
       │       → Claude extracts intent
       │       → DO.setPendingAction(extracted)
       └─ 6c. Queue: send WA confirmation prompt
```

### 6b. Dashboard Page Load

```
Browser → Pages (SPA) → dashboard-bff

  GET /api/schedule?date=today
    ├─ 1. Middleware: verify session (KV), extract tenant + role
    ├─ 2. RBAC check: admin can read schedule ✓
    ├─ 3. Check cache: KV.get("schedule:{tenantId}:2026-02-21")
    │     └─ [miss] → Service Binding → core-domain.bookingService.getSchedule()
    │                  → cache result in KV (30s TTL)
    └─ 4. Return JSON → SPA renders schedule view
```

### 6c. Morning Briefing (Cron)

```
Cron Trigger (daily 5:00 AM WIB) → core-domain

  1. For each tenant:
     a. Get today's bookings
     b. Get overdue payments
     c. Get maintenance due items
     d. Get unresolved alerts

  2. Per-user briefing (role-aware):
     - Driver Joko → "Trip hari ini: Jogja-Semarang, Bus 01, berangkat 06:00"
     - Admin Sari → Full schedule + 2 unconfirmed bookings + 1 payment pending
     - Owner Budi → Exceptions only: "1 bus overdue maintenance, 3 unpaid clients"

  3. Queue outbound WA messages per user
```

---

## 7. Security & Multi-Tenancy

**Tenant isolation** is enforced at two layers:

1. **Query-level**: every D1 query includes `WHERE tenant_id = ?` — no exceptions. The core-domain Worker receives `tenantId` from the BFF (resolved from auth), never from user input.

2. **BFF-level**: the `tenantId` is derived from the authenticated session (dashboard) or the phone lookup (WhatsApp), never from request parameters.

**RBAC matrix (MVP defaults):**

| Resource | Owner | Admin | Driver |
|---|---|---|---|
| All bookings | ✅ read/write | ✅ read/write | ❌ |
| Own trip details | ✅ | ✅ | ✅ |
| Financial data | ✅ read/write | ✅ read only | ❌ |
| Bus status | ✅ read/write | ✅ read only | ✅ own bus report |
| Team settings | ✅ | ❌ | ❌ |
| Dashboard access | ✅ full | ✅ limited | ❌ |

**WhatsApp auth model:** phone number is the identity. On first contact, user is prompted to enter a tenant invite code (shared by owner). This links their phone to a tenant + role.

---

## 8. Project Structure

```
keloia/
├── packages/
│   ├── core-domain/           # Shared business logic
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   ├── booking.ts
│   │   │   │   ├── payment.ts
│   │   │   │   ├── asset.ts
│   │   │   │   ├── alert.ts
│   │   │   │   ├── tenant.ts
│   │   │   │   └── permission.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.sql
│   │   │   │   ├── queries.ts       # Type-safe D1 queries
│   │   │   │   └── migrations/
│   │   │   ├── types.ts              # Shared domain types
│   │   │   └── index.ts              # Worker entry (Service Binding target)
│   │   └── wrangler.toml
│   │
│   ├── wa-bff/                # WhatsApp BFF Worker
│   │   ├── src/
│   │   │   ├── webhook.ts            # Meta webhook handler
│   │   │   ├── message-parser.ts     # Extract text/button/list replies
│   │   │   ├── wa-formatter.ts       # Format responses for WA API
│   │   │   ├── conversation.ts       # Durable Object: ConversationState
│   │   │   └── index.ts              # Worker entry
│   │   └── wrangler.toml
│   │
│   ├── dashboard-bff/         # Dashboard BFF Worker
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── schedule.ts
│   │   │   │   ├── assets.ts
│   │   │   │   ├── financials.ts
│   │   │   │   ├── alerts.ts
│   │   │   │   ├── settings.ts
│   │   │   │   └── pdf.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   └── rbac.ts
│   │   │   └── index.ts
│   │   └── wrangler.toml
│   │
│   ├── ai-processor/          # AI Queue Consumer
│   │   ├── src/
│   │   │   ├── intent-extractor.ts   # Claude API prompt + parsing
│   │   │   ├── prompts/
│   │   │   │   └── extract-intent.ts # System prompt template
│   │   │   └── index.ts              # Queue consumer entry
│   │   └── wrangler.toml
│   │
│   └── dashboard-ui/          # SPA (Cloudflare Pages)
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Schedule.tsx
│       │   │   ├── Assets.tsx
│       │   │   ├── Financials.tsx
│       │   │   └── Settings.tsx
│       │   ├── components/
│       │   └── App.tsx
│       └── package.json
│
├── turbo.json                 # Monorepo task runner
└── package.json
```

---

## 9. Wrangler Config (Key Bindings)

### wa-bff/wrangler.toml
```toml
name = "keloia-wa-bff"
main = "src/index.ts"

[[services]]
binding = "CORE"
service = "keloia-core-domain"

[[kv_namespaces]]
binding = "PHONE_LOOKUP"
id = "xxx"

[[queues.producers]]
binding = "AI_QUEUE"
queue = "keloia-ai-processing"

[[queues.producers]]
binding = "WA_OUTBOUND"
queue = "keloia-wa-outbound"

[durable_objects]
bindings = [{ name = "CONVERSATION", class_name = "ConversationState" }]

[vars]
WA_VERIFY_TOKEN = "..."  # Use secrets in production

# Secrets (set via wrangler secret put):
# WA_API_TOKEN
# META_APP_SECRET
```

### core-domain/wrangler.toml
```toml
name = "keloia-core-domain"
main = "src/index.ts"

[[d1_databases]]
binding = "DB"
database_name = "keloia-db"
database_id = "xxx"

[[kv_namespaces]]
binding = "CACHE"
id = "xxx"

[[queues.producers]]
binding = "WA_OUTBOUND"
queue = "keloia-wa-outbound"

[triggers]
crons = ["0 22 * * *"]  # 5 AM WIB (UTC+7) = 22:00 UTC previous day
```

---

## 10. Scaling & Cost Considerations

**D1 limits at SME scale:**

A bus operator with 5-10 buses runs ~100-300 bookings/month. Even with 50 tenants, we're looking at ~15,000 bookings/month, well within D1's free tier (5M rows read, 100K writes/day). D1 is the right call until the platform serves thousands of businesses.

**When to reconsider:**
- 500+ tenants → evaluate D1 performance, consider sharding by tenant
- Complex financial reporting → consider read replicas or materialized views
- Real-time collaboration on dashboard → add WebSocket via Durable Objects

**Cost structure (per tenant/month at MVP scale):**

| Service | Estimated Usage | Cost |
|---|---|---|
| Workers (requests) | ~10K/month (WA + dashboard) | Free tier |
| D1 | ~50K reads, ~2K writes/month | Free tier |
| KV | ~20K reads/month | Free tier |
| Durable Objects | ~5K requests/month | Free tier |
| Queues | ~3K messages/month | Free tier |
| R2 | ~50 PDFs/month (~5MB) | Free tier |
| Claude API | ~500 calls/month | ~$5-15 |

The only meaningful cost is Claude API calls. Everything else fits comfortably in Cloudflare's free/starter tiers for early tenants.

---

## 11. MVP Scope Boundaries

**In scope for MVP:**
- WhatsApp BFF: message receive, AI intent extraction, confirm-before-log, basic alerts
- Dashboard BFF: schedule view, bus status, payment tracker (read-only for admin)
- Core domain: booking CRUD with conflict detection, payment recording, bus status
- Single-tenant (hardcode tenant for first PO Bus partner)
- Owner + 1 admin + 2-3 drivers

**Explicitly NOT in MVP:**
- Multi-tenant onboarding flow
- PDF export
- Data analytics / utilization reports
- Auto-log (always confirm first)
- Custom permission configuration (use defaults)
- Offline support
- Payment gateway integration

**Post-MVP milestones:**
1. PDF trip confirmations
2. Multi-tenant onboarding
3. Proactive morning briefings (Cron)
4. Weekly financial summary
5. Maintenance tracking + alerts
6. Analytics dashboard (utilization, revenue)
