# Keloia — AI Processor Deep Dive

**From Messy Indonesian Chat to Structured Business Data**
February 2026

---

## 1. What This Document Covers

The [main architecture doc](./keloia-architecture.md) defines the AI Processor as "consumes from Queue, isolated so AI latency doesn't block anything." The [WA BFF deep dive](./keloia-wa-bff-deep-dive.md) shows the queue handoff and post-AI delivery flow. The [core-domain deep dive](./keloia-core-domain-deep-dive.md) shows what happens after the extracted intent is confirmed and executed.

This document goes **inside** the AI Processor — prompt engineering, structured output schemas, confidence calibration, multi-turn clarification, error handling, and cost optimization. This is the intelligence layer of Keloia.

```
Queue message                     AI Processor Worker
─────────────                     ──────────────────

{                                 ┌───────────────────────────┐
  userId,                         │                           │
  tenantId,                       │  1. Build prompt          │
  userRole,          ──────►      │     (system + context +   │
  phone,                          │      tenant data + msg)   │
  text,                           │                           │
  conversationTurns               │  2. Call Claude API       │  ──► Anthropic
}                                 │     (structured output)   │  ◄── { intent, confidence,
                                  │                           │       extracted, message }
                                  │  3. Validate response     │
                                  │     (Zod parse)           │
                                  │                           │
                                  │  4. Decide: confirm or    │
                                  │     clarify?              │
                                  │                           │
                                  │  5. Update conversation   │  ──► Durable Object
                                  │     DO + queue WA reply   │  ──► WA Outbound Queue
                                  └───────────────────────────┘
```

**The core challenge:** Indonesian bus operators type things like "pak agus mau sewa bus tgl 15 maret jogja semarang 15jt." The AI must extract this into `{ intent: "create_booking", client: "Pak Agus", date: "2026-03-15", routeFrom: "Jogja", routeTo: "Semarang", price: 15000000 }` — reliably, in under 3 seconds, for $0.001 per message.

---

## 2. Why a Separate Worker

The AI Processor is a standalone Queue consumer Worker, not a module inside the WA BFF. Three reasons:

**Latency isolation.** Claude API calls take 2-5 seconds. Meta's webhook SLA is 5 seconds. If the AI call blocked the webhook handler, Meta would retry, causing duplicate processing. By enqueuing the work, the webhook responds 200 in <100ms.

**Independent retry.** If the Claude API is down, the Queue retries with backoff. The webhook handler doesn't know or care — it already returned 200. The user's message is safely buffered.

**Independent scaling.** Queue consumers can be configured with `max_batch_size` and `max_concurrency`. If message volume spikes (e.g., morning rush of bookings), the AI Processor scales independently without affecting webhook throughput.

---

## 3. Queue Consumer — Entry Point

```typescript
// packages/ai-processor/src/index.ts
import { processMessage } from './pipeline'
import { deliverResult } from './deliver'

type AIQueueMessage = {
  type: 'process_message'
  tenantId: string
  userId: string
  userRole: 'owner' | 'admin' | 'driver'
  userName: string
  phone: string
  text: string
  conversationTurns: Turn[]
}

type Env = {
  ANTHROPIC_API_KEY: string
  CONVERSATION: DurableObjectNamespace  // To update pending action
  WA_OUTBOUND: Queue                    // To send WA reply
}

export default {
  async queue(batch: MessageBatch<AIQueueMessage>, env: Env) {
    // Process messages sequentially per batch.
    // Cloudflare Queues guarantees ordering within a single consumer invocation.
    for (const msg of batch.messages) {
      try {
        const result = await processMessage(env, msg.body)
        await deliverResult(env, msg.body, result)
        msg.ack()
      } catch (err) {
        console.error(`AI processing failed for ${msg.body.userId}:`, err)

        if (isRetryable(err)) {
          msg.retry({ delaySeconds: 10 })
        } else {
          // Permanent failure — acknowledge to prevent infinite retry
          msg.ack()
          await sendErrorMessage(env, msg.body.phone,
            'Maaf, terjadi gangguan. Silakan kirim ulang pesan Anda.',
          )
        }
      }
    }
  },
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    // Claude API rate limit or server error → retry
    if (err.message.includes('529') || err.message.includes('500')) return true
    if (err.message.includes('timeout') || err.message.includes('ECONNRESET')) return true
  }
  return false
}
```

**Wrangler config for the consumer:**

```toml
# packages/ai-processor/wrangler.toml
name = "keloia-ai-processor"
main = "src/index.ts"
compatibility_date = "2025-01-01"

# Queue consumer
[[queues.consumers]]
queue = "keloia-ai-processing"
max_batch_size = 5           # process up to 5 messages per invocation
max_retries = 3
dead_letter_queue = "keloia-ai-dlq"
max_batch_timeout = 30       # wait up to 30s to fill the batch

# Durable Object binding (to update conversation state)
# This binds to the DO defined in wa-bff
[[services]]
binding = "WA_BFF"
service = "keloia-wa-bff"

# Queue producer for outbound WA messages
[[queues.producers]]
binding = "WA_OUTBOUND"
queue = "keloia-wa-outbound"

# Secrets (set via `wrangler secret put`):
# ANTHROPIC_API_KEY
```

---

## 4. The Processing Pipeline

### 4a. Pipeline Overview

```typescript
// packages/ai-processor/src/pipeline.ts
import Anthropic from '@anthropic-ai/sdk'
import { intentResponseSchema, type IntentResponse } from './schema'
import { buildMessages } from './prompt-builder'

export async function processMessage(
  env: Env,
  msg: AIQueueMessage,
): Promise<IntentResponse> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const messages = buildMessages(msg)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: buildSystemPrompt(msg.userRole),
    messages,

    // Structured output — guaranteed valid JSON matching our schema
    output_format: {
      type: 'json_schema',
      schema: INTENT_JSON_SCHEMA,
    },

    // Prompt caching — system prompt is identical across all requests
    cache_control: { type: 'ephemeral' },
  })

  // Extract the JSON text from the response
  const jsonText = response.content[0].type === 'text'
    ? response.content[0].text
    : ''

  // Validate with Zod (defense-in-depth even with structured outputs)
  const parsed = intentResponseSchema.safeParse(JSON.parse(jsonText))

  if (!parsed.success) {
    console.error('Schema validation failed:', parsed.error)
    // Structured outputs should make this impossible, but belt-and-suspenders
    return fallbackResponse(msg.text)
  }

  return parsed.data
}
```

### 4b. Why Structured Outputs, Not "Parse the JSON"

The WA BFF deep dive shows a `RESPONSE_SCHEMA` Zod object and instructs Claude to "respond ONLY with valid JSON." That works most of the time. But "most of the time" means occasional failures that break the pipeline and require retry logic.

Claude's structured outputs feature (via `output_format`) uses **constrained decoding** — the model physically cannot produce tokens that violate the schema. This eliminates:

- Malformed JSON (missing quotes, trailing commas)
- Extra fields the schema doesn't define
- Wrong types (`"15000000"` string instead of `15000000` number)
- Missing required fields
- Natural language preamble ("Sure! Here's the JSON:") before the JSON

The Zod validation remains as defense-in-depth, but with structured outputs it should never fire.

---

## 5. The System Prompt

The system prompt is the most critical piece of the AI Processor. It defines Keloia's personality, extraction rules, and output format. It's cached across all requests via prompt caching.

```typescript
// packages/ai-processor/src/prompts/system.ts

export function buildSystemPrompt(userRole: string): string {
  return `Kamu adalah Keloia, asisten operasional untuk bisnis PO Bus pariwisata di Indonesia.

TUGAS UTAMA
Ekstrak intent dan data terstruktur dari pesan pengguna yang dikirim via WhatsApp.
Pesan bisa dalam Bahasa Indonesia informal, campuran bahasa, singkatan, atau typo.

PERAN PENGGUNA SAAT INI: ${userRole}
- owner: bisa semua (booking, pembayaran, laporan, cek jadwal, cek pembayaran, update)
- admin: booking, pembayaran, cek jadwal, cek pembayaran, laporan masalah
- driver: laporan masalah bus, cek jadwal sendiri, pertanyaan umum

INTENT YANG TERSEDIA
1. create_booking — Pembuatan booking baru
   Field wajib: clientName, departDate, routeFrom, routeTo
   Field opsional: departTime, returnDate, busId/busName, driverName, agreedPrice, notes
   
2. record_payment — Pencatatan pembayaran
   Field wajib: bookingRef (nama klien ATAU deskripsi booking), amount, type (dp/pelunasan/refund/other)
   Field opsional: method (transfer_bca/cash/gopay/dana/etc), paidAt
   
3. report_issue — Laporan masalah bus dari driver atau admin
   Field wajib: busName, issueType
   Field opsional: description
   issueType values: breakdown, ac_repair, engine_issue, tire_blowout, oil_change, tire, general_service, other
   
4. check_schedule — Pertanyaan tentang jadwal
   Field opsional: date, busName, driverName, clientName
   
5. check_payment — Pertanyaan status pembayaran
   Field wajib: clientName
   
6. update_booking — Perubahan booking yang sudah ada
   Field wajib: bookingRef (nama klien + tanggal atau deskripsi booking)
   Field opsional: field yang ingin diubah
   
7. general_query — Pertanyaan umum, salam, atau pesan yang tidak masuk kategori lain

ATURAN EKSTRAKSI DATA
- Tanggal: konversi ke ISO format (YYYY-MM-DD). "tgl 15 maret" → "2026-03-15", "besok" → hitung dari hari ini, "sabtu depan" → hitung tanggal Sabtu berikutnya.
- Harga: konversi ke integer Rupiah. "15jt" → 15000000, "500rb" → 500000, "2.5 juta" → 2500000.
- Nama: capitalize dengan benar. "pak agus" → "Pak Agus", "bu sari" → "Bu Sari".
- Rute: pisahkan origin dan destination. "jogja semarang" → routeFrom: "Jogja", routeTo: "Semarang". "jakarta-bandung" → routeFrom: "Jakarta", routeTo: "Bandung".
- Bus: jika disebutkan, extract nama bus. "bus 01" → "Bus 01", "bus jogja" → "Bus Jogja".
- Singkatan umum: "tgl" = tanggal, "jt" = juta, "rb" = ribu, "org" = orang, "PP" = pulang-pergi, "DP" = down payment.

ATURAN CONFIDENCE
- confidence >= 0.8: Semua field wajib terisi, data jelas dan tidak ambigu.
- confidence 0.5-0.79: Beberapa field wajib terisi tapi ada yang ambigu atau tidak jelas. Set missing_fields.
- confidence < 0.5: Pesan tidak jelas, terlalu pendek, atau tidak bisa diekstrak. Gunakan general_query.

ATURAN CONFIRMATION MESSAGE
- Tulis dalam Bahasa Indonesia natural dan sopan.
- Gunakan emoji: 📋 booking, 📅 tanggal, 🚌 bus, 💰 uang, 🔧 maintenance, ✅ konfirmasi.
- Rangkum data yang diekstrak agar pengguna bisa verifikasi.
- Jika ada field yang missing, tanyakan dengan jelas di confirmation_message.
- Jangan gunakan format teknis (JSON, key-value). Tulis seperti manusia.

CONTOH CONFIRMATION MESSAGE (BAIK):
"Saya catat booking baru ya:
📋 Klien: Pak Agus
📅 Tanggal: 15 Maret 2026
🚌 Rute: Jogja → Semarang
💰 Harga: Rp 15.000.000

Betul seperti ini?"

CONTOH CONFIRMATION MESSAGE (BURUK):
"I've extracted the following: clientName=Pak Agus, date=2026-03-15..."

GENERAL QUERY HANDLING
Untuk intent general_query, confirmation_message berisi jawaban atau respons yang helpful.
Contoh: "Halo Pak!" → { intent: "general_query", confidence: 1.0, confirmation_message: "Halo, Pak! Ada yang bisa saya bantu hari ini? 😊" }
Contoh: "Makasih ya" → { intent: "general_query", confidence: 1.0, confirmation_message: "Sama-sama, Pak! 🙏" }
general_query TIDAK memerlukan konfirmasi — langsung kirim sebagai teks biasa.`
}
```

### 5a. Why the Prompt Is in Indonesian

The system prompt is mostly in Indonesian for two reasons:

1. **Output quality.** When the system prompt is in Indonesian, Claude generates Indonesian confirmation messages that sound natural — not like translations. "Saya catat booking baru ya" is how an Indonesian would say it. "I'll record a new booking" translated to Indonesian becomes stiff.

2. **Extraction accuracy.** Indonesian-language extraction rules ("tgl" = tanggal, "jt" = juta) are more naturally expressed in Indonesian context. The model understands the abbreviation patterns better when the surrounding context is in the same language.

The technical structure (field names, types, JSON schema) remains in English because that's what the code consumes.

### 5b. Prompt Size and Caching Economics

The system prompt is approximately **1,200 tokens** — above the 1,024 minimum for prompt caching.

With prompt caching enabled:
- **First request:** cache write = 1,200 × $3.75/MTok = ~$0.0045
- **Subsequent requests (within 5 min):** cache read = 1,200 × $0.30/MTok = ~$0.00036

At MVP scale (50-100 messages/day), the cache is always warm during business hours (7 AM - 10 PM WIB). Each message costs approximately $0.001-0.002 total (cache read + user message input + output tokens).

**Monthly estimate:** 100 messages/day × 30 days × $0.002 = **~$6/month** for AI processing. This is negligible.

---

## 6. Message Builder — Conversation Context

The AI doesn't just see the current message. It sees the last 10 conversation turns for context — critical for multi-turn interactions.

```typescript
// packages/ai-processor/src/prompt-builder.ts

type Turn = {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

type AIQueueMessage = {
  text: string
  conversationTurns: Turn[]
  userName: string
  userRole: string
}

export function buildMessages(msg: AIQueueMessage): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = []

  // Include recent conversation turns for context
  // This allows the AI to understand corrections, follow-ups, and multi-step interactions
  for (const turn of msg.conversationTurns.slice(-8)) {
    // Skip the current message (it's the last user turn, we'll add it separately)
    if (turn === msg.conversationTurns[msg.conversationTurns.length - 1]) continue

    messages.push({
      role: turn.role,
      content: turn.text,
    })
  }

  // Current message with metadata prefix
  messages.push({
    role: 'user',
    content: `[Pengirim: ${msg.userName} (${msg.userRole})]\n\n${msg.text}`,
  })

  return messages
}
```

### 6a. Why 8 Turns, Not All 10

We store 10 turns in the Durable Object but send only the most recent 8 to Claude. Reasons:

- **Token budget.** Each turn averages ~30 tokens. 8 turns = ~240 tokens of context. Adding the system prompt (1,200) + current message (~50) + output (~200), total is ~1,700 tokens per request. Well within Sonnet's sweet spot.
- **Relevance decay.** Turns from 30 minutes ago are rarely relevant to the current extraction. The most useful context is the immediately preceding exchange (e.g., "correction after clarification").
- **The 10th turn is buffer.** If we need to look back further (future feature: multi-step booking flow), we have room.

### 6b. When Context Matters

Multi-turn context is critical for these scenarios:

**Correction after clarification:**
```
User: "booking pak agus tanggal 15"
AI:   "Saya perlu info lebih lanjut. Rute dari mana ke mana?"
User: "jogja semarang"    ← THIS message alone is meaningless without context
AI:   [sees prior turns, completes the booking extraction]
```

**Correction after confirmation:**
```
User: "booking pak agus 15 maret jogja semarang 15jt"
AI:   "Saya catat booking: Pak Agus, 15 Maret, Jogja→Semarang, 15 juta. Betul?"
User: "salah, 12 juta bukan 15"  ← correction, not a new message
AI:   [sees prior extraction, updates price to 12000000]
```

**Follow-up booking:**
```
User: "booking pak agus 15 maret jogja semarang"
AI:   [confirmed and logged]
User: "terus tanggal 20 juga ya, rute sama"  ← references prior booking
AI:   [sees prior context, creates booking with date=March 20, same route]
```

---

## 7. Structured Output Schema

### 7a. The JSON Schema (for Claude API)

Claude's structured outputs require a JSON Schema definition (not Zod). We maintain both: the JSON Schema for the API, and a Zod schema for server-side validation.

```typescript
// packages/ai-processor/src/schema.ts

// JSON Schema for Claude's output_format parameter
export const INTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'create_booking',
        'record_payment',
        'report_issue',
        'check_schedule',
        'check_payment',
        'update_booking',
        'general_query',
      ],
    },
    confidence: {
      type: 'number',
      description: 'Confidence score between 0.0 and 1.0',
    },
    extracted: {
      type: 'object',
      description: 'Structured data extracted from the message. Keys depend on intent.',
      properties: {
        // Booking fields
        clientName:  { type: 'string' },
        clientPhone: { type: 'string' },
        routeFrom:   { type: 'string' },
        routeTo:     { type: 'string' },
        departDate:  { type: 'string', description: 'ISO date YYYY-MM-DD' },
        departTime:  { type: 'string', description: 'HH:MM format' },
        returnDate:  { type: 'string', description: 'ISO date YYYY-MM-DD' },
        busName:     { type: 'string' },
        driverName:  { type: 'string' },
        agreedPrice: { type: 'number', description: 'Integer, in Rupiah' },
        notes:       { type: 'string' },

        // Payment fields
        bookingRef: { type: 'string', description: 'Client name or booking description' },
        amount:     { type: 'number', description: 'Integer, in Rupiah' },
        type:       { type: 'string', enum: ['dp', 'pelunasan', 'refund', 'other'] },
        method:     { type: 'string' },
        paidAt:     { type: 'string', description: 'ISO date YYYY-MM-DD' },

        // Issue fields
        issueType:   { type: 'string' },
        description: { type: 'string' },

        // Query fields
        date: { type: 'string', description: 'ISO date for schedule queries' },
      },
      additionalProperties: false,
    },
    missing_fields: {
      type: 'array',
      items: { type: 'string' },
      description: 'Required fields that could not be extracted. Empty if all present.',
    },
    confirmation_message: {
      type: 'string',
      description: 'Indonesian-language message to send back to the user.',
    },
  },
  required: ['intent', 'confidence', 'extracted', 'missing_fields', 'confirmation_message'],
  additionalProperties: false,
} as const
```

### 7b. The Zod Schema (for Server-Side Validation)

```typescript
// packages/ai-processor/src/schema.ts
import { z } from 'zod'

export const intentResponseSchema = z.object({
  intent: z.enum([
    'create_booking', 'record_payment', 'report_issue',
    'check_schedule', 'check_payment', 'update_booking', 'general_query',
  ]),
  confidence: z.number().min(0).max(1),
  extracted: z.object({
    clientName:  z.string().optional(),
    clientPhone: z.string().optional(),
    routeFrom:   z.string().optional(),
    routeTo:     z.string().optional(),
    departDate:  z.string().optional(),
    departTime:  z.string().optional(),
    returnDate:  z.string().optional(),
    busName:     z.string().optional(),
    driverName:  z.string().optional(),
    agreedPrice: z.number().int().optional(),
    notes:       z.string().optional(),
    bookingRef:  z.string().optional(),
    amount:      z.number().int().optional(),
    type:        z.enum(['dp', 'pelunasan', 'refund', 'other']).optional(),
    method:      z.string().optional(),
    paidAt:      z.string().optional(),
    issueType:   z.string().optional(),
    description: z.string().optional(),
    date:        z.string().optional(),
  }).passthrough(),  // Allow Claude to add extra context fields we haven't predicted
  missing_fields: z.array(z.string()),
  confirmation_message: z.string(),
})

export type IntentResponse = z.infer<typeof intentResponseSchema>
```

**Why both JSON Schema and Zod?** The Claude API requires JSON Schema for `output_format`. Our server validates with Zod. They describe the same shape, but we maintain both explicitly rather than generating one from the other. The JSON Schema is optimized for Claude (descriptions guide generation), and the Zod schema is optimized for TypeScript (types flow downstream). A shared generator would couple two different concerns.

---

## 8. Confidence Calibration

Confidence isn't just a number Claude invents. The system prompt defines concrete rules for what each range means, and the post-AI logic acts on it differently.

### 8a. Confidence Bands

| Band | Range | Meaning | AI Processor Action |
|---|---|---|---|
| **High** | ≥ 0.8 | All required fields present, data unambiguous | → Set pending action, send confirm/reject buttons |
| **Medium** | 0.5 – 0.79 | Some fields present but gaps or ambiguity | → Send clarification question (text, no buttons) |
| **Low** | < 0.5 | Can't determine intent or extract meaningful data | → Treat as `general_query`, send helpful response |

### 8b. What Drives Confidence Down

The system prompt tells Claude when to lower confidence. These are the real-world patterns:

```
HIGH CONFIDENCE (≥ 0.8):
"pak agus mau sewa bus tgl 15 maret jogja semarang 15jt"
→ All 4 required fields (client, date, from, to) + price. Clear and complete.

MEDIUM CONFIDENCE (0.5-0.79):
"booking pak agus tanggal 15"
→ Client ✓, date ✓, but missing: routeFrom, routeTo.
→ missing_fields: ["routeFrom", "routeTo"]
→ confirmation_message: "Booking untuk Pak Agus tanggal 15 Maret.
   Rute dari mana ke mana ya, Pak?"

"ada yang mau sewa tgl 20"
→ Intent clear (create_booking), date ✓, but client name missing.
→ missing_fields: ["clientName"]

LOW CONFIDENCE (< 0.5):
"oke"
→ Too short, no context. If there's no pending action, this is meaningless.
→ intent: general_query

"gmn ya"
→ Ambiguous. Could be asking about anything.
→ intent: general_query
→ confirmation_message: "Ada yang bisa saya bantu, Pak? 😊"
```

### 8c. Why 0.7 Is the Action Threshold (Not 0.5 or 0.9)

The WA BFF deep dive uses 0.7 as the threshold for "send confirmation buttons." This was chosen deliberately:

- **Too low (0.5):** Would show confirmation buttons for half-complete extractions. User sees "Saya catat booking: Pak Agus, tanggal ?, rute ?→?. Betul?" — frustrating, forces rejection and re-entry.
- **Too high (0.9):** Would rarely trigger confirmation, sending clarification questions even when data is complete. "You said Jogja to Semarang on March 15 for Pak Agus at 15 million — did you mean Jogja or Yogyakarta?" — pedantic and annoying.
- **0.7-0.8 sweet spot:** All required fields are present. Some optional fields may be missing. User can confirm what's there and add details later. Matches the "good enough to act on" threshold.

In practice, the actual delivery logic uses 0.7 (as defined in the WA BFF deep dive's `deliverResult` function) even though the system prompt defines 0.8 as the "high confidence" band. This is intentional — we want Claude to be honest about ambiguity (set confidence 0.75 when unsure about one optional field) while still proceeding to confirmation (0.75 > 0.7 threshold). The gap between "Claude's self-assessment" and "system's action threshold" gives us tuning room.

---

## 9. Result Delivery

After the pipeline produces a validated `IntentResponse`, we decide what to do with it.

```typescript
// packages/ai-processor/src/deliver.ts

export async function deliverResult(
  env: Env,
  original: AIQueueMessage,
  result: IntentResponse,
): Promise<void> {
  // Access the conversation Durable Object via WA BFF service binding
  const doStub = env.WA_BFF.get(
    env.WA_BFF.idFromName(original.userId),
  )

  // BRANCH 1: general_query — just send a text reply, no confirmation needed
  if (result.intent === 'general_query') {
    await doStub.addAssistantMessage(result.confirmation_message)
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: original.phone,
      body: result.confirmation_message,
    })
    return
  }

  // BRANCH 2: Read-only intents (check_schedule, check_payment)
  // These don't mutate data, so no confirm-before-log needed.
  // Execute immediately via core-domain and return the result.
  if (result.intent === 'check_schedule' || result.intent === 'check_payment') {
    await doStub.addAssistantMessage(result.confirmation_message)

    // Execute the read query directly
    const queryResult = await executeReadQuery(env, original, result)

    await env.WA_OUTBOUND.send({
      type: 'text',
      to: original.phone,
      body: queryResult.successMessage,
    })
    return
  }

  // BRANCH 3: Low confidence or missing fields — ask for clarification
  if (result.confidence < 0.7 || result.missing_fields.length > 0) {
    const clarificationText = buildClarificationMessage(result)
    await doStub.addAssistantMessage(clarificationText)
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: original.phone,
      body: clarificationText,
    })
    return
  }

  // BRANCH 4: High confidence write intent — send confirmation with buttons
  await doStub.setPending({
    intent: result.intent,
    extracted: result.extracted,
    confirmationText: result.confirmation_message,
  })
  await doStub.addAssistantMessage(result.confirmation_message)

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

### 9a. Read vs. Write Intent Routing

Not all intents need confirm-before-log. The key insight: **only data-mutating actions need confirmation.**

| Intent | Type | Confirmation? | Why |
|---|---|---|---|
| `create_booking` | Write | ✅ Yes | Wrong booking = real damage |
| `record_payment` | Write | ✅ Yes | Wrong payment = financial chaos |
| `report_issue` | Write | ✅ Yes | Wrong issue report = unnecessary maintenance |
| `update_booking` | Write | ✅ Yes | Wrong update = schedule confusion |
| `check_schedule` | Read | ❌ No | No harm in showing wrong date's schedule |
| `check_payment` | Read | ❌ No | No harm in showing wrong client's status |
| `general_query` | None | ❌ No | Just conversation |

For read intents, the AI Processor calls core-domain directly (via service binding to WA BFF, which calls core-domain) and returns the result immediately. No pending action, no buttons, no waiting.

### 9b. Clarification Message Builder

When confidence is low or fields are missing:

```typescript
function buildClarificationMessage(result: IntentResponse): string {
  // If Claude already wrote a good clarification in confirmation_message, use it
  if (result.missing_fields.length > 0) {
    // Claude's confirmation_message already asks about missing fields
    // (because the system prompt instructs it to)
    return result.confirmation_message
  }

  // Fallback: generic clarification
  const intentLabels: Record<string, string> = {
    create_booking: 'booking',
    record_payment: 'pembayaran',
    report_issue: 'laporan masalah',
    update_booking: 'update booking',
  }

  const label = intentLabels[result.intent] ?? 'permintaan'
  return `Saya menangkap ini sebagai ${label}, tapi saya butuh info lebih lanjut. Bisa tolong lengkapi?`
}
```

---

## 10. Indonesian Language Challenges

### 10a. Abbreviations and Slang

Indonesian WhatsApp culture has its own shorthand. The system prompt covers the most common ones, but here's the full reference the AI must handle:

| Category | Examples | Interpretation |
|---|---|---|
| **Numbers** | 15jt, 15 juta, 15.000.000 | 15000000 |
| | 500rb, 500 ribu | 500000 |
| | 2.5jt, 2,5 juta | 2500000 |
| **Dates** | tgl 15, tanggal 15, 15 maret | 2026-03-15 |
| | besok, bsk | tomorrow's date |
| | lusa | day after tomorrow |
| | sabtu depan, sabtu minggu depan | next Saturday |
| | minggu ini | this week (context-dependent) |
| **Honorifics** | pak, bu, mas, mbak | Capitalize: Pak, Bu, Mas, Mbak |
| **Routes** | jogja-semarang, jkt-bdg | Jogja→Semarang, Jakarta→Bandung |
| | PP, pp, pulang pergi | Round trip (set returnDate) |
| **Payment** | DP, dp | type: 'dp' |
| | lunas, pelunasan | type: 'pelunasan' |
| | transfer bca, tf bca | method: 'transfer_bca' |
| | cash, tunai | method: 'cash' |
| **Confirmations** | ya, iya, betul, ok, oke, sip, gas | confirm |
| | tidak, batal, gajadi, nggak | reject |
| **Slang** | gmn (gimana), lg (lagi), yg (yang), tp (tapi), sm (sama) | Common contractions |

### 10b. Ambiguous Names

Indonesian names don't follow Western first/last conventions. "Pak Agus" could be a full reference. "Agus" could be a first name or a nickname. The AI treats whatever the user provides as the `clientName` without trying to decompose it.

### 10c. Date Ambiguity

"Tanggal 15" without a month — when is it? The AI's rule:
- If today is before the 15th of this month → this month
- If today is the 15th or later → next month
- If a month is specified, use that month
- If the year is ambiguous, assume the current year (or next year if the date has passed)

This is encoded in the system prompt's extraction rules. Claude handles it well because the conversation context often disambiguates ("booking bulan depan tanggal 15").

---

## 11. Error Handling and Fallbacks

### 11a. Claude API Failures

| Error | Action | User Impact |
|---|---|---|
| **Rate limit (429/529)** | Queue retry with 10s delay, up to 3 retries | Delayed response (10-30s) |
| **Server error (500/502)** | Queue retry with 10s delay | Delayed response |
| **Timeout (>30s)** | Queue retry once, then fail | "Maaf, coba lagi" message |
| **Invalid API key** | Permanent failure, alert system | Error message + system alert |
| **Schema validation fail** | Use fallback response | Degraded but functional |

### 11b. Fallback Response

When Claude's response can't be parsed (should be impossible with structured outputs, but defense-in-depth):

```typescript
function fallbackResponse(originalText: string): IntentResponse {
  return {
    intent: 'general_query',
    confidence: 0,
    extracted: {},
    missing_fields: [],
    confirmation_message: 'Maaf, saya belum bisa memproses pesan ini. Bisa tolong kirim ulang dengan detail yang lebih jelas?',
  }
}
```

### 11c. Dead Letter Queue

After 3 failed retries, the message goes to `keloia-ai-dlq`. This catches:
- Persistent Claude API outages
- Messages that consistently trigger errors (e.g., extremely long text, unusual Unicode)

A monitoring alert fires when the DLQ gets any messages. For MVP, this is a console log; post-MVP, it's a WhatsApp message to the system admin.

---

## 12. Intent-Specific Extraction Examples

### 12a. create_booking

```
Input:  "pak agus mau sewa bus tgl 15 maret jogja semarang bus 01 15jt PP"
Output: {
  intent: "create_booking",
  confidence: 0.95,
  extracted: {
    clientName: "Pak Agus",
    departDate: "2026-03-15",
    routeFrom: "Jogja",
    routeTo: "Semarang",
    busName: "Bus 01",
    agreedPrice: 15000000,
    returnDate: "2026-03-15"   // PP = pulang-pergi, same day unless specified
  },
  missing_fields: [],
  confirmation_message: "Saya catat booking baru ya:\n📋 Klien: Pak Agus\n📅 Berangkat: 15 Maret 2026 (PP)\n🚌 Rute: Jogja → Semarang\n🚌 Bus: Bus 01\n💰 Harga: Rp 15.000.000\n\nBetul seperti ini?"
}
```

### 12b. record_payment

```
Input:  "pak agus transfer DP 5 juta via BCA"
Output: {
  intent: "record_payment",
  confidence: 0.85,
  extracted: {
    bookingRef: "Pak Agus",
    amount: 5000000,
    type: "dp",
    method: "transfer_bca"
  },
  missing_fields: [],
  confirmation_message: "Saya catat pembayaran ya:\n💰 Klien: Pak Agus\n💵 Jumlah: Rp 5.000.000 (DP)\n🏦 Via: Transfer BCA\n\nBetul?"
}
```

### 12c. report_issue

```
Input:  "bus 03 AC nya mati"
Output: {
  intent: "report_issue",
  confidence: 0.9,
  extracted: {
    busName: "Bus 03",
    issueType: "ac_repair",
    description: "AC mati"
  },
  missing_fields: [],
  confirmation_message: "Saya laporkan ya:\n🔧 Bus 03 — AC mati\n\nBetul?"
}
```

### 12d. check_schedule (read — no confirmation)

```
Input:  "jadwal besok apa aja?"
Output: {
  intent: "check_schedule",
  confidence: 0.9,
  extracted: {
    date: "2026-02-23"    // tomorrow
  },
  missing_fields: [],
  confirmation_message: "Saya cek jadwal besok ya..."
}
→ AI Processor executes read query immediately, sends schedule list.
```

### 12e. Medium confidence — clarification needed

```
Input:  "booking tanggal 20"
Output: {
  intent: "create_booking",
  confidence: 0.55,
  extracted: {
    departDate: "2026-03-20"
  },
  missing_fields: ["clientName", "routeFrom", "routeTo"],
  confirmation_message: "Booking untuk tanggal 20 Maret 2026.\n\nBoleh saya tahu:\n1. Nama klien siapa?\n2. Rute dari mana ke mana?"
}
→ Sent as plain text (no buttons). User replies with details. AI gets context from conversation turns.
```

---

## 13. Booking Reference Resolution

When the AI extracts `record_payment` with `bookingRef: "Pak Agus"`, the core-domain needs to find the right booking. This is a fuzzy match problem:

```
"pak agus" → search bookings WHERE client_name LIKE '%Agus%'
```

If there are multiple bookings for Pak Agus, the core-domain returns the most recent active one. If there's ambiguity (multiple active bookings), the action router in core-domain returns a conflict, and the WA BFF sends a list message:

```
Pak Agus punya beberapa booking aktif:
1. 15 Maret — Jogja→Semarang (Rp 15.000.000)
2. 22 Maret — Jakarta→Bandung (Rp 8.000.000)

Pembayaran ini untuk booking yang mana?
```

This resolution happens in `core-domain`, not in the AI Processor. The AI just extracts what the user said. The business logic determines which entity it maps to.

---

## 14. Model Selection and Cost

### 14a. Why Sonnet, Not Haiku or Opus

| Model | Price (input/output per MTok) | Quality | Latency | Verdict |
|---|---|---|---|---|
| **Haiku 4.5** | $1 / $5 | Good for simple extraction | <1s | Too error-prone on abbreviations and slang |
| **Sonnet 4.5** | $3 / $15 | Excellent structured extraction | 1-3s | ✅ Sweet spot for Keloia |
| **Opus 4.5** | $5 / $25 | Overkill | 3-8s | Too expensive and slow for intent extraction |

Sonnet is the right choice because:
- It handles Indonesian abbreviations and slang reliably
- Structured output support is fully available
- Latency (1-3s) is fast enough for WhatsApp UX
- Cost per message (~$0.002) is negligible at MVP scale

### 14b. Token Budget Per Request

| Component | Tokens | Notes |
|---|---|---|
| System prompt (cached) | ~1,200 | Paid at 10% after first request |
| Conversation context (8 turns) | ~240 | Variable |
| Current message + metadata | ~50-100 | Variable |
| **Total input** | **~200-400** (effective, after cache) | |
| Output (structured JSON) | ~150-300 | Intent + extracted + message |

**Cost per message:** ~$0.001-0.002

### 14c. When to Consider Haiku

Post-MVP, if message volume grows significantly (1000+/day), we can use a two-model routing strategy:

1. **Haiku (fast pass):** Classify the message into intent category (single field, no extraction)
2. **Sonnet (full extraction):** Only called if the intent requires structured data

This halves cost for `general_query` messages (greetings, thanks, simple questions) which don't need full extraction. At MVP scale, this optimization is premature.

---

## 15. Testing the AI Processor

### 15a. Unit Tests — Schema Validation

```typescript
// packages/ai-processor/src/schema.test.ts
import { describe, it, expect } from 'vitest'
import { intentResponseSchema } from './schema'

describe('intentResponseSchema', () => {
  it('validates a complete booking extraction', () => {
    const result = intentResponseSchema.safeParse({
      intent: 'create_booking',
      confidence: 0.92,
      extracted: {
        clientName: 'Pak Agus',
        departDate: '2026-03-15',
        routeFrom: 'Jogja',
        routeTo: 'Semarang',
        agreedPrice: 15000000,
      },
      missing_fields: [],
      confirmation_message: 'Booking untuk Pak Agus...',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid confidence', () => {
    const result = intentResponseSchema.safeParse({
      intent: 'create_booking',
      confidence: 1.5,  // > 1.0
      extracted: {},
      missing_fields: [],
      confirmation_message: 'test',
    })
    expect(result.success).toBe(false)
  })
})
```

### 15b. Integration Tests — Real Claude Calls

```typescript
// packages/ai-processor/src/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { processMessage } from './pipeline'

// These tests call the real Claude API — run sparingly, not in CI
// Cost: ~$0.002 per test case
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('AI pipeline (live)', () => {
  it('extracts booking from natural Indonesian', async () => {
    const result = await processMessage(env, {
      text: 'pak agus mau sewa bus tgl 15 maret jogja semarang 15jt',
      conversationTurns: [],
      userName: 'Admin Sari',
      userRole: 'admin',
      // ...
    })

    expect(result.intent).toBe('create_booking')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    expect(result.extracted.clientName).toContain('Agus')
    expect(result.extracted.departDate).toBe('2026-03-15')
    expect(result.extracted.routeFrom).toContain('Jogja')
    expect(result.extracted.routeTo).toContain('Semarang')
    expect(result.extracted.agreedPrice).toBe(15000000)
  })

  it('asks for clarification when incomplete', async () => {
    const result = await processMessage(env, {
      text: 'booking tanggal 20',
      conversationTurns: [],
      userName: 'Admin Sari',
      userRole: 'admin',
    })

    expect(result.intent).toBe('create_booking')
    expect(result.confidence).toBeLessThan(0.8)
    expect(result.missing_fields.length).toBeGreaterThan(0)
  })

  it('handles greetings as general_query', async () => {
    const result = await processMessage(env, {
      text: 'halo pak',
      conversationTurns: [],
      userName: 'Admin Sari',
      userRole: 'admin',
    })

    expect(result.intent).toBe('general_query')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
})
```

### 15c. Evaluation Harness — Prompt Tuning

For systematic prompt improvement, maintain a test corpus:

```typescript
// packages/ai-processor/eval/corpus.ts

export const TEST_CORPUS: TestCase[] = [
  {
    input: 'pak agus mau sewa bus tgl 15 maret jogja semarang 15jt',
    expectedIntent: 'create_booking',
    expectedMinConfidence: 0.8,
    expectedFields: { clientName: 'Pak Agus', departDate: '2026-03-15' },
  },
  {
    input: 'bus 03 AC nya mati',
    expectedIntent: 'report_issue',
    expectedMinConfidence: 0.8,
    expectedFields: { busName: 'Bus 03', issueType: 'ac_repair' },
  },
  {
    input: 'pak agus transfer DP 5 juta via BCA',
    expectedIntent: 'record_payment',
    expectedMinConfidence: 0.8,
    expectedFields: { amount: 5000000, type: 'dp' },
  },
  {
    input: 'jadwal besok',
    expectedIntent: 'check_schedule',
    expectedMinConfidence: 0.8,
  },
  {
    input: 'oke',
    expectedIntent: 'general_query',
  },
  {
    input: 'booking tanggal 20',
    expectedIntent: 'create_booking',
    expectedMaxConfidence: 0.8,  // should be low confidence (missing fields)
  },
  // ... 50+ test cases covering edge cases
]
```

Run the eval harness periodically when the system prompt changes. Track accuracy, confidence calibration, and extraction precision over time.

---

## 16. File Structure (Final)

```
packages/ai-processor/
├── src/
│   ├── index.ts                    # Queue consumer entry point
│   ├── pipeline.ts                 # Main processing pipeline (Claude API call)
│   ├── deliver.ts                  # Post-AI delivery logic (confirm, clarify, or direct)
│   ├── schema.ts                   # JSON Schema + Zod schema for intent response
│   └── prompts/
│       └── system.ts               # System prompt builder (role-aware)
├── eval/
│   ├── corpus.ts                   # Test cases for prompt tuning
│   └── run-eval.ts                 # Evaluation harness script
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## 17. What This Doc Does NOT Cover (Next Deep Dives)

| Topic | What's Needed | Doc |
|---|---|---|
| **Dashboard UI** | React components, page layouts, React Query hooks, polling UX | `keloia-dashboard-ui-deep-dive.md` |
| **Onboarding Flow** | First-contact WA experience, invite code UX, tenant setup | `keloia-onboarding-deep-dive.md` |
| **Testing Strategy** | Full E2E test flows, mock vs. real Claude, CI pipeline | `keloia-testing-deep-dive.md` |
