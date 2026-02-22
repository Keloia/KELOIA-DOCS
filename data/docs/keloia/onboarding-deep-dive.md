# Keloia — Onboarding Flow Deep Dive

**From "Halo" to Running Business in 10 Minutes**
February 2026

---

## 1. What This Document Covers

Previous deep dives describe the pieces: the [WA BFF](./keloia-wa-bff-deep-dive.md) handles unknown phones, the [core-domain](./keloia-core-domain-deep-dive.md) creates tenants and processes invite codes, the [Dashboard UI](./keloia-dashboard-ui-deep-dive.md) has an OTP login. But nowhere is the **end-to-end story** told from the user's perspective.

This document is that story. It covers three onboarding journeys:

1. **Owner onboarding** — Pak Budi hears about Keloia, sends "Halo" to the WhatsApp number, and within 10 minutes has a tenant, a dashboard login, and an invite code for his team.
2. **Team member onboarding** — Admin Sari receives an invite code from Pak Budi, sends it to Keloia, and is immediately ready to log bookings.
3. **First data entry** — Pak Budi adds his buses, then Admin Sari creates the first booking. The system comes alive.

```
                      ONBOARDING TIMELINE

  Owner (Pak Budi)                  Admin (Mbak Sari)           Driver (Pak Joko)
  ──────────────────               ──────────────────           ──────────────────
  
  1. Sends "Halo" to Keloia
  2. Keloia: "Mau daftar?"
  3. Confirms business name
  4. Tenant created ✅
  5. Gets invite code: K7NH3P
  6. Opens dashboard, adds buses
  7. Shares invite code to Sari ──►  8. Sends "K7NH3P" to Keloia
                                      9. Keloia: "Selamat datang!"
                                     10. Can now log bookings ✅
  
  7. Shares invite code to Joko ──────────────────────────────► 11. Sends "K7NH3P"
                                                                 12. Registered as driver ✅
                                                                 13. Gets morning briefing
```

**Design constraint:** The entire onboarding must happen inside WhatsApp. No "go to this website and fill out a form." The target user base — Indonesian bus operators — live in WhatsApp. Asking them to leave WhatsApp is asking them to leave their comfort zone. The dashboard is **secondary** — the owner discovers it after onboarding, not during.

---

## 2. Persona Zero — How Does the First User Find Keloia?

Before the technical flow: how does Pak Budi even know Keloia exists?

### 2a. Discovery Channels (MVP)

For MVP, there is no marketing funnel. Keloia finds its first 3-5 users through:

- **Direct outreach.** The founders personally know bus operators in Central Java. "Pak Budi, kami bikin alat bantu untuk PO Bus. Boleh coba?"
- **WhatsApp forwarding.** The invite feels native: "Coba kirim 'Halo' ke nomor ini" — same gesture as adding any new WhatsApp contact.
- **Referral from existing users.** Post-MVP, satisfied operators mention it in industry WhatsApp groups.

### 2b. The WhatsApp Number

Keloia has a single WhatsApp Business number: **+62 812-XXXX-XXXX** (the Meta-registered number). This number is:

- Displayed with a business profile (name: "Keloia", description: "Asisten Operasional PO Bus")
- Verified with Meta's WhatsApp Business API
- The same number for all tenants (multi-tenant routing happens server-side via PHONE_LOOKUP)

When Pak Budi saves this number and sends a message, that message hits the WA BFF webhook.

---

## 3. Owner Onboarding — The First 5 Minutes

### 3a. Trigger: Unknown Phone Number

When the WA BFF receives a message from an unknown phone (not in `PHONE_LOOKUP` KV), it enters the onboarding flow instead of the normal AI processing pipeline.

From the WA BFF deep dive, the inbound handler:

```typescript
const user = await resolveUser(c.env.PHONE_LOOKUP, message.from)
if (!user) {
  return handleOnboarding(c.env, message, contact)
}
```

The `handleOnboarding` function manages a simple state machine tracked in a KV key per phone number.

### 3b. Onboarding State Machine

Unlike the normal conversation flow (Durable Object), onboarding uses KV for state. Why? The onboarding conversation is short (3-4 messages), stateless between days, and doesn't need the sequencing guarantees of a Durable Object. A KV key with a 1-hour TTL is sufficient.

```typescript
// packages/wa-bff/src/onboarding.ts

type OnboardingState = {
  step: 'awaiting_intent' | 'awaiting_name' | 'awaiting_invite'
  data: Record<string, string>
}

export async function handleOnboarding(
  env: Env,
  message: InboundMessage,
  contact: { name: string; waId: string },
): Promise<void> {
  const phone = message.from
  const text = extractText(message).trim()

  // Load existing onboarding state (if mid-flow)
  const stateRaw = await env.PHONE_LOOKUP.get(`onboard:${phone}`)
  const state: OnboardingState = stateRaw
    ? JSON.parse(stateRaw)
    : { step: 'awaiting_intent', data: {} }

  switch (state.step) {
    case 'awaiting_intent':
      return handleAwaitingIntent(env, phone, text, contact, state)

    case 'awaiting_name':
      return handleAwaitingName(env, phone, text, contact, state)

    case 'awaiting_invite':
      return handleAwaitingInvite(env, phone, text, contact, state)
  }
}
```

### 3c. Step 1 — First Contact: "What Would You Like to Do?"

The user sends anything ("Halo", "Hi", "Mau coba", whatever). Keloia responds with two clear options.

```typescript
async function handleAwaitingIntent(
  env: Env,
  phone: string,
  text: string,
  contact: { name: string },
  state: OnboardingState,
): Promise<void> {
  // Check if the text looks like an invite code (6 alphanumeric chars, uppercase)
  if (/^[A-Z2-9]{6}$/.test(text.toUpperCase())) {
    // Skip straight to invite code validation
    state.step = 'awaiting_invite'
    return handleAwaitingInvite(env, phone, text, contact, state)
  }

  await env.WA_OUTBOUND.send({
    type: 'buttons',
    to: phone,
    body: `Halo ${contact.name}! 👋\n\nSelamat datang di Keloia — asisten operasional untuk bisnis PO Bus.\n\nMau mulai dari mana?`,
    buttons: [
      { id: 'onboard_new', title: '🏢 Daftarkan Bisnis' },
      { id: 'onboard_join', title: '🎟️ Punya Kode Undangan' },
    ],
  })

  // Save state — awaiting their choice
  state.step = 'awaiting_intent'
  state.data.contactName = contact.name
  await saveOnboardingState(env, phone, state)
}
```

**Two paths:**
- **"Daftarkan Bisnis"** → Owner path. Creates a new tenant.
- **"Punya Kode Undangan"** → Team member path. Joins an existing tenant.

**Shortcut:** If the user's first message IS an invite code (6 chars, matching the code alphabet), skip the choice and go straight to invite validation. This handles the case where Admin Sari receives the code from Pak Budi and immediately types it.

### 3d. Step 2 — Owner: "What's Your Business Called?"

When the user taps "Daftarkan Bisnis":

```typescript
// After user taps 'onboard_new' button
async function handleNewBusiness(
  env: Env,
  phone: string,
  contact: { name: string },
  state: OnboardingState,
): Promise<void> {
  await env.WA_OUTBOUND.send({
    type: 'text',
    to: phone,
    body: 'Baik! Untuk mendaftarkan bisnis Anda, saya perlu nama perusahaan/PO Bus.\n\nContoh: "PO Jaya Utama", "Nusantara Transport", dll.\n\nKetik nama bisnis Anda:',
  })

  state.step = 'awaiting_name'
  await saveOnboardingState(env, phone, state)
}
```

### 3e. Step 3 — Owner: Confirm and Create Tenant

The user types their business name. Keloia creates the tenant.

```typescript
async function handleAwaitingName(
  env: Env,
  phone: string,
  text: string,
  contact: { name: string },
  state: OnboardingState,
): Promise<void> {
  const businessName = text.trim()

  if (businessName.length < 2 || businessName.length > 100) {
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: phone,
      body: 'Nama bisnis terlalu pendek atau terlalu panjang. Coba ketik ulang ya:',
    })
    return
  }

  // Call core-domain to create tenant
  const result = await callCore(env.CORE, '/internal/tenant/create', {
    name: businessName,
    ownerName: state.data.contactName ?? contact.name,
    ownerPhone: phone,
  })

  // Clean up onboarding state
  await env.PHONE_LOOKUP.delete(`onboard:${phone}`)

  // Send welcome message with invite code
  await env.WA_OUTBOUND.send({
    type: 'text',
    to: phone,
    body: `✅ Bisnis "${businessName}" berhasil didaftarkan!\n\n` +
      `Anda terdaftar sebagai Owner.\n\n` +
      `📋 *Kode Undangan Tim:*\n` +
      `\`${result.inviteCode}\`\n\n` +
      `Bagikan kode ini ke admin dan driver Anda. Mereka tinggal kirim kode ini ke Keloia untuk bergabung.\n\n` +
      `⏰ Kode berlaku 30 hari.\n\n` +
      `Mau lanjut? Coba kirim pesan seperti:\n` +
      `"booking Pak Agus tanggal 15 Maret Jogja Semarang"\n\n` +
      `Atau buka dashboard di:\n` +
      `🔗 dashboard.keloia.id`,
  })
}
```

**What just happened server-side:**

1. `core-domain.createTenant()` atomically inserts `tenant` + `owner user` rows (via `db.batch()`)
2. `PHONE_LOOKUP` KV gets `phone:{ownerPhone}` → `{ tenantId, userId, role: 'owner' }`
3. `PHONE_LOOKUP` KV gets `invite:{K7NH3P}` → `{ tenantId, tenantName }` (30-day TTL)
4. `activity_log` records `tenant_created`
5. The owner's next message will resolve via `PHONE_LOOKUP` and enter the normal AI pipeline

**From zero to operational in 3 WhatsApp messages.** The owner can immediately start logging bookings via WhatsApp.

### 3f. The Welcome Message Is Doing 4 Things

The welcome message after tenant creation is carefully constructed:

1. **Confirms success** — "Bisnis X berhasil didaftarkan" gives immediate closure.
2. **Delivers the invite code** — The most important artifact. Monospace formatting (`\`K7NH3P\``) makes it easy to copy.
3. **Teaches first action** — "Coba kirim pesan seperti: booking Pak Agus..." gives a concrete next step. The user doesn't have to guess what to do next.
4. **Mentions the dashboard** — A gentle pointer, not a requirement. "Atau buka dashboard di..." — the owner discovers it when ready.

---

## 4. Team Member Onboarding — Admin and Driver

### 4a. The Invite Code Journey

The owner shares the invite code to team members through their normal channel — usually a personal WhatsApp message or a voice call. "Sari, kirim kode ini ke nomor Keloia ya: K7NH3P."

The team member then:
1. Saves the Keloia number
2. Sends the invite code (or any message, then taps "Punya Kode Undangan")

### 4b. Step 1 — Team Member Sends Invite Code

If the team member's first message is the invite code directly:

```typescript
async function handleAwaitingInvite(
  env: Env,
  phone: string,
  text: string,
  contact: { name: string },
  state: OnboardingState,
): Promise<void> {
  const code = text.trim().toUpperCase()

  // Validate format
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: phone,
      body: 'Kode undangan terdiri dari 6 karakter (huruf dan angka).\n\nContoh: K7NH3P\n\nCoba ketik ulang:',
    })
    return
  }

  // Ask for their role before registering
  state.data.inviteCode = code
  await env.WA_OUTBOUND.send({
    type: 'buttons',
    to: phone,
    body: `Baik! Anda mendaftar dengan kode: ${code}\n\nPosisi Anda di tim:`,
    buttons: [
      { id: 'role_admin', title: '📋 Admin' },
      { id: 'role_driver', title: '🚌 Driver' },
    ],
  })

  state.step = 'awaiting_role'
  await saveOnboardingState(env, phone, state)
}
```

### 4c. Step 2 — Role Selection and Registration

After the user taps their role button:

```typescript
async function handleRoleSelection(
  env: Env,
  phone: string,
  role: 'admin' | 'driver',
  contact: { name: string },
  state: OnboardingState,
): Promise<void> {
  const result = await callCore(env.CORE, '/internal/team/register', {
    phone,
    name: state.data.contactName ?? contact.name,
    inviteCode: state.data.inviteCode,
    role,
  })

  // Clean up onboarding state
  await env.PHONE_LOOKUP.delete(`onboard:${phone}`)

  if (!result.success) {
    await env.WA_OUTBOUND.send({
      type: 'text',
      to: phone,
      body: `❌ ${result.error}\n\nHubungi pemilik bisnis untuk kode undangan yang baru.`,
    })
    return
  }

  // Role-specific welcome
  const welcomeMessages: Record<string, string> = {
    admin: `✅ Selamat datang, ${contact.name}! 🎉\n\n` +
      `Anda terdaftar sebagai *Admin*.\n\n` +
      `Anda bisa:\n` +
      `📋 Catat booking: "booking Pak Agus tanggal 15 Jogja Semarang"\n` +
      `💰 Catat pembayaran: "Pak Agus transfer DP 5 juta"\n` +
      `📅 Cek jadwal: "jadwal besok"\n` +
      `🔧 Lapor masalah: "Bus 03 AC mati"\n\n` +
      `Buka dashboard di: dashboard.keloia.id`,

    driver: `✅ Selamat datang, ${contact.name}! 🎉\n\n` +
      `Anda terdaftar sebagai *Driver*.\n\n` +
      `Anda bisa:\n` +
      `📅 Cek jadwal: "jadwal saya besok"\n` +
      `🔧 Lapor masalah bus: "Bus 03 AC mati"\n\n` +
      `Setiap pagi jam 5, Anda akan menerima briefing trip hari ini. 🕔`,
  }

  await env.WA_OUTBOUND.send({
    type: 'text',
    to: phone,
    body: welcomeMessages[role]!,
  })
}
```

**What happened server-side:**

1. `core-domain.registerTeamMember()` validates the invite code in KV
2. Checks phone isn't already registered (prevents double-registration)
3. Inserts `user` row in D1 with the correct `tenant_id` and `role`
4. Sets `PHONE_LOOKUP` KV: `phone:{phone}` → `{ tenantId, userId, role }`
5. Logs `team_member_registered` in activity log
6. The new user's next message enters the normal AI pipeline

### 4d. Role-Specific Welcome Messages

The welcome message teaches the user what they can do — tailored to their role:

| Role | Capabilities Mentioned | Dashboard Link? |
|---|---|---|
| **Admin** | Book, record payment, check schedule, report issues | ✅ Yes |
| **Driver** | Check schedule, report bus issues, morning briefing mention | ❌ No (drivers don't use dashboard) |

Drivers don't get a dashboard link because they don't have dashboard access (MVP scope). Their entire interaction is WhatsApp-only.

---

## 5. Onboarding State Persistence

### 5a. KV-Based State (Not Durable Object)

Onboarding state is stored in `PHONE_LOOKUP` KV under a dedicated prefix:

```typescript
async function saveOnboardingState(
  env: Env,
  phone: string,
  state: OnboardingState,
): Promise<void> {
  await env.PHONE_LOOKUP.put(
    `onboard:${phone}`,
    JSON.stringify(state),
    { expirationTtl: 3600 }, // 1 hour — abandoned onboarding auto-cleans
  )
}
```

**Why KV, not Durable Object?**

| Concern | Durable Object | KV |
|---|---|---|
| Onboarding is 3-4 messages | Overkill — full actor lifecycle for 3 messages | Sufficient |
| State expires if abandoned | Need alarm + cleanup logic | 1-hour TTL auto-expires |
| Ordering matters? | Not really — messages arrive sequentially in WhatsApp | KV reads are fast enough |
| Cost | $0.15/million requests + storage | $0.50/million reads, no storage if TTL expires |

The onboarding conversation is so simple that a KV key with a 1-hour TTL is the right tool. If the user abandons mid-flow and comes back tomorrow, they start fresh. No stale state to debug.

### 5b. Button Reply Routing

The WA BFF's inbound handler needs to detect button replies from the onboarding flow and route them correctly. Button IDs prefixed with `onboard_` and `role_` distinguish these from normal conversation buttons:

```typescript
// In wa-bff/src/routes/inbound.ts — extended for onboarding button handling

async function processEvent(c: Context, event: NormalizedEvent) {
  // ...existing logic...
  
  const user = await resolveUser(c.env.PHONE_LOOKUP, message.from)
  
  if (!user) {
    // Check if this is an onboarding button reply
    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      const buttonId = message.interactive.button_reply.id
      return handleOnboardingButton(c.env, message.from, buttonId, contact)
    }
    return handleOnboarding(c.env, message, contact)
  }
  
  // ...normal flow...
}

async function handleOnboardingButton(
  env: Env,
  phone: string,
  buttonId: string,
  contact: { name: string },
): Promise<void> {
  const stateRaw = await env.PHONE_LOOKUP.get(`onboard:${phone}`)
  if (!stateRaw) {
    // State expired — restart
    return handleOnboarding(env, { from: phone } as any, contact)
  }
  const state: OnboardingState = JSON.parse(stateRaw)

  switch (buttonId) {
    case 'onboard_new':
      return handleNewBusiness(env, phone, contact, state)
    case 'onboard_join':
      state.step = 'awaiting_invite'
      await saveOnboardingState(env, phone, state)
      await env.WA_OUTBOUND.send({
        type: 'text',
        to: phone,
        body: 'Silakan ketik kode undangan dari pemilik bisnis Anda:',
      })
      return
    case 'role_admin':
      return handleRoleSelection(env, phone, 'admin', contact, state)
    case 'role_driver':
      return handleRoleSelection(env, phone, 'driver', contact, state)
  }
}
```

---

## 6. Edge Cases and Error Handling

### 6a. Invalid Invite Code

```
User:   "XYZ123"
Keloia: "❌ Kode undangan tidak valid atau sudah kedaluwarsa.
         Hubungi pemilik bisnis untuk kode undangan yang baru."
```

Stays in `awaiting_invite` state. The user can try again.

### 6b. Expired Invite Code (>30 days)

Same error as invalid — KV TTL auto-deletes the code after 30 days. The owner needs to generate a new one from the dashboard (Team Settings page → "Buat Kode Undangan Baru").

### 6c. Phone Already Registered

```
User:   "K7NH3P" (but phone is already in PHONE_LOOKUP)
Keloia: "❌ Nomor Anda sudah terdaftar di Keloia.
         Kirim pesan apa saja untuk mulai menggunakan."
```

This handles the case where someone re-saves the Keloia number and tries to register again. Their existing registration is preserved — the `resolveUser` check should actually catch this before reaching onboarding, but the core-domain `registerTeamMember` function also validates as defense-in-depth.

### 6d. Owner Tries to Join with Invite Code

If someone taps "Punya Kode Undangan" and enters a valid code, they register as admin or driver — not owner. There's only one owner per tenant (created during tenant creation). If a business needs multiple owners, the current owner can promote an admin to owner via the dashboard (post-MVP feature).

### 6e. Abandoned Onboarding

If the user sends "Halo", sees the welcome message, and never replies — the `onboard:{phone}` KV key expires after 1 hour. Next time they message, they get the welcome screen again. Clean slate.

### 6f. User Sends Normal Message During Onboarding

If the user types "booking Pak Agus tanggal 15" while in onboarding (phone not yet registered), the text doesn't match an invite code or a button response. The system recognizes they're trying to use Keloia before completing registration:

```typescript
// In handleOnboarding, if state.step is 'awaiting_invite' but text doesn't match code format:
await env.WA_OUTBOUND.send({
  type: 'text',
  to: phone,
  body: 'Anda perlu mendaftar dulu sebelum menggunakan Keloia.\n\n' +
    'Ketik kode undangan dari pemilik bisnis Anda, atau ketik "daftar" untuk mendaftarkan bisnis baru.',
})
```

---

## 7. Dashboard First Login — The Owner's Second Discovery

### 7a. When Does the Owner Open the Dashboard?

The welcome message mentions `dashboard.keloia.id` but doesn't force it. The owner typically opens the dashboard in one of these moments:

- **Immediately after onboarding** — curious to see what it looks like
- **After logging a few bookings via WA** — wants to see the schedule visually
- **Next morning** — checks if yesterday's data is there

### 7b. First Login Flow

1. Owner navigates to `dashboard.keloia.id`
2. Sees login page (phone + OTP)
3. Enters the same phone number used for WhatsApp registration
4. Receives OTP via WhatsApp (same channel, feels natural)
5. Enters OTP → session created → redirected to `/` (schedule page)

### 7c. Empty State Experience

On first login, every page is empty. Empty states must feel encouraging, not broken.

```
┌────────────────────────────────────────────────┐
│  Jadwal — 23 Februari 2026                      │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │                                         │    │
│  │     📋                                  │    │
│  │                                         │    │
│  │     Belum ada jadwal untuk hari ini      │    │
│  │                                         │    │
│  │     Booking dari WhatsApp akan muncul    │    │
│  │     di sini secara otomatis.             │    │
│  │                                         │    │
│  │     Atau buat booking baru:              │    │
│  │     [ + Booking Baru ]                   │    │
│  │                                         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
└────────────────────────────────────────────────┘
```

**Key empty-state principles:**

| Page | Empty State Message | Action Offered |
|---|---|---|
| **Jadwal** | "Booking dari WhatsApp akan muncul di sini otomatis" | [+ Booking Baru] button |
| **Armada** | "Belum ada bus terdaftar. Tambahkan bus pertama Anda." | [+ Tambah Bus] button |
| **Keuangan** | "Data keuangan akan terisi setelah ada booking dan pembayaran." | None (passive) |
| **Tim** | Shows the owner as the only member + invite code display | [Buat Kode Undangan] button |

The Armada empty state is important — it drives the owner to set up their fleet.

---

## 8. Initial Fleet Setup — Adding Buses

### 8a. Why Fleet Setup Matters Early

Keloia's conflict detection depends on knowing which buses exist. Without bus data, the AI can extract "Bus 01" from a WhatsApp message but can't check for conflicts or suggest alternatives.

The system works without bus data (bookings are created with `busName` as text, not `busId` as foreign key), but the value proposition is significantly stronger with fleet data.

### 8b. Dashboard: Add Bus Dialog

```typescript
// Simplified shape — packages/dashboard-ui/src/components/add-bus-dialog.tsx
// Form fields: name (required), capacity, features (checkboxes: AC, toilet, reclining, TV)
// On submit: POST /api/assets → core-domain creates bus record
// On success: bus appears in the fleet grid immediately
```

### 8c. WhatsApp: Bus Setup Prompt

After creating a few bookings, if the AI detects bus names it hasn't seen before, it can proactively suggest:

```
Keloia: "Saya perhatikan Anda sering menyebut 'Bus 01' dan 'Bus 03'.
         Mau saya daftarkan bus-bus Anda supaya bisa deteksi jadwal bentrok otomatis?
         
         Kirim daftar bus Anda, contoh:
         'Bus 01 — 50 kursi, AC
          Bus 02 — 45 kursi, AC + toilet
          Bus 03 — 40 kursi'"
```

This is a **post-MVP feature** — for MVP, fleet setup happens via the dashboard only.

---

## 9. The First Booking — Making the System Come Alive

### 9a. Why This Moment Matters

The first confirmed booking is the moment Keloia transitions from "an app I installed" to "the system that runs my business." Until this moment, the owner is evaluating. After this moment, the owner has data in the system — switching cost is created.

### 9b. Via WhatsApp (Most Likely Path)

```
Owner:  "booking Pak Agus tanggal 15 maret jogja semarang bus 01 15jt"

Keloia: "Saya catat booking baru ya:
         📋 Klien: Pak Agus
         📅 Tanggal: 15 Maret 2026
         🚌 Rute: Jogja → Semarang
         🚌 Bus: Bus 01
         💰 Harga: Rp 15.000.000

         Betul seperti ini?"
         
         [✅ Ya, betul]  [❌ Koreksi]

Owner:  [taps ✅ Ya, betul]

Keloia: "✅ Booking berhasil dicatat!
         
         📋 Booking Pak Agus — 15 Maret 2026
         Jogja → Semarang, Bus 01, Rp 15.000.000
         Status: Menunggu konfirmasi
         
         Mau langsung konfirmasi booking ini?"
```

### 9c. Post-First-Booking State

After the first booking, the dashboard immediately reflects it:

- **Jadwal page**: shows the booking row (pending status)
- **Keuangan page**: shows "1 booking, Rp 15.000.000 total, Rp 15.000.000 piutang"
- **Alert**: "1 booking menunggu konfirmasi" appears in the alert banner

The system feels alive. The owner realizes: "When Sari books something via WhatsApp, I see it here instantly." This is the "aha moment."

---

## 10. Invite Code Management

### 10a. Code Generation

Invite codes are generated during tenant creation (`createTenant`) and can be regenerated from the dashboard.

Code properties:
- 6 characters from safe alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I confusion)
- Stored in `PHONE_LOOKUP` KV: `invite:{code}` → `{ tenantId, tenantName }`
- 30-day TTL — auto-expires
- One active code per tenant at a time (generating a new one invalidates the old one)

### 10b. Dashboard: Invite Code Section

On the Tim (Team) page, the owner sees:

```
┌────────────────────────────────────────────────┐
│  Kode Undangan Tim                              │
│                                                 │
│  Kode aktif: K7NH3P                             │
│  Berlaku sampai: 22 Maret 2026                  │
│                                                 │
│  [ 📋 Salin Kode ]  [ 🔄 Buat Kode Baru ]      │
│                                                 │
│  Bagikan kode ini ke admin dan driver Anda.      │
│  Mereka tinggal kirim kode ini ke nomor Keloia.  │
└────────────────────────────────────────────────┘
```

"Salin Kode" uses `navigator.clipboard.writeText()` — the owner copies it and pastes into a WhatsApp message to their team member.

"Buat Kode Baru" generates a fresh code and invalidates the previous one. Use case: the owner shared the code in a group chat and wants to prevent unauthorized registrations.

### 10c. Why Not a Registration Link?

A registration link (e.g., `keloia.id/join/K7NH3P`) would be more conventional. We use a plain 6-character code instead because:

1. **Voice-shareable.** "Kodenya K-tujuh-N-H-tiga-P" works over a phone call. A URL doesn't.
2. **No app install friction.** A link implies "go to a website." A code implies "type it into WhatsApp" — which is where the user already is.
3. **Copy-paste across channels.** The code works whether shared via WhatsApp text, voice call, SMS, or written on a Post-it note.

---

## 11. Security Considerations

### 11a. Invite Code Abuse

| Threat | Mitigation |
|---|---|
| Brute-force guessing | 30^6 = 729 million combinations. Rate limiting on the WA BFF (10 msgs/min) makes brute force impractical. |
| Code shared publicly | 30-day TTL limits exposure. Owner can regenerate anytime. Team page shows who registered. |
| Wrong role selected | Owner can change any team member's role from the dashboard (Team Settings). |
| Unauthorized tenant creation | Anyone can create a tenant — but a tenant with no data has no value. Abuse = creating empty tenants, which auto-clean is a post-MVP concern. |

### 11b. Phone Number as Identity

The entire auth model is phone-number-based. Risks and mitigations:

| Risk | Mitigation |
|---|---|
| SIM swap attack | Low risk at MVP scale (1-5 tenants, all known operators). Post-MVP: add optional PIN. |
| Shared phone | Not a real concern — each person has their own phone in this market. |
| Phone number change | Owner contacts support (us, the founders, at MVP scale). Post-MVP: self-service phone migration in dashboard. |

---

## 12. Complete Onboarding State Machine

```
                    ┌──────────────────────┐
                    │   Unknown Phone      │
                    │   Sends Message      │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Is text an invite   │──── Yes ──► awaiting_role
                    │  code format?        │
                    └──────────┬───────────┘
                               │ No
                    ┌──────────▼───────────┐
                    │  Show welcome +      │
                    │  two buttons         │
                    │  [Daftarkan Bisnis]  │
                    │  [Punya Kode]        │
                    └──────────┬───────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │                           │
    ┌────────────▼──────────┐   ┌────────────▼──────────┐
    │  "Daftarkan Bisnis"   │   │  "Punya Kode"         │
    │  → awaiting_name      │   │  → awaiting_invite    │
    └────────────┬──────────┘   └────────────┬──────────┘
                 │                           │
    ┌────────────▼──────────┐   ┌────────────▼──────────┐
    │  User types business  │   │  User types invite    │
    │  name                 │   │  code                 │
    └────────────┬──────────┘   └────────────┬──────────┘
                 │                           │
    ┌────────────▼──────────┐   ┌────────────▼──────────┐
    │  createTenant()       │   │  Validate code in KV  │
    │  → tenant + owner     │   │  → show role buttons  │
    │  → invite code        │   │  [Admin] [Driver]     │
    └────────────┬──────────┘   └────────────┬──────────┘
                 │                           │
    ┌────────────▼──────────┐   ┌────────────▼──────────┐
    │  Welcome message      │   │  registerTeamMember() │
    │  + invite code        │   │  → user created       │
    │  + dashboard link     │   │  → PHONE_LOOKUP set   │
    └────────────┬──────────┘   └────────────┬──────────┘
                 │                           │
                 └──────────────┬────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  User registered ✅    │
                    │  Next message enters  │
                    │  normal AI pipeline   │
                    └───────────────────────┘
```

---

## 13. Timing: The 10-Minute Promise

| Step | Actor | Time | Cumulative |
|---|---|---|---|
| 1. Save Keloia number, send "Halo" | Owner | 30s | 0:30 |
| 2. Read welcome, tap "Daftarkan Bisnis" | Owner | 15s | 0:45 |
| 3. Type business name | Owner | 20s | 1:05 |
| 4. Read welcome, copy invite code | Owner | 30s | 1:35 |
| 5. Send first test booking via WA | Owner | 60s | 2:35 |
| 6. Confirm booking | Owner | 10s | 2:45 |
| 7. Open dashboard, login with OTP | Owner | 90s | 4:15 |
| 8. See booking on dashboard | Owner | 10s | 4:25 |
| 9. Share invite code to admin | Owner | 30s | 4:55 |
| 10. Admin sends code, registers | Admin | 60s | 5:55 |
| 11. Admin sends first booking | Admin | 60s | 6:55 |
| 12. Owner sees it on dashboard | Owner | 30s | 7:25 |

**Under 8 minutes** from first contact to a fully operational two-person team with data flowing through the system. The "10-minute promise" has margin.

---

## 14. File Structure Additions

The onboarding flow adds files to the WA BFF package only — no new packages.

```
packages/wa-bff/src/
├── ...existing files...
├── onboarding.ts               # Onboarding state machine
│                                 (handleOnboarding, handleNewBusiness,
│                                  handleAwaitingName, handleAwaitingInvite,
│                                  handleRoleSelection, handleOnboardingButton)
└── onboarding-messages.ts      # Welcome message templates
                                  (role-specific, separated for easy editing)
```

The `onboarding.ts` file is ~150 lines. The state machine is a `switch` on 4 steps, each with a clear handler. No abstraction needed — the flow is linear and won't grow beyond these steps.

---

## 15. Onboarding Metrics (Post-MVP)

Track these to understand where users drop off:

| Metric | How to Track | What It Tells Us |
|---|---|---|
| Welcome-to-registration | Count `tenant_created` / count first-contact messages | Conversion rate — are people completing registration? |
| Registration-to-first-booking | Time between `tenant_created` and first `booking_created` | Activation speed — do they use it immediately? |
| Invite-to-team-join | Time between invite code generation and first team member registration | Viral coefficient — are owners inviting their team? |
| Onboarding abandonment | Count expired `onboard:*` KV keys (via KV analytics) | Drop-off — where in the flow do people leave? |
| Dashboard-to-WA ratio | First booking via dashboard vs. WhatsApp | Channel preference — is WA the primary path as expected? |

For MVP, these are logged in `activity_log` and can be queried manually. Post-MVP, a simple analytics view on the dashboard.

---

## 16. What This Doc Does NOT Cover (Next Deep Dives)

| Topic | What's Needed | Doc |
|---|---|---|
| **Testing Strategy** | Component tests, E2E flows (including onboarding test), mock Claude, CI pipeline | `keloia-testing-deep-dive.md` |
