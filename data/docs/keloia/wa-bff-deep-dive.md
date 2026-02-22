# Keloia — WhatsApp BFF Deep Dive

**From Webhook to Source of Truth**
February 2026

---

## 1. What This Document Covers

The [main architecture doc](./keloia-architecture.md) defines the BFF pattern and worker topology. This document goes **inside** the WhatsApp BFF — every layer from the raw HTTP POST that Meta sends, through message parsing, conversation state, AI processing, to the outbound response. Think of this as the implementation blueprint.

```
Meta Cloud API                              Keloia Edge
─────────────                               ──────────

User sends     ─── POST /webhook ──────────► wa-bff Worker
"Bus 03 AC                                     │
 mati"                                         ├─ 1. Signature verification
                                               ├─ 2. Payload normalization
                                               ├─ 3. Phone → tenant resolution
                                               ├─ 4. Deduplication check
                                               ├─ 5. Durable Object (conversation state)
                                               │      ├─ pending action? → handle reply
                                               │      └─ no pending?    → enqueue for AI
                                               ├─ 6. Respond 200 to Meta
                                               │
                                               ▼
                                          Queue → ai-processor
                                               │
                                               ▼
                                          Durable Object ← store pending action
                                               │
                                               ▼
                                          Queue → outbound WA message
                                               │
                                               ▼
User receives  ◄── "Saya catat sebagai:   ◄───┘
"Saya catat       Bus 03 AC mati,
 sebagai..."      perlu service. Betul?"
```

---

## 2. Meta Webhook Contract

### 2a. The Two Request Types Meta Sends

Meta sends exactly two kinds of requests to your webhook URL:

**GET — Subscription verification** (one-time during setup):
```
GET /webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE_STRING
```
You must respond with the `hub.challenge` value as the body and HTTP 200. This is a handshake — Meta confirms you own the endpoint.

**POST — Event notifications** (ongoing, every time something happens):
```
POST /webhook
Headers:
  Content-Type: application/json
  X-Hub-Signature-256: sha256=HMAC_OF_BODY
Body: { "object": "whatsapp_business_account", "entry": [...] }
```

### 2b. Inbound Message Payload (What We Actually Receive)

Every webhook POST from Meta follows this envelope structure. A single POST can contain **multiple entries and multiple messages** — batch processing is not optional, it's the default.

```typescript
// The full webhook payload envelope
type WebhookPayload = {
  object: 'whatsapp_business_account'
  entry: WebhookEntry[]
}

type WebhookEntry = {
  id: string                    // WABA ID
  changes: WebhookChange[]
}

type WebhookChange = {
  field: 'messages'             // We only subscribe to this
  value: WebhookValue
}

type WebhookValue = {
  messaging_product: 'whatsapp'
  metadata: {
    display_phone_number: string  // Our business number
    phone_number_id: string       // Our phone number ID (used for sending)
  }
  contacts?: WebhookContact[]    // Present when messages are included
  messages?: InboundMessage[]    // Inbound messages from users
  statuses?: MessageStatus[]     // Delivery/read receipts for OUR outbound messages
  errors?: WebhookError[]        // Platform errors
}
```

The critical insight: **`messages` and `statuses` arrive through the same webhook endpoint.** A single POST might contain a user's message AND a delivery receipt for a previous outbound message. We must handle both without confusing them.

### 2c. Inbound Message Types

Users can send different types of messages. For Keloia MVP, we care about three:

```typescript
type InboundMessage = {
  from: string          // Sender phone number (e.g., "628123456789")
  id: string            // Unique message ID (e.g., "wamid.HBgL...")
  timestamp: string     // Unix timestamp as string
  type: MessageType
} & MessageContent

type MessageType = 'text' | 'interactive' | 'image' | 'document' | 'audio' | 'location' | 'reaction' | 'unsupported'

// The three we handle in MVP:
type TextMessage = { type: 'text'; text: { body: string } }

type InteractiveButtonReply = {
  type: 'interactive'
  interactive: {
    type: 'button_reply'
    button_reply: { id: string; title: string }
  }
}

type InteractiveListReply = {
  type: 'interactive'
  interactive: {
    type: 'list_reply'
    list_reply: { id: string; title: string; description?: string }
  }
}
```

**Why interactive messages matter for Keloia:** When the AI sends a confirmation prompt ("Saya catat sebagai booking ya, Pak?"), we send it with quick-reply buttons (`Ya` / `Koreksi`). The user taps a button — we receive an `interactive.button_reply`, not a text message. This is faster and less error-prone than parsing "ya", "iya", "ok", "betul", "yup" from free text.

### 2d. Status Updates (Outbound Message Tracking)

```typescript
type MessageStatus = {
  id: string              // The wamid of OUR outbound message
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string    // Who we sent it to
  errors?: Array<{
    code: number
    title: string
    message: string
    href?: string
  }>
}
```

**MVP approach:** Log statuses to `activity_log` for debugging. Don't build delivery-tracking UI yet — YAGNI. But **do** handle `failed` status by logging the error and alerting the system that a message didn't reach the user.

### 2e. Meta's Non-Negotiable Rules

These are constraints Meta enforces. Violating them causes retries, dropped messages, or account suspension:

| Rule | Constraint | Our Strategy |
|---|---|---|
| **Response time** | Return HTTP 200 within 5 seconds | Respond immediately, process async via Queue |
| **Retry behavior** | Meta retries failed deliveries with exponential backoff for 7 days, then drops | Never fail — always return 200 after signature verification |
| **Duplicate delivery** | At-least-once delivery. Duplicates are normal, not edge cases | Deduplicate by message `id` in KV (idempotency) |
| **Event ordering** | Not guaranteed. A `read` status can arrive before `delivered` | Use `timestamp` field, not arrival order |
| **Signature validation** | Every POST includes `X-Hub-Signature-256` HMAC | Verify before any processing, reject invalid signatures |
| **24-hour window** | Free-form messages only within 24h of user's last message to us | Track last user message timestamp, use templates outside window |

---

## 3. Worker Internals — Layer by Layer

### 3a. Hono App Structure

```typescript
// packages/wa-bff/src/index.ts
import { Hono } from 'hono'
import { verifyWebhook } from './middleware/verify-webhook'
import { handleVerification } from './routes/verify'
import { handleInbound } from './routes/inbound'

type Env = {
  Bindings: {
    CORE: Fetcher                  // Service Binding → core-domain
    PHONE_LOOKUP: KVNamespace
    AI_QUEUE: Queue
    WA_OUTBOUND: Queue
    CONVERSATION: DurableObjectNamespace
    IDEMPOTENCY: KVNamespace       // Dedup store
    META_APP_SECRET: string
    WA_API_TOKEN: string
    WA_PHONE_ID: string
    WA_VERIFY_TOKEN: string
  }
}

const app = new Hono<{ Bindings: Env['Bindings'] }>()

// GET — Meta subscription verification (one-time)
app.get('/webhook', handleVerification)

// POST — All inbound events
app.post('/webhook', verifyWebhook, handleInbound)

export { ConversationState } from './conversation'
export default app
```

Thin. The app is a router with one middleware and two handlers. All business logic lives downstream.

### 3b. Layer 1 — Signature Verification

This is the security gate. Every POST from Meta includes an HMAC-SHA256 signature of the raw body, signed with your app secret. If the signature doesn't match, the payload is spoofed — reject it.

```typescript
// packages/wa-bff/src/middleware/verify-webhook.ts
import { createMiddleware } from 'hono/factory'

export const verifyWebhook = createMiddleware(async (c, next) => {
  const signature = c.req.header('x-hub-signature-256')
  if (!signature) return c.text('Missing signature', 401)

  const body = await c.req.raw.clone().arrayBuffer()
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign('HMAC', key, body)
  const expected = `sha256=${toHex(signed)}`

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(expected, signature)) {
    return c.text('Invalid signature', 401)
  }

  await next()
})

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
```

**Why `crypto.subtle` instead of Node's `crypto`:** Workers run on V8, not Node. `crypto.subtle` is the Web Crypto API — available natively in every edge runtime. Zero dependencies.

### 3c. Layer 2 — Payload Normalization

Meta's webhook payload is deeply nested. We flatten it into a clean domain event before anything else touches it.

```typescript
// packages/wa-bff/src/normalize.ts
import type { InboundMessage, MessageStatus, WebhookPayload } from '@keloia/shared'

type NormalizedEvent =
  | { kind: 'message'; phoneNumberId: string; message: InboundMessage; contact: { name: string; waId: string } }
  | { kind: 'status'; phoneNumberId: string; status: MessageStatus }

export function normalizePayload(payload: WebhookPayload): NormalizedEvent[] {
  const events: NormalizedEvent[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue
      const { value } = change
      const phoneNumberId = value.metadata.phone_number_id

      // Inbound messages
      if (value.messages) {
        for (const msg of value.messages) {
          const contact = value.contacts?.find((c) => c.wa_id === msg.from)
          events.push({
            kind: 'message',
            phoneNumberId,
            message: msg,
            contact: {
              name: contact?.profile?.name ?? 'Unknown',
              waId: msg.from,
            },
          })
        }
      }

      // Status updates for our outbound messages
      if (value.statuses) {
        for (const status of value.statuses) {
          events.push({ kind: 'status', phoneNumberId, status })
        }
      }
    }
  }

  return events
}
```

**Why normalize first:** Downstream code never needs to know about Meta's envelope format. If Meta changes the nesting (they have before), we fix it in one place.

### 3d. Layer 3 — Phone Number Resolution

Every message arrives with just a phone number. We need to know: which tenant is this? Which user? What role? This is a hot-path read — every single inbound message hits it.

```typescript
// packages/wa-bff/src/resolve-user.ts
type ResolvedUser = {
  tenantId: string
  userId: string
  role: 'owner' | 'admin' | 'driver'
  name: string
}

export async function resolveUser(
  kv: KVNamespace,
  phone: string,
): Promise<ResolvedUser | null> {
  const raw = await kv.get(`phone:${phone}`)
  if (!raw) return null
  return JSON.parse(raw) as ResolvedUser
}
```

**KV is the right tool here.** Sub-millisecond reads, globally replicated, perfect for a lookup table that changes rarely (only when team members are added/removed). The `PHONE_LOOKUP` KV namespace is updated by the `tenant-service` in `core-domain` whenever the owner registers a new team member.

**Unregistered users:** If `resolveUser` returns `null`, the phone number isn't in any tenant. We respond with an onboarding prompt: "Halo! Masukkan kode undangan dari bisnis Anda untuk mulai menggunakan Keloia." This is the only path where we respond directly from the webhook handler without AI processing.

### 3e. Layer 4 — Idempotency (Deduplication)

Meta delivers at-least-once. Duplicates are **normal operating conditions**, not edge cases. Without deduplication, a single booking could be created twice.

```typescript
// packages/wa-bff/src/dedup.ts
export async function isDuplicate(
  kv: KVNamespace,
  messageId: string,
): Promise<boolean> {
  const existing = await kv.get(`seen:${messageId}`)
  if (existing) return true

  // Mark as seen with 24h TTL (Meta retries for up to 7 days,
  // but we only need to dedup within a reasonable window)
  await kv.put(`seen:${messageId}`, '1', { expirationTtl: 86400 })
  return false
}
```

**Why 24h TTL, not 7 days:** KV storage is cheap but not free at scale. 24 hours covers the vast majority of retries. If a message somehow arrives 3 days later, the worst case is it gets processed again — and the Durable Object's pending action state will reject it as stale. Defense in depth.

### 3f. Layer 5 — The Inbound Handler (Orchestration)

This is where everything comes together. The handler coordinates all the layers above, then routes to the appropriate next step.

```typescript
// packages/wa-bff/src/routes/inbound.ts
import type { Context } from 'hono'
import { normalizePayload } from '../normalize'
import { resolveUser } from '../resolve-user'
import { isDuplicate } from '../dedup'
import { routeMessage } from '../router'
import { handleStatusUpdate } from '../status-handler'

export async function handleInbound(c: Context) {
  const payload = await c.req.json()
  const events = normalizePayload(payload)

  // Process all events concurrently — don't block on one slow event
  await Promise.allSettled(
    events.map((event) => processEvent(c, event)),
  )

  // Always return 200 to Meta — even if individual events fail
  return c.text('OK', 200)
}

async function processEvent(c: Context, event: NormalizedEvent) {
  if (event.kind === 'status') {
    return handleStatusUpdate(c.env, event.status)
  }

  const { message, contact } = event

  // Dedup
  if (await isDuplicate(c.env.IDEMPOTENCY, message.id)) return

  // Resolve user
  const user = await resolveUser(c.env.PHONE_LOOKUP, message.from)
  if (!user) {
    return sendOnboardingPrompt(c.env, message.from)
  }

  // Route to conversation state machine
  await routeMessage(c.env, user, message, contact)
}
```

**Key design decisions:**
- `Promise.allSettled` not `Promise.all` — one failed event must not block others in the same batch.
- Always return 200 — even if processing fails. Returning non-200 causes Meta to retry the **entire batch**, including already-processed messages. Handle failures internally.
- Status updates and messages are split immediately — different code paths, different concerns.

---

## 4. Conversation State Machine (Durable Object)

This is the brain of the WhatsApp BFF. Every active user has a Durable Object instance that tracks their conversation context and manages the confirm-before-log flow.

### 4a. Why a Durable Object, Not KV or D1

| Requirement | KV | D1 | Durable Object |
|---|---|---|---|
| **Ordered writes** | ❌ Eventually consistent | ✅ But overkill | ✅ Single-threaded actor |
| **Read-your-writes** | ❌ Possible stale reads | ✅ | ✅ Guaranteed |
| **Concurrency safety** | ❌ Race conditions | ✅ Via transactions | ✅ Sequential by design |
| **Low latency** | ✅ | ⚠️ Depends on location | ✅ Colocated with user's edge |
| **Hibernation** | N/A | N/A | ✅ Free when inactive |

The confirm-before-log flow is inherently **stateful and order-dependent**: user sends message → AI extracts intent → system asks confirmation → user says "ya" → system logs. If two messages arrive simultaneously (user sends "ya" while also correcting a detail), they MUST be processed sequentially. Durable Objects guarantee this by design — they're single-threaded actors.

### 4b. State Shape

```typescript
// packages/wa-bff/src/conversation.ts
import { DurableObject } from 'cloudflare:workers'

type Turn = {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

type PendingAction = {
  intent: string                // 'create_booking' | 'record_payment' | 'report_issue' | ...
  extracted: Record<string, unknown>  // Structured data from AI
  confirmationText: string      // The message we sent to the user
  createdAt: number
  expiresAt: number             // Auto-expire stale actions (30 min)
}

type ConversationSnapshot = {
  turns: Turn[]
  pending: PendingAction | null
  lastActivity: number
}
```

### 4c. Durable Object Implementation

```typescript
export class ConversationState extends DurableObject {
  private turns: Turn[] = []
  private pending: PendingAction | null = null
  private lastActivity = 0

  // Called on first access — restore from storage
  async initialize() {
    const stored = await this.ctx.storage.get<ConversationSnapshot>('state')
    if (stored) {
      this.turns = stored.turns
      this.pending = stored.pending
      this.lastActivity = stored.lastActivity
    }
  }

  private async persist() {
    const snapshot: ConversationSnapshot = {
      turns: this.turns,
      pending: this.pending,
      lastActivity: this.lastActivity,
    }
    await this.ctx.storage.put('state', snapshot)
  }

  async addUserMessage(text: string): Promise<void> {
    this.turns.push({ role: 'user', text, timestamp: Date.now() })
    if (this.turns.length > 10) this.turns.shift() // Keep last 10 turns
    this.lastActivity = Date.now()
    await this.persist()
  }

  async addAssistantMessage(text: string): Promise<void> {
    this.turns.push({ role: 'assistant', text, timestamp: Date.now() })
    if (this.turns.length > 10) this.turns.shift()
    await this.persist()
  }

  async setPending(action: Omit<PendingAction, 'createdAt' | 'expiresAt'>): Promise<void> {
    this.pending = {
      ...action,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    }
    await this.persist()
  }

  async confirmPending(): Promise<PendingAction | null> {
    if (!this.pending) return null
    if (Date.now() > this.pending.expiresAt) {
      this.pending = null
      await this.persist()
      return null // Expired — user took too long
    }
    const action = this.pending
    this.pending = null
    await this.persist()
    return action
  }

  async rejectPending(): Promise<void> {
    this.pending = null
    await this.persist()
  }

  async getSnapshot(): Promise<ConversationSnapshot> {
    // Expire stale pending action on read
    if (this.pending && Date.now() > this.pending.expiresAt) {
      this.pending = null
      await this.persist()
    }
    return { turns: this.turns, pending: this.pending, lastActivity: this.lastActivity }
  }

  // Hibernate after 30 min inactivity — Cloudflare evicts from memory, state persists on disk
  async alarm() {
    // no-op — waking just to check expiry is handled in getSnapshot
  }
}
```

### 4d. How the Router Uses the Durable Object

```typescript
// packages/wa-bff/src/router.ts
export async function routeMessage(
  env: Env['Bindings'],
  user: ResolvedUser,
  message: InboundMessage,
  contact: { name: string; waId: string },
) {
  // Get or create the conversation DO for this user
  const doId = env.CONVERSATION.idFromName(user.userId)
  const conversation = env.CONVERSATION.get(doId)

  const text = extractText(message)
  const snapshot = await conversation.getSnapshot()

  // BRANCH 1: User is replying to a pending confirmation
  if (snapshot.pending) {
    const reply = classifyReply(message, text)

    if (reply === 'confirm') {
      const action = await conversation.confirmPending()
      if (!action) {
        // Expired between check and confirm — race is near-impossible
        // with single-threaded DO, but handle gracefully
        await sendText(env, user, 'Maaf, konfirmasi sudah expired. Silakan kirim ulang.')
        return
      }
      await executeAction(env, user, action)
      await conversation.addUserMessage(text)
      return
    }

    if (reply === 'reject') {
      await conversation.rejectPending()
      await conversation.addUserMessage(text)
      await sendText(env, user, 'Baik, dibatalkan. Silakan kirim ulang dengan info yang benar.')
      return
    }

    // reply === 'correction' — user sent new info instead of yes/no
    // Treat as a fresh message with the correction context
    await conversation.rejectPending()
    // Fall through to BRANCH 2
  }

  // BRANCH 2: Fresh message — send to AI for intent extraction
  await conversation.addUserMessage(text)
  const updatedSnapshot = await conversation.getSnapshot()

  await env.AI_QUEUE.send({
    type: 'process_message',
    tenantId: user.tenantId,
    userId: user.userId,
    userRole: user.role,
    userName: contact.name,
    phone: message.from,
    text,
    conversationTurns: updatedSnapshot.turns,
    timestamp: Date.now(),
  })
}
```

### 4e. Reply Classification

How do we know if the user said "yes", "no", or is correcting?

```typescript
// packages/wa-bff/src/classify-reply.ts

type ReplyClass = 'confirm' | 'reject' | 'correction'

export function classifyReply(message: InboundMessage, text: string): ReplyClass {
  // Button replies are unambiguous — this is the happy path
  if (message.type === 'interactive') {
    const buttonId = message.interactive?.button_reply?.id
    if (buttonId === 'confirm_yes') return 'confirm'
    if (buttonId === 'confirm_no') return 'reject'
  }

  // Free-text fallback — users sometimes type instead of tapping buttons
  const normalized = text.toLowerCase().trim()
  const confirmWords = ['ya', 'iya', 'yes', 'ok', 'betul', 'benar', 'yup', 'oke', 'sip', 'yoi', 'bener', 'y']
  const rejectWords = ['tidak', 'no', 'bukan', 'salah', 'batal', 'cancel', 'nggak', 'gak', 'enggak', 'n']

  if (confirmWords.includes(normalized)) return 'confirm'
  if (rejectWords.includes(normalized)) return 'reject'

  // Anything else is treated as a correction or new input
  return 'correction'
}
```

**Why button replies are preferred:** No parsing ambiguity. "OK" might mean "ok, cancel it" in context. But `button_reply.id = 'confirm_yes'` is unambiguous. The free-text fallback exists because users don't always tap buttons — but we push them toward buttons in the UX.

---

## 5. Outbound Messages — The WA Client

### 5a. Message Types We Send

Keloia sends four kinds of outbound messages:

```typescript
// packages/wa-bff/src/wa-client.ts

type Env = { WA_PHONE_ID: string; WA_API_TOKEN: string }
const API_BASE = 'https://graph.facebook.com/v21.0'

// 1. Plain text — for simple responses
async function sendText(env: Env, to: string, body: string) {
  return callWaApi(env, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  })
}

// 2. Interactive buttons — for confirm/reject prompts
async function sendButtons(
  env: Env,
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
) {
  return callWaApi(env, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  })
}

// 3. Interactive list — for selection from multiple options (e.g., "which bus?")
async function sendList(
  env: Env,
  to: string,
  body: string,
  buttonText: string,
  sections: Array<{
    title: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>,
) {
  return callWaApi(env, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: buttonText, sections },
    },
  })
}

// 4. Mark as read — show blue ticks after we process a message
async function markAsRead(env: Env, messageId: string) {
  return callWaApi(env, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  })
}

// Shared HTTP call
async function callWaApi(env: Env, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/${env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new WaApiError(res.status, error)
  }

  return res.json()
}

class WaApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`WA API error ${status}: ${JSON.stringify(body)}`)
  }
}
```

### 5b. Outbound Queue Consumer

Outbound messages are always sent via Queue — never directly from the webhook handler. This decouples response time from Meta API latency.

```typescript
// packages/wa-bff/src/outbound-consumer.ts

type OutboundMessage =
  | { type: 'text'; to: string; body: string }
  | { type: 'buttons'; to: string; body: string; buttons: Array<{ id: string; title: string }> }
  | { type: 'list'; to: string; body: string; buttonText: string; sections: any[] }
  | { type: 'mark_read'; messageId: string }

export async function handleOutboundBatch(
  batch: MessageBatch<OutboundMessage>,
  env: Env['Bindings'],
) {
  for (const msg of batch.messages) {
    try {
      const payload = msg.body
      switch (payload.type) {
        case 'text':
          await sendText(env, payload.to, payload.body)
          break
        case 'buttons':
          await sendButtons(env, payload.to, payload.body, payload.buttons)
          break
        case 'list':
          await sendList(env, payload.to, payload.body, payload.buttonText, payload.sections)
          break
        case 'mark_read':
          await markAsRead(env, payload.messageId)
          break
      }
      msg.ack()
    } catch (err) {
      // Retry on transient errors, dead-letter on permanent failures
      if (err instanceof WaApiError && err.status >= 500) {
        msg.retry({ delaySeconds: 10 })
      } else {
        console.error('Permanent outbound failure:', err)
        msg.ack() // Don't retry permanent failures (e.g., blocked number)
      }
    }
  }
}
```

### 5c. Confirmation Prompt Format

When the AI extracts an intent, we format a confirmation message using WhatsApp interactive buttons:

```typescript
// packages/wa-bff/src/format-confirmation.ts

export function formatConfirmation(
  intent: string,
  extracted: Record<string, unknown>,
  confirmationText: string,
): OutboundMessage {
  // confirmationText comes from the AI, e.g.:
  // "Saya catat sebagai:\n📋 Booking — Pak Agus\n📅 15 Maret 2026\n🚌 Bus 01, Jogja–Semarang\n💰 Rp 15.000.000\n\nBetul?"

  return {
    type: 'buttons',
    to: '', // Filled by caller
    body: confirmationText,
    buttons: [
      { id: 'confirm_yes', title: '✅ Ya, betul' },
      { id: 'confirm_no', title: '❌ Koreksi' },
    ],
  }
}
```

---

## 6. AI Processing Pipeline

### 6a. Queue → AI Worker

The AI processor is a separate Worker that consumes from the `AI_QUEUE`. This isolation prevents AI latency (2-5 seconds for Claude) from affecting webhook response time.

```typescript
// packages/ai-processor/src/index.ts

export default {
  async queue(batch: MessageBatch<AIQueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      try {
        const result = await processMessage(env, msg.body)
        await deliverResult(env, msg.body, result)
        msg.ack()
      } catch (err) {
        console.error('AI processing failed:', err)
        msg.retry({ delaySeconds: 5 })
      }
    }
  },
}
```

### 6b. Intent Extraction Prompt

The AI receives the user's message plus conversation context, and returns structured data.

```typescript
// packages/ai-processor/src/extract-intent.ts

const SYSTEM_PROMPT = `Kamu adalah Keloia, asisten operasional untuk bisnis PO Bus pariwisata.
Tugasmu: ekstrak intent dan data terstruktur dari pesan pengguna.

INTENTS:
- create_booking: Pembuatan booking baru (klien, tanggal, rute, bus, harga)
- record_payment: Pencatatan pembayaran (klien, jumlah, metode, jenis: dp/pelunasan/refund)
- report_issue: Laporan masalah bus (bus_id, deskripsi masalah)
- check_schedule: Pertanyaan jadwal (tanggal, bus, atau driver)
- check_payment: Pertanyaan status pembayaran (klien atau booking)
- update_booking: Perubahan booking yang sudah ada
- general_query: Pertanyaan umum yang tidak masuk kategori di atas

RULES:
- Respond ONLY with valid JSON. No prose, no backticks.
- If information is missing, set confidence < 0.7 and list missing fields.
- Confirmation message harus dalam Bahasa Indonesia yang natural.
- Gunakan emoji untuk clarity: 📋 booking, 📅 tanggal, 🚌 bus, 💰 uang, 🔧 maintenance.
- Harga dalam Rupiah (integer, tanpa titik/koma).
- Tanggal dalam format ISO (YYYY-MM-DD).

USER ROLE: {role}
This affects what intents are valid. Drivers typically report_issue or check_schedule.
Admins typically create_booking, record_payment, check_schedule.
Owners can do everything.`

const RESPONSE_SCHEMA = z.object({
  intent: z.enum([
    'create_booking', 'record_payment', 'report_issue',
    'check_schedule', 'check_payment', 'update_booking', 'general_query',
  ]),
  confidence: z.number().min(0).max(1),
  extracted: z.record(z.unknown()),
  missing_fields: z.array(z.string()).optional(),
  confirmation_message: z.string(),
})
```

### 6c. Post-AI Flow

After the AI returns structured intent data:

```typescript
// packages/ai-processor/src/deliver-result.ts

async function deliverResult(env: Env, original: AIQueueMessage, result: z.infer<typeof RESPONSE_SCHEMA>) {
  const doId = env.CONVERSATION.idFromName(original.userId)
  const conversation = env.CONVERSATION.get(doId)

  if (result.confidence < 0.7 || (result.missing_fields?.length ?? 0) > 0) {
    // Low confidence or missing info — ask for clarification, don't confirm
    const clarificationText = buildClarificationPrompt(result)
    await conversation.addAssistantMessage(clarificationText)
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: original.phone,
      body: clarificationText,
    })
    return
  }

  // High confidence — send confirmation with buttons
  await conversation.setPending({
    intent: result.intent,
    extracted: result.extracted,
    confirmationText: result.confirmation_message,
  })
  await conversation.addAssistantMessage(result.confirmation_message)

  await env.WA_OUTBOUND.send({
    type: 'buttons',
    to: original.phone,
    body: result.confirmation_message,
    buttons: [
      { id: 'confirm_yes', title: '✅ Ya, betul' },
      { id: 'confirm_no', title: '❌ Koreksi' },
    ],
  })
}
```

---

## 7. Action Execution — Writing to Source of Truth

When a user confirms a pending action, the WA BFF calls the `core-domain` Worker via Service Binding.

```typescript
// packages/wa-bff/src/execute-action.ts

export async function executeAction(
  env: Env['Bindings'],
  user: ResolvedUser,
  action: PendingAction,
) {
  // Service Binding call — in-process RPC, no network hop
  const coreResponse = await env.CORE.fetch(
    new Request('http://core/internal/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: user.tenantId,
        userId: user.userId,
        intent: action.intent,
        data: action.extracted,
      }),
    }),
  )

  if (!coreResponse.ok) {
    const error = await coreResponse.text()
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: user.phone,
      body: `Maaf, terjadi kesalahan saat mencatat: ${error}. Silakan coba lagi.`,
    })
    return
  }

  const result = await coreResponse.json()

  // Send success confirmation
  await env.WA_OUTBOUND.send({
    type: 'text',
    to: user.phone,
    body: result.successMessage ?? 'Tercatat ✅',
  })

  // Alert service evaluates if anyone else needs to be notified
  // (e.g., admin gets notified of new booking from driver)
  // This happens inside core-domain as a side effect of the write
}
```

**Why Service Binding, not HTTP:** Service Bindings invoke the target Worker in-process — same isolate, no network round trip. Latency is effectively zero. The URL is fake (`http://core/internal/action`) — it's just Hono route matching inside the core-domain Worker.

---

## 8. Error Handling Strategy

### 8a. Error Categories

| Error Type | Example | Response to User | System Action |
|---|---|---|---|
| **Transient** | AI API timeout, WA API 503 | Nothing (retry silently) | Queue retry with backoff |
| **Permanent — user error** | Unregistered phone number | Onboarding prompt | Log, no retry |
| **Permanent — data error** | Double-booking detected | "Bus 01 sudah di-book tanggal itu" | Return conflict to user, suggest alternative |
| **Permanent — system error** | D1 write failure | "Maaf, terjadi kesalahan" | Log to activity_log, alert owner |
| **Invalid payload** | Bad signature, malformed JSON | Nothing (reject silently) | Log, return 401/400 to Meta |

### 8b. Queue Retry Policy

```typescript
// In queue consumers
catch (err) {
  if (isTransient(err)) {
    msg.retry({ delaySeconds: Math.min(30, 5 * msg.attempts) }) // Linear backoff, max 30s
  } else {
    console.error(`Dead letter — attempt ${msg.attempts}:`, err)
    msg.ack() // Stop retrying permanent failures
  }
}
```

---

## 9. Rate Limiting

### 9a. Inbound (Protecting Our System)

Users can spam messages. We rate-limit per phone number to prevent abuse and control AI API costs.

```typescript
// packages/wa-bff/src/middleware/rate-limit.ts
export async function checkRateLimit(
  kv: KVNamespace,
  phone: string,
): Promise<boolean> {
  const key = `rl:${phone}:${minuteBucket()}`
  const current = parseInt(await kv.get(key) ?? '0', 10)

  if (current >= 10) return false // Max 10 messages per minute

  await kv.put(key, String(current + 1), { expirationTtl: 60 })
  return true
}

function minuteBucket(): string {
  return Math.floor(Date.now() / 60_000).toString()
}
```

### 9b. Outbound (Respecting Meta's Limits)

Meta allows ~80 messages/second per phone number by default. At Keloia's MVP scale (~5-10 tenants, ~30 users), we're nowhere near this. But the Queue consumer naturally throttles by processing messages sequentially per batch. If we ever hit limits, we add delays between sends in the batch consumer.

---

## 10. Wrangler Config (Complete)

```toml
# packages/wa-bff/wrangler.toml
name = "keloia-wa-bff"
main = "src/index.ts"
compatibility_date = "2025-01-01"

# Service Binding to core-domain
[[services]]
binding = "CORE"
service = "keloia-core-domain"

# KV for phone lookup + idempotency + rate limiting
[[kv_namespaces]]
binding = "PHONE_LOOKUP"
id = "abc123"

[[kv_namespaces]]
binding = "IDEMPOTENCY"
id = "def456"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "ghi789"

# Queue producers
[[queues.producers]]
binding = "AI_QUEUE"
queue = "keloia-ai-processing"

[[queues.producers]]
binding = "WA_OUTBOUND"
queue = "keloia-wa-outbound"

# Queue consumer (outbound messages)
[[queues.consumers]]
queue = "keloia-wa-outbound"
max_batch_size = 10
max_batch_timeout = 5

# Durable Objects
[durable_objects]
bindings = [
  { name = "CONVERSATION", class_name = "ConversationState" }
]

[[migrations]]
tag = "v1"
new_classes = ["ConversationState"]

# Secrets (set via `wrangler secret put`):
# META_APP_SECRET
# WA_API_TOKEN
# WA_VERIFY_TOKEN
# WA_PHONE_ID
```

---

## 11. File Structure (Final)

```
packages/wa-bff/
├── src/
│   ├── index.ts                  # Hono app + DO export
│   ├── conversation.ts           # Durable Object: ConversationState
│   ├── normalize.ts              # Meta payload → domain events
│   ├── resolve-user.ts           # Phone → tenant/user/role lookup
│   ├── dedup.ts                  # Message ID idempotency
│   ├── classify-reply.ts         # Confirm/reject/correction detection
│   ├── router.ts                 # Conversation routing logic
│   ├── execute-action.ts         # Service Binding call to core-domain
│   ├── format-confirmation.ts    # Build confirmation prompt messages
│   ├── status-handler.ts         # Handle delivery/read receipts
│   ├── wa-client.ts              # Meta API wrapper (send, buttons, list, mark_read)
│   ├── outbound-consumer.ts      # Queue consumer for outbound messages
│   ├── middleware/
│   │   ├── verify-webhook.ts     # HMAC-SHA256 signature verification
│   │   └── rate-limit.ts         # Per-phone rate limiting
│   ├── routes/
│   │   ├── verify.ts             # GET /webhook — subscription verification
│   │   └── inbound.ts            # POST /webhook — event handler
│   └── types.ts                  # WA-specific types (extends @keloia/shared)
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## 12. What This Doc Does NOT Cover (Next Deep Dives)

| Topic | What's Needed | Doc |
|---|---|---|
| **Core Domain Worker** | Booking conflict detection, payment linking, alert evaluation, Service Binding API shape | `keloia-core-domain-deep-dive.md` |
| **AI Processor** | Full prompt engineering, confidence calibration, multi-turn clarification, fallback handling | `keloia-ai-processor-deep-dive.md` |
| **Dashboard BFF** | Auth flow, RBAC middleware, REST API spec, cache invalidation, PDF generation | `keloia-dashboard-bff-deep-dive.md` |
| **Onboarding Flow** | Tenant creation, invite code system, first-user setup, team member registration | `keloia-onboarding-deep-dive.md` |
