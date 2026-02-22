# Keloia — Dashboard UI Deep Dive

**The Operational Window Into the Business**
February 2026

---

## 1. What This Document Covers

The [main architecture doc](./keloia-architecture.md) defines the Dashboard UI as "SPA on Cloudflare Pages, calls Dashboard BFF." The [library architecture](./keloia-library-architecture.md) specifies the tech stack (React 19, Vite, Tailwind v4, shadcn/ui, React Query). The [Dashboard BFF deep dive](./keloia-dashboard-bff-deep-dive.md) documents every API endpoint it consumes and the Hono RPC type-safe client.

This document goes **inside** the dashboard — page layouts, component architecture, React Query hooks, auth flow, real-time polling, error/loading states, and responsive design. This is the visual layer of Keloia.

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                      │
│                                                               │
│  ┌─ App Shell ─────────────────────────────────────────────┐  │
│  │  ┌─ Sidebar ──┐  ┌─ Main Content ───────────────────┐  │  │
│  │  │            │  │                                    │  │  │
│  │  │  📋 Jadwal │  │  ┌──────────────────────────────┐  │  │  │
│  │  │  🚌 Armada │  │  │  Page: Schedule / Assets /   │  │  │  │
│  │  │  💰 Keuangan│  │  │  Financials / Settings       │  │  │  │
│  │  │  ⚙️ Tim    │  │  │                              │  │  │  │
│  │  │            │  │  └──────────────────────────────┘  │  │  │
│  │  │  ─────     │  │  ┌──────────────────────────────┐  │  │  │
│  │  │  🔔 3      │  │  │  Alert Banner (if any)       │  │  │  │
│  │  │            │  │  └──────────────────────────────┘  │  │  │
│  │  └────────────┘  └────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
│  React 19 + Tailwind v4 + shadcn/ui + React Query             │
│  ↕  Hono RPC (type-safe)                                      │
│  dashboard-bff (same domain: dashboard.keloia.id/api/*)       │
└──────────────────────────────────────────────────────────────┘
```

**Design principle:** The dashboard is a **read-heavy operational window**, not a data entry app. Most data enters the system via WhatsApp. The dashboard exists so the owner and admin can see the whole picture at a glance — today's schedule, bus status, money in/out, and alerts. Write operations (create booking, record payment from dashboard) are secondary but supported.

---

## 2. Page Map

The dashboard has 5 pages, mapped 1:1 to the business pillars plus cross-cutting concerns:

| Page | Route | Pillar | Who Sees It | Primary Use |
|---|---|---|---|---|
| **Jadwal (Schedule)** | `/` | Schedule | Owner, Admin | Today's bookings, calendar, create/edit bookings |
| **Armada (Fleet)** | `/armada` | Assets | Owner, Admin | Bus status grid, maintenance history |
| **Keuangan (Financials)** | `/keuangan` | Financial | Owner (full), Admin (summary) | Income, receivables, payment recording |
| **Tim (Team Settings)** | `/tim` | — | Owner only | Team members, role management, invite codes |
| **Login** | `/login` | — | Unauthenticated | Phone number + OTP entry |

There is no separate "Alerts" page. Alerts appear as a notification bell in the sidebar with a count badge, and an alert banner at the top of whichever page the user is on. Dismissing an alert is inline.

**Why Indonesian page names in the URL?** The target users are Indonesian bus operators. `/keuangan` is more recognizable than `/financials`. URLs are a tiny UX signal that says "this is built for you."

---

## 3. Routing — Client-Side with Lazy Loading

No framework router. React Router is the simplest choice for a pure SPA with 5 routes.

```typescript
// packages/dashboard-ui/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,  // Refresh when user tabs back
      staleTime: 15_000,           // 15s — aligns with polling intervals
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

```typescript
// packages/dashboard-ui/src/App.tsx
import { Routes, Route, Navigate } from 'react-router'
import { lazy, Suspense } from 'react'
import { AuthGate } from './components/auth-gate'
import { AppShell } from './components/app-shell'
import { PageSkeleton } from './components/page-skeleton'

const Login = lazy(() => import('./pages/login'))
const Schedule = lazy(() => import('./pages/schedule'))
const Fleet = lazy(() => import('./pages/fleet'))
const Financials = lazy(() => import('./pages/financials'))
const Team = lazy(() => import('./pages/team'))

export function App() {
  return (
    <Routes>
      <Route path="/login" element={
        <Suspense fallback={<PageSkeleton />}>
          <Login />
        </Suspense>
      } />

      {/* All dashboard routes require auth */}
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          <Route index element={
            <Suspense fallback={<PageSkeleton />}><Schedule /></Suspense>
          } />
          <Route path="/armada" element={
            <Suspense fallback={<PageSkeleton />}><Fleet /></Suspense>
          } />
          <Route path="/keuangan" element={
            <Suspense fallback={<PageSkeleton />}><Financials /></Suspense>
          } />
          <Route path="/tim" element={
            <Suspense fallback={<PageSkeleton />}><Team /></Suspense>
          } />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

**Why `lazy()`?** Each page is its own chunk. Initial load is just the shell + the login page or the schedule page. Fleet, financials, and team pages load on first navigation. At MVP scale the bundles are small, but it's a good habit that costs nothing.

---

## 4. Auth Flow — Phone-Based OTP

### 4a. Auth Gate

The `AuthGate` component checks if the user is authenticated before rendering child routes.

```typescript
// packages/dashboard-ui/src/components/auth-gate.tsx
import { Outlet, Navigate } from 'react-router'
import { useAuth } from '../hooks/use-auth'
import { PageSkeleton } from './page-skeleton'

export function AuthGate() {
  const { user, isLoading } = useAuth()

  if (isLoading) return <PageSkeleton />
  if (!user) return <Navigate to="/login" replace />

  return <Outlet />
}
```

### 4b. Auth Hook

```typescript
// packages/dashboard-ui/src/hooks/use-auth.tsx
import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useNavigate } from 'react-router'

type AuthUser = {
  userId: string
  tenantId: string
  role: 'owner' | 'admin'
}

const AuthContext = createContext<{
  user: AuthUser | null
  isLoading: boolean
  logout: () => void
} | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await api.auth.me.$get()
      if (!res.ok) return null
      return res.json() as Promise<AuthUser>
    },
    retry: false,
    staleTime: 5 * 60_000, // 5 min — session rarely changes mid-use
  })

  const logoutMutation = useMutation({
    mutationFn: () => api.auth.logout.$post(),
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], null)
      navigate('/login')
    },
  })

  return (
    <AuthContext value={{ user: user ?? null, isLoading, logout: logoutMutation.mutate }}>
      {children}
    </AuthContext>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

### 4c. Login Page

The login page has two steps: phone number entry → OTP verification. No password, no OAuth. Matches the WhatsApp-centric auth model.

```typescript
// packages/dashboard-ui/src/pages/login.tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

export default function Login() {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const requestOtp = useMutation({
    mutationFn: () =>
      api.auth['request-otp'].$post({ json: { phone } }),
    onSuccess: () => setStep('otp'),
  })

  const verifyOtp = useMutation({
    mutationFn: () =>
      api.auth['verify-otp'].$post({ json: { phone, otp } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth'] })
      navigate('/')
    },
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-card p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Keloia</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dashboard Operasional
          </p>
        </div>

        {step === 'phone' ? (
          <div className="space-y-4">
            <label className="text-sm font-medium">Nomor WhatsApp</label>
            <Input
              type="tel"
              placeholder="08123456789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button
              className="w-full"
              onClick={() => requestOtp.mutate()}
              disabled={requestOtp.isPending || phone.length < 10}
            >
              {requestOtp.isPending ? 'Mengirim...' : 'Kirim Kode OTP'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Kode OTP akan dikirim via WhatsApp
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="text-sm font-medium">Masukkan Kode OTP</label>
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button
              className="w-full"
              onClick={() => verifyOtp.mutate()}
              disabled={verifyOtp.isPending || otp.length < 6}
            >
              {verifyOtp.isPending ? 'Memverifikasi...' : 'Masuk'}
            </Button>
            <button
              className="w-full text-sm text-muted-foreground hover:underline"
              onClick={() => { setStep('phone'); setOtp('') }}
            >
              Ganti nomor
            </button>

            {verifyOtp.isError && (
              <p className="text-sm text-destructive text-center">
                Kode OTP salah. Silakan coba lagi.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Why OTP via WhatsApp, not SMS?** Bus operators live in WhatsApp. SMS costs money. WhatsApp is free and guaranteed to reach them. The OTP is delivered through the same `WA_OUTBOUND` queue used for all Keloia messages.

---

## 5. App Shell — Sidebar + Content Area

### 5a. Shell Layout

```typescript
// packages/dashboard-ui/src/components/app-shell.tsx
import { Outlet } from 'react-router'
import { Sidebar } from './sidebar'
import { AlertBanner } from './alert-banner'
import { AuthProvider } from '../hooks/use-auth'

export function AppShell() {
  return (
    <AuthProvider>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <AlertBanner />
          <div className="mx-auto max-w-6xl p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </AuthProvider>
  )
}
```

### 5b. Sidebar

```typescript
// packages/dashboard-ui/src/components/sidebar.tsx
import { NavLink } from 'react-router'
import { useAuth } from '../hooks/use-auth'
import { useAlerts } from '../hooks/use-alerts'
import {
  CalendarDays, Bus, Wallet, Users, Bell, LogOut,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', label: 'Jadwal', icon: CalendarDays, roles: ['owner', 'admin'] },
  { to: '/armada', label: 'Armada', icon: Bus, roles: ['owner', 'admin'] },
  { to: '/keuangan', label: 'Keuangan', icon: Wallet, roles: ['owner', 'admin'] },
  { to: '/tim', label: 'Tim', icon: Users, roles: ['owner'] },
]

export function Sidebar() {
  const { user, logout } = useAuth()
  const { alertCount } = useAlerts()

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.roles.includes(user?.role ?? ''),
  )

  return (
    <aside className="hidden w-56 shrink-0 border-r bg-card md:flex md:flex-col">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 font-bold text-lg tracking-tight">
        Keloia
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors
               ${isActive
                 ? 'bg-primary text-primary-foreground'
                 : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`
            }
          >
            <item.icon className="size-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Alert indicator + logout */}
      <div className="border-t p-2 space-y-1">
        {alertCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-amber-600">
            <Bell className="size-4" />
            <span>{alertCount} alert{alertCount > 1 ? 's' : ''}</span>
          </div>
        )}
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" />
          Keluar
        </button>
      </div>
    </aside>
  )
}
```

### 5c. Mobile Navigation

On mobile (< md breakpoint), the sidebar collapses into a bottom tab bar — matching the navigation pattern bus operators are used to from apps like Gojek, Tokopedia, and WhatsApp.

```typescript
// packages/dashboard-ui/src/components/mobile-nav.tsx
import { NavLink } from 'react-router'
import { CalendarDays, Bus, Wallet, Users } from 'lucide-react'
import { useAuth } from '../hooks/use-auth'

export function MobileNav() {
  const { user } = useAuth()
  const items = [
    { to: '/', label: 'Jadwal', icon: CalendarDays },
    { to: '/armada', label: 'Armada', icon: Bus },
    { to: '/keuangan', label: 'Keuangan', icon: Wallet },
    ...(user?.role === 'owner'
      ? [{ to: '/tim', label: 'Tim', icon: Users }]
      : []),
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-card md:hidden">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors
             ${isActive ? 'text-primary' : 'text-muted-foreground'}`
          }
        >
          <item.icon className="size-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

Update the shell to include it:

```typescript
// In app-shell.tsx, add:
<main className="flex-1 overflow-y-auto pb-16 md:pb-0"> {/* pb-16 for mobile nav */}
  ...
</main>
<MobileNav />
```

---

## 6. React Query Hooks — The Data Layer

Every page uses one or more React Query hooks. These hooks are the only place that calls the API. Components never call `api.*` directly.

### 6a. Polling Strategy

| Data | Interval | Stale Time | Why |
|---|---|---|---|
| Schedule (today) | 30s | 15s | Core operational view, must feel live |
| Schedule (other dates) | 60s | 30s | Less urgent, reduces unnecessary requests |
| Assets | 60s | 30s | Bus status changes infrequently |
| Financials | 120s | 60s | Money data is checked periodically, not monitored live |
| Alerts | 15s | 5s | Must surface quickly — alerts are the proactive value |
| Team settings | None | 5 min | Rarely changes, only loaded when page is open |
| Auth (/me) | None | 5 min | Session is stable until logout |

### 6b. Schedule Hook

```typescript
// packages/dashboard-ui/src/hooks/use-schedule.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatISO } from 'date-fns'

export function useSchedule(date: Date) {
  const dateStr = formatISO(date, { representation: 'date' })

  return useQuery({
    queryKey: ['schedule', dateStr],
    queryFn: async () => {
      const res = await api.api.schedule.$get({ query: { date: dateStr } })
      if (!res.ok) throw new Error('Gagal memuat jadwal')
      return res.json()
    },
    refetchInterval: dateStr === todayStr() ? 30_000 : 60_000,
    staleTime: 15_000,
  })
}

export function useBookingDetail(bookingId: string | null) {
  return useQuery({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      if (!bookingId) return null
      const res = await api.api.schedule[':id'].$get({ param: { id: bookingId } })
      if (!res.ok) throw new Error('Booking tidak ditemukan')
      return res.json()
    },
    enabled: !!bookingId,
  })
}

export function useCreateBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CreateBookingInput) => {
      const res = await api.api.bookings.$post({ json: data })
      if (res.status === 409) {
        const body = await res.json()
        throw new ConflictError(body)
      }
      if (!res.ok) throw new Error('Gagal membuat booking')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
    },
  })
}

function todayStr() {
  return formatISO(new Date(), { representation: 'date' })
}
```

### 6c. Alert Hook

```typescript
// packages/dashboard-ui/src/hooks/use-alerts.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useAlerts() {
  const query = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await api.api.alerts.$get()
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  })

  return {
    alerts: query.data ?? [],
    alertCount: query.data?.length ?? 0,
    isLoading: query.isLoading,
  }
}

export function useDismissAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (alertId: string) => {
      await api.api.alerts[':id'].dismiss.$put({ param: { id: alertId } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
```

### 6d. Financial Hook

```typescript
// packages/dashboard-ui/src/hooks/use-financials.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useFinancials(period: 'week' | 'month' = 'week') {
  return useQuery({
    queryKey: ['financials', period],
    queryFn: async () => {
      const res = await api.api.financials.$get({ query: { period } })
      if (!res.ok) throw new Error('Gagal memuat data keuangan')
      return res.json()
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  })
}

export function useRecordPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: RecordPaymentInput) => {
      const res = await api.api.financials.$post({ json: data })
      if (!res.ok) throw new Error('Gagal mencatat pembayaran')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financials'] })
      queryClient.invalidateQueries({ queryKey: ['schedule'] }) // payment may complete a booking
    },
  })
}
```

### 6e. Fleet Hook

```typescript
// packages/dashboard-ui/src/hooks/use-fleet.ts
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useFleet() {
  return useQuery({
    queryKey: ['fleet'],
    queryFn: async () => {
      const res = await api.api.assets.$get()
      if (!res.ok) throw new Error('Gagal memuat data armada')
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useBusDetail(busId: string | null) {
  return useQuery({
    queryKey: ['bus', busId],
    queryFn: async () => {
      if (!busId) return null
      const res = await api.api.assets[':id'].$get({ param: { id: busId } })
      if (!res.ok) throw new Error('Bus tidak ditemukan')
      return res.json()
    },
    enabled: !!busId,
  })
}
```

---

## 7. Page: Jadwal (Schedule)

The schedule page is the default landing page. The owner or admin opens the dashboard and immediately sees today's bookings.

### 7a. Page Structure

```typescript
// packages/dashboard-ui/src/pages/schedule.tsx
import { useState } from 'react'
import { useSchedule, useCreateBooking } from '../hooks/use-schedule'
import { DatePicker } from '@/components/ui/date-picker'
import { BookingTable } from '../components/booking-table'
import { BookingDetailSheet } from '../components/booking-detail-sheet'
import { CreateBookingDialog } from '../components/create-booking-dialog'
import { ConflictAlert } from '../components/conflict-alert'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default function Schedule() {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const { data: bookings, isLoading, error } = useSchedule(selectedDate)

  return (
    <div className="space-y-4">
      {/* Header row: title + date picker + create button */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Jadwal</h1>
        <div className="flex items-center gap-2">
          <DatePicker value={selectedDate} onChange={setSelectedDate} />
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-1 size-4" />
            Booking Baru
          </Button>
        </div>
      </div>

      {/* Status summary chips */}
      {bookings && <ScheduleSummary bookings={bookings} />}

      {/* Booking table */}
      <BookingTable
        bookings={bookings ?? []}
        isLoading={isLoading}
        error={error}
        onRowClick={(id) => setSelectedBookingId(id)}
      />

      {/* Slide-out detail panel */}
      <BookingDetailSheet
        bookingId={selectedBookingId}
        onClose={() => setSelectedBookingId(null)}
      />

      {/* Create booking dialog */}
      <CreateBookingDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        defaultDate={selectedDate}
      />
    </div>
  )
}

function ScheduleSummary({ bookings }: { bookings: Booking[] }) {
  const pending = bookings.filter((b) => b.status === 'pending').length
  const confirmed = bookings.filter((b) => b.status === 'confirmed').length
  const completed = bookings.filter((b) => b.status === 'completed').length

  return (
    <div className="flex gap-3 text-sm">
      {pending > 0 && (
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
          {pending} menunggu
        </span>
      )}
      <span className="rounded-full bg-green-100 px-3 py-1 text-green-700">
        {confirmed} dikonfirmasi
      </span>
      {completed > 0 && (
        <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
          {completed} selesai
        </span>
      )}
    </div>
  )
}
```

### 7b. Booking Table

The primary UI component. Shows bookings as rows with status badges, client name, route, bus, and price.

```typescript
// packages/dashboard-ui/src/components/booking-table.tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateID, formatRupiah } from '../lib/format'

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Menunggu',
  confirmed: 'Dikonfirmasi',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

export function BookingTable({
  bookings, isLoading, error, onRowClick,
}: BookingTableProps) {
  if (error) {
    return (
      <div className="rounded-lg border bg-destructive/5 p-8 text-center text-sm text-destructive">
        Gagal memuat jadwal. Coba refresh halaman.
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Klien</TableHead>
            <TableHead className="hidden md:table-cell">Rute</TableHead>
            <TableHead className="hidden md:table-cell">Bus</TableHead>
            <TableHead className="hidden lg:table-cell">Jam</TableHead>
            <TableHead className="text-right">Harga</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }, (_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 6 }, (_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : bookings.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                Tidak ada jadwal untuk hari ini
              </TableCell>
            </TableRow>
          ) : (
            bookings.map((booking) => (
              <TableRow
                key={booking.id}
                onClick={() => onRowClick(booking.id)}
                className="cursor-pointer hover:bg-muted/50"
              >
                <TableCell>
                  <Badge variant="secondary" className={STATUS_STYLES[booking.status]}>
                    {STATUS_LABELS[booking.status]}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{booking.clientName}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {booking.routeFrom} → {booking.routeTo}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {booking.busName ?? '—'}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {booking.departTime ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  {booking.agreedPrice
                    ? formatRupiah(booking.agreedPrice)
                    : '—'}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

### 7c. Booking Detail — Slide-Out Sheet

Clicking a row opens a shadcn `Sheet` (slide-out panel) with full booking details + payment history.

```typescript
// packages/dashboard-ui/src/components/booking-detail-sheet.tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useBookingDetail } from '../hooks/use-schedule'
import { Badge } from '@/components/ui/badge'
import { formatRupiah, formatDateID } from '../lib/format'

export function BookingDetailSheet({
  bookingId, onClose,
}: { bookingId: string | null; onClose: () => void }) {
  const { data: booking, isLoading } = useBookingDetail(bookingId)

  return (
    <Sheet open={!!bookingId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Detail Booking</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : booking ? (
          <div className="space-y-6 py-4">
            {/* Client + status */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{booking.clientName}</span>
                <Badge className={STATUS_STYLES[booking.status]}>
                  {STATUS_LABELS[booking.status]}
                </Badge>
              </div>
              {booking.clientPhone && (
                <p className="text-sm text-muted-foreground">{booking.clientPhone}</p>
              )}
            </div>

            {/* Trip details */}
            <DetailSection label="Rute" value={`${booking.routeFrom} → ${booking.routeTo}`} />
            <DetailSection label="Tanggal" value={formatDateID(booking.departDate)} />
            {booking.departTime && <DetailSection label="Jam" value={booking.departTime} />}
            {booking.returnDate && <DetailSection label="Pulang" value={formatDateID(booking.returnDate)} />}
            {booking.busName && <DetailSection label="Bus" value={booking.busName} />}
            {booking.driverName && <DetailSection label="Driver" value={booking.driverName} />}

            {/* Payment summary */}
            {booking.agreedPrice && (
              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="text-sm font-medium">Pembayaran</h3>
                <div className="flex justify-between text-sm">
                  <span>Total</span>
                  <span className="font-semibold">{formatRupiah(booking.agreedPrice)}</span>
                </div>
                {booking.payments?.map((payment) => (
                  <div key={payment.id} className="flex justify-between text-sm text-muted-foreground">
                    <span>{payment.type.toUpperCase()} — {payment.method ?? 'N/A'}</span>
                    <span>{formatRupiah(payment.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-2 text-sm font-medium">
                  <span>Sisa</span>
                  <span className={outstanding > 0 ? 'text-amber-600' : 'text-green-600'}>
                    {outstanding > 0 ? formatRupiah(outstanding) : 'LUNAS ✅'}
                  </span>
                </div>
              </div>
            )}

            {booking.notes && <DetailSection label="Catatan" value={booking.notes} />}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function DetailSection({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}
```

### 7d. Create Booking Dialog

The dashboard's create-booking form. More structured than WhatsApp input, but covers the same fields.

```typescript
// packages/dashboard-ui/src/components/create-booking-dialog.tsx (shape only)
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateBooking } from '../hooks/use-schedule'
import { useFleet } from '../hooks/use-fleet'

// Form fields: clientName, clientPhone, routeFrom, routeTo,
// departDate, departTime, returnDate, busId (select from fleet), agreedPrice, notes
// On submit: useCreateBooking.mutate(data)
// On 409 (conflict): show ConflictAlert with conflicting booking + available buses
// On success: close dialog, toast "Booking berhasil dibuat"
```

**Conflict handling in the dialog:** When the BFF returns 409 (conflict), the dialog doesn't close. Instead, it shows an inline alert with the conflicting booking details and a list of available buses as selectable alternatives. The user picks a different bus and re-submits.

---

## 8. Page: Armada (Fleet)

### 8a. Bus Status Grid

Instead of a table, the fleet page uses a card grid — each bus is a card showing status, last maintenance, and next due date. Visual at a glance.

```typescript
// packages/dashboard-ui/src/pages/fleet.tsx
import { useFleet, useBusDetail } from '../hooks/use-fleet'
import { useState } from 'react'
import { BusCard } from '../components/bus-card'
import { BusDetailSheet } from '../components/bus-detail-sheet'

export default function Fleet() {
  const { data: buses, isLoading } = useFleet()
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Armada</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }, (_, i) => <BusCardSkeleton key={i} />)
          : buses?.map((bus) => (
              <BusCard
                key={bus.id}
                bus={bus}
                onClick={() => setSelectedBusId(bus.id)}
              />
            ))}
      </div>

      <BusDetailSheet
        busId={selectedBusId}
        onClose={() => setSelectedBusId(null)}
      />
    </div>
  )
}
```

### 8b. Bus Card

```typescript
// packages/dashboard-ui/src/components/bus-card.tsx
import { Badge } from '@/components/ui/badge'
import { Bus, Wrench, AlertTriangle } from 'lucide-react'
import { formatDateID } from '../lib/format'

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  available:   { label: 'Tersedia', className: 'bg-green-100 text-green-700' },
  booked:      { label: 'Terpakai', className: 'bg-blue-100 text-blue-700' },
  maintenance: { label: 'Servis', className: 'bg-amber-100 text-amber-700' },
  retired:     { label: 'Nonaktif', className: 'bg-muted text-muted-foreground' },
}

export function BusCard({ bus, onClick }: { bus: BusListEntry; onClick: () => void }) {
  const statusConfig = STATUS_CONFIG[bus.status] ?? STATUS_CONFIG.available

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bus className="size-5 text-muted-foreground" />
          <span className="font-semibold">{bus.name}</span>
        </div>
        <Badge variant="secondary" className={statusConfig.className}>
          {statusConfig.label}
        </Badge>
      </div>

      {bus.capacity && (
        <p className="text-sm text-muted-foreground">{bus.capacity} kursi</p>
      )}

      {/* Maintenance status */}
      <div className="flex items-center gap-2 text-sm">
        {bus.isOverdue ? (
          <>
            <AlertTriangle className="size-4 text-red-500" />
            <span className="text-red-600">
              Servis terlambat (terakhir: {bus.lastMaintenance ? formatDateID(bus.lastMaintenance) : 'belum pernah'})
            </span>
          </>
        ) : bus.nextDue ? (
          <>
            <Wrench className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Servis berikutnya: {formatDateID(bus.nextDue)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Tidak ada jadwal servis</span>
        )}
      </div>
    </button>
  )
}
```

---

## 9. Page: Keuangan (Financials)

The financials page shows three sections: summary cards (total income, total bookings, outstanding), a receivables list, and recent payments. Owner sees full detail; admin sees a restricted summary.

```typescript
// packages/dashboard-ui/src/pages/financials.tsx
import { useState } from 'react'
import { useFinancials, useRecordPayment } from '../hooks/use-financials'
import { useAuth } from '../hooks/use-auth'
import { formatRupiah } from '../lib/format'
import { Wallet, FileText, AlertCircle } from 'lucide-react'

export default function Financials() {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const { data, isLoading } = useFinancials(period)
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Keuangan</h1>
        <div className="flex gap-1 rounded-lg border bg-muted p-0.5">
          {(['week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-sm transition-colors
                ${period === p ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              {p === 'week' ? 'Minggu Ini' : 'Bulan Ini'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={Wallet}
          label="Pendapatan"
          value={data ? formatRupiah(data.totalIncome) : '—'}
          isLoading={isLoading}
        />
        <SummaryCard
          icon={FileText}
          label="Total Booking"
          value={data?.totalBookings?.toString() ?? '—'}
          isLoading={isLoading}
        />
        <SummaryCard
          icon={AlertCircle}
          label="Piutang"
          value={data ? formatRupiah(
            data.receivables.reduce((sum, r) => sum + r.outstanding, 0),
          ) : '—'}
          isLoading={isLoading}
          variant="warning"
        />
      </div>

      {/* Receivables list (outstanding payments) */}
      {data && data.receivables.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Belum Lunas</h2>
          <div className="rounded-lg border bg-card divide-y">
            {data.receivables.map((r) => (
              <div key={r.bookingId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{r.clientName}</p>
                  {user?.role === 'owner' && (
                    <p className="text-xs text-muted-foreground">
                      Dibayar {formatRupiah(r.totalPaid)} dari {formatRupiah(r.agreedPrice)}
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold text-amber-600">
                  {formatRupiah(r.outstanding)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent payments — owner only (admin gets summary view) */}
      {user?.role === 'owner' && data?.recentPayments && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Pembayaran Terbaru</h2>
          {/* table of recent payments */}
        </section>
      )}
    </div>
  )
}
```

---

## 10. Page: Tim (Team Settings)

Owner-only page. Shows team members with their roles and provides controls to change roles or generate new invite codes.

```typescript
// packages/dashboard-ui/src/pages/team.tsx (shape)
// - Fetches team members via useTeam() hook
// - Each member row: name, phone, role badge, role dropdown (admin/driver)
// - "Buat Kode Undangan" button → generates invite code → copy to clipboard
// - Invite code is shared via WhatsApp by the owner (manual copy-paste)
// - Cannot demote self (prevented by BFF + disabled in UI)
```

---

## 11. Alert Banner — Cross-Page Notification

Alerts surface at the top of every page. High-severity alerts get a colored banner; info alerts get a neutral one.

```typescript
// packages/dashboard-ui/src/components/alert-banner.tsx
import { useAlerts, useDismissAlert } from '../hooks/use-alerts'
import { X, AlertTriangle, Info } from 'lucide-react'

export function AlertBanner() {
  const { alerts } = useAlerts()
  const dismiss = useDismissAlert()

  // Show only the most urgent undismissed alerts (max 3)
  const visible = alerts.slice(0, 3)

  if (visible.length === 0) return null

  return (
    <div className="space-y-1 border-b bg-muted/30 px-4 py-2 md:px-6">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm
            ${alert.severity === 'high'
              ? 'bg-red-50 text-red-700'
              : alert.severity === 'medium'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-blue-50 text-blue-700'}`}
        >
          <div className="flex items-center gap-2">
            {alert.severity === 'high' || alert.severity === 'medium'
              ? <AlertTriangle className="size-4 shrink-0" />
              : <Info className="size-4 shrink-0" />}
            <span>{alert.message}</span>
          </div>
          <button
            onClick={() => dismiss.mutate(alert.id)}
            className="ml-2 rounded p-1 hover:bg-black/5"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
```

---

## 12. Utility: Formatting Helpers

```typescript
// packages/dashboard-ui/src/lib/format.ts
import { format, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

export function formatDateID(isoDate: string): string {
  return format(parseISO(isoDate), 'd MMMM yyyy', { locale: idLocale })
}
// "2026-03-15" → "15 Maret 2026"

export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}
// 15000000 → "Rp 15.000.000"
```

---

## 13. Styling — Tailwind v4 + shadcn/ui

### 13a. Tailwind v4 Setup

Tailwind v4 uses CSS-first configuration. No `tailwind.config.js`.

```css
/* packages/dashboard-ui/src/index.css */
@import "tailwindcss";
@import "tw-animate-css";

@theme {
  /* Map shadcn CSS variables to Tailwind color tokens */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}

@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.97 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.922 0 0);
    --input: oklch(0.922 0 0);
    --ring: oklch(0.708 0 0);
    --radius: 0.5rem;
  }
}
```

### 13b. shadcn/ui Components Used

The dashboard uses a focused subset of shadcn/ui. No bloated component library — just what's needed:

| Component | Usage |
|---|---|
| `Button` | Actions: create booking, record payment, dismiss, logout |
| `Input` | Form fields in dialogs |
| `Table` | Booking list, payment list, team member list |
| `Badge` | Status indicators (pending/confirmed/completed, bus status) |
| `Sheet` | Slide-out booking detail panel |
| `Dialog` | Create booking, record payment modals |
| `Select` | Bus picker, role picker, period selector |
| `Skeleton` | Loading placeholders |
| `InputOTP` | OTP entry on login |
| `Sonner` (toast) | Success/error feedback ("Booking berhasil dibuat") |

**No charts for MVP.** The value proposition mentions "weekly auto-summary" and "bus utilization rates," but for MVP the dashboard is a table-and-card view. Charts are a post-MVP addition when there's enough data to make them meaningful (~3+ months of usage).

---

## 14. Vite + Cloudflare Pages Configuration

```typescript
// packages/dashboard-ui/vite.config.ts
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Cloudflare Pages serves from dist/
    outDir: 'dist',
    // SPA fallback: Pages handles this via _redirects
  },
})
```

```
# packages/dashboard-ui/public/_redirects
# SPA fallback: all routes serve index.html (client-side routing)
/*    /index.html    200
```

**Deployment:** `pnpm turbo build --filter=dashboard-ui` → `dist/` → Cloudflare Pages auto-deploys from the monorepo. Pages serves static assets from its CDN. The `/api/*` routes are intercepted by the Dashboard BFF Worker via Workers Routes (same-domain setup from the BFF deep dive).

---

## 15. Responsive Design

The dashboard must work on the owner's phone (checking between meetings), the admin's laptop (managing bookings), and a tablet mounted in the office.

### 15a. Breakpoint Strategy

| Breakpoint | Device | Layout |
|---|---|---|
| `< md` (< 768px) | Phone | Bottom tab nav, single column, no sidebar |
| `md-lg` (768-1024px) | Tablet | Sidebar visible, 2-column card grid |
| `> lg` (> 1024px) | Desktop | Sidebar + wide content area, 3-column grid |

### 15b. Mobile-First Patterns

- **Booking table:** On mobile, hide route, bus, and time columns. Show only status, client name, and price. Full details on tap (sheet).
- **Fleet grid:** 1 column on phone, 2 on tablet, 3 on desktop.
- **Financial cards:** Stack vertically on phone, 3-across on desktop.
- **Sidebar:** Hidden on mobile, replaced by bottom tab bar.
- **Dialogs:** Full-screen on mobile (`SheetContent` with `side="bottom"`), modal on desktop.

---

## 16. Error and Empty States

Every data-driven component handles three states: loading, empty, and error.

```typescript
// Pattern used across all pages:

// Loading → Skeleton placeholders
if (isLoading) return <ComponentSkeleton />

// Error → Friendly message + retry
if (error) return (
  <div className="rounded-lg border bg-destructive/5 p-8 text-center">
    <p className="text-sm text-destructive">Gagal memuat data</p>
    <Button variant="ghost" size="sm" onClick={() => refetch()} className="mt-2">
      Coba lagi
    </Button>
  </div>
)

// Empty → Contextual message
if (data.length === 0) return (
  <div className="rounded-lg border bg-muted/30 p-12 text-center">
    <p className="text-muted-foreground">Tidak ada jadwal untuk hari ini</p>
    <p className="text-sm text-muted-foreground mt-1">
      Booking dari WhatsApp akan muncul di sini secara otomatis
    </p>
  </div>
)
```

**Key UX note:** The empty state message says "Booking dari WhatsApp akan muncul di sini secara otomatis." This reminds the user that the dashboard reflects WhatsApp data. They don't need to enter everything twice.

---

## 17. File Structure (Final)

```
packages/dashboard-ui/
├── public/
│   ├── _redirects              # SPA fallback for Cloudflare Pages
│   └── favicon.svg
├── src/
│   ├── main.tsx                # React root, QueryClient, BrowserRouter
│   ├── App.tsx                 # Route definitions, lazy loading
│   ├── index.css               # Tailwind v4 + shadcn/ui theme
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components (Button, Table, Sheet, etc.)
│   │   ├── app-shell.tsx       # Sidebar + main content layout
│   │   ├── sidebar.tsx         # Desktop sidebar navigation
│   │   ├── mobile-nav.tsx      # Mobile bottom tab bar
│   │   ├── auth-gate.tsx       # Auth check wrapper
│   │   ├── alert-banner.tsx    # Cross-page alert notifications
│   │   ├── page-skeleton.tsx   # Full-page loading skeleton
│   │   │
│   │   ├── booking-table.tsx        # Schedule table with status badges
│   │   ├── booking-detail-sheet.tsx # Slide-out booking detail + payments
│   │   ├── create-booking-dialog.tsx# Create booking form dialog
│   │   ├── conflict-alert.tsx       # Inline conflict + alternatives
│   │   ├── bus-card.tsx             # Fleet card component
│   │   └── bus-detail-sheet.tsx     # Slide-out bus detail + maintenance
│   │
│   ├── hooks/
│   │   ├── use-auth.tsx        # Auth state + login/logout mutations
│   │   ├── use-schedule.ts     # Schedule queries + booking CRUD
│   │   ├── use-fleet.ts        # Fleet queries
│   │   ├── use-financials.ts   # Financial queries + payment recording
│   │   ├── use-alerts.ts       # Alert polling + dismiss
│   │   └── use-team.ts         # Team management (owner only)
│   │
│   ├── pages/
│   │   ├── login.tsx           # Phone + OTP login
│   │   ├── schedule.tsx        # Jadwal page
│   │   ├── fleet.tsx           # Armada page
│   │   ├── financials.tsx      # Keuangan page
│   │   └── team.tsx            # Tim settings page
│   │
│   └── lib/
│       ├── api.ts              # Hono RPC client (type-safe)
│       └── format.ts           # formatDateID, formatRupiah
│
├── vite.config.ts
├── components.json             # shadcn/ui configuration
├── tsconfig.json
└── package.json
```

---

## 18. What This Doc Does NOT Cover (Next Deep Dives)

| Topic | What's Needed | Doc |
|---|---|---|
| **Onboarding Flow** | First-contact WA experience, invite code UX, tenant setup, first-login dashboard | `keloia-onboarding-deep-dive.md` |
| **Testing Strategy** | Component tests (Vitest + Testing Library), E2E (Playwright), mock API strategy | `keloia-testing-deep-dive.md` |
| **PDF Generation** | Trip confirmation layout, jsPDF implementation, R2 storage, download flow | Part of Dashboard BFF deep dive (section 8) |
