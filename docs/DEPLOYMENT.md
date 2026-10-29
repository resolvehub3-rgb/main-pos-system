# SamTill POS - Deployment & Operations Guide

## 1. Supabase Project Setup
1. Create a project at [supabase.com](https://supabase.com).
2. Go to SQL Editor and run `supabase/migrations/20261020000001_initial_schema.sql`
   (then the later migrations in order, including the Stage B RLS/provisioning
   migrations once approved — see `docs/SECURITY.md`).
3. Optionally run `supabase/seed.sql` for initial subscription tiers.
4. Go to Project Settings -> API to copy `Project URL` and `anon public key`.
5. Enable **Email** auth and turn on email verification; the registration →
   verify → sign-in journey depends on it (see `docs/SECURITY.md` §3b).
6. The first super admin is provisioned server-side via the Supabase Admin API
   with the service-role key. **No super-admin credential is ever placed in a
   `VITE_` variable or in this repository.**

## 2. Vercel Deployment (web app + PWA)

SamTill is a **Progressive Web App** — there is no desktop installer; customers
install it from the browser (Install app / Add to Home Screen).

1. Import the repository into [vercel.com](https://vercel.com) (the existing
   `samtillpos` project).
2. Framework preset: **Vite**. Build command: `pnpm build`. Output directory:
   `dist`. Install command: `pnpm install`.
3. Environment variables (Project → Settings → Environment Variables):
   - `VITE_SUPABASE_URL` — e.g. `https://xyzcompany.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — public anon token (safe by design, guarded by RLS)
   - `VITE_PRINT_BRIDGE_URL` — optional, usually unset (default `http://127.0.0.1:9210`)
4. Deploy. The app must be served over **HTTPS** (Vercel does this by default) —
   service workers and the install prompt require a secure context.
5. The PWA service worker (`public/sw.js`) is served from the site root with
   scope `/`; keep it deployable at `/sw.js` (no header rules may block it).

The marketing site (`landing/`) is a separate Vercel project with its own
`/api/*` serverless functions — see `landing/README.md`.

## 3. Environment Variables
- `VITE_SUPABASE_URL`: e.g. `https://xyzcompany.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: public anon token
- `PORT`: `3000`

> `VITE_` variables are compiled into the public client bundle and are visible
> to anyone who can download the JS. Never put a password, service-role key or
> other secret in one (see `docs/SECURITY.md` §2).

## 4. Thermal Receipt Printing

Receipts print through the browser's print dialog by default. To print silently
to a USB/thermal till printer, each till machine also runs the bundled **local
print bridge**:

```bash
pnpm print-bridge
```

It is optional — without it the app falls back to the browser dialog — and it
binds to `127.0.0.1` only, so it is never reachable from another machine.

- Optional app variable: `VITE_PRINT_BRIDGE_URL` (default
  `http://127.0.0.1:9210`)
- Bridge variables (`PRINT_BRIDGE_*`, `PRINT_TRANSPORT`, `PRINT_PRINTER`,
  `PRINT_NETWORK_*`, `PRINT_SPOOL_DIR`) are read by the bridge process, not the
  browser — see `.env.example`.

**Important:** the app and the bridge must run on the same machine as the
printer. A normal web deployment (e.g. Vercel) hosts only the app; the bridge
belongs on the shop's till PC, started at Windows log-on. The shop owner picks
the output path in **Settings → Terminal Settings → Receipt Output** (applies
to every open till; cashiers cannot change it) and confirms the connection with
**Test Print**.

Full setup, transports, security model and troubleshooting:
**[docs/PRINTING.md](./PRINTING.md)**.

## 5. PWA — install, update and offline behaviour

SamTill is delivered as a Progressive Web App. Customers visit the site, sign
in, and install it with the browser's **Install app** / **Add to Home Screen**
feature (a real browser prompt on Chromium; guided manual steps elsewhere — the
in-app "Install app" button shows the right instructions per platform).

- **Updates:** the service worker caches only the app shell and static assets.
  A new version never applies itself — the till shows an "Update now" banner
  and reloads only when the operator taps it, so an active checkout is never
  interrupted.
- **Offline:** the app is local-first. All POS data lives in the browser's
  localStorage; sales recorded offline sync to Supabase later via idempotent
  upserts (deterministic UUIDs, no duplicates). A new sign-in, email
  verification and mobile-money payments require a connection. An offline
  banner tells the operator exactly this.
- **Customer display:** the "Customer Display" button opens a popup window the
  operator drags to the second monitor; the cart syncs live over
  `BroadcastChannel`. Browsers cannot auto-open windows at startup (no user
  gesture ⇒ popup blocked), and if popups are disabled the in-page modal is
  used instead.
- **Second monitor / taskbar:** the installed PWA opens in its own window and
  can be placed on the customer monitor manually; browsers do not offer
  Electron-style multi-window startup positioning, background services or
  automatic kiosk locking.
