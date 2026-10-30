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
7. Deploy the staff-provisioning Edge Function from the repository root:
   `supabase functions deploy provision-staff --project-ref <project-ref>`.
   It uses Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY` to create cashier
   Auth accounts; never add that key to the POS app or a `VITE_` variable.
   Apply `20261030000001_provisioning_rpc.sql` first, since the function calls
   the owner-checked `invite_staff` RPC.
   - **Symptom when this step was skipped:** adding a cashier fails with
     *"Could not create the staff login: Failed to send a request to the Edge
     Function"*. The browser's preflight gets the gateway's fallback 404, which
     omits `content-type` from `Access-Control-Allow-Headers`, so the request
     never returns a response to the app. Check with
     `curl -X OPTIONS https://<project-ref>.supabase.co/functions/v1/provision-staff`
     — `{"code":"NOT_FOUND","message":"Requested function was not found"}`
     means the deploy command above still has to be run.

## 2. Vercel Deployment (web app + PWA)

SamTill is a **Progressive Web App** — there is no desktop installer; customers
install it from the browser (Install app / Add to Home Screen).

1. Import the repository into [vercel.com](https://vercel.com) (the existing
   `samtillpos` project). The root [`vercel.json`](../vercel.json) configures
   the pnpm build, `dist` output, and SPA route fallback.
2. Framework preset: **Vite** (or **Other** when using the checked-in
   `vercel.json` settings).
3. Environment variables (Project → Settings → Environment Variables):
   - `VITE_SUPABASE_URL` — e.g. `https://xyzcompany.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — public anon token (safe by design, guarded by RLS)
   - `VITE_PRINT_BRIDGE_URL` — optional, usually unset (default `http://127.0.0.1:9210`)
4. Deploy. The app must be served over **HTTPS** (Vercel does this by default) —
   service workers and the install prompt require a secure context.
5. The PWA service worker (`public/sw.js`) is served from the site root with
   scope `/`; keep it deployable at `/sw.js` (no header rules may block it).

Shop owners add a staff member's login from **Staff → Add Cashier**. The
provisioning function creates the Supabase Auth account and shop membership
before the dashboard confirms success, so the cashier can sign in on another
till with the email and password supplied by the owner. This function must be
deployed to the same Supabase project as the POS app.

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

### Windows 10/11 — installed PWA chrome and limitations

SamTill has no desktop wrapper or installer. Its manifest requests
`display: "standalone"` and the app is served at `/`; the `/login`,
`/register`, `/admin`, `/shop-owner`, and `/cashier` routes are all inside that
same app scope. The installed app therefore uses the same standalone display
mode for each of those routes. The manifest does **not** request Window
Controls Overlay (WCO).

**Windows 11 / Edge verification:** the running installed SamTill window
showed the Shop Owner dashboard and the title `SamTill POS`. Its accessible
native controls were **Minimize**, **Restore**, **Close**, **Zoom: 80%**, and
**Settings and more (Alt+F)**. The password-manager key icon was not present
in the inspected app window. The zoom control reflects this Edge profile's
80% page zoom; it is browser UI, not an app element or manifest option. To
reset the page zoom on a till PC, focus the app and press **Ctrl+0**. This
profile was not changed during verification.

The Edge **Settings and more** app-menu control remains in the installed
window. It is browser-owned and cannot be removed by SamTill CSS, JavaScript,
or a manifest option. Microsoft's
[Window Controls Overlay documentation](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/window-controls-overlay)
also identifies **App Info** alongside the system window controls when WCO
hides the title bar. WCO is not enabled here and would not remove that
browser control. The Windows minimize, maximize/restore, and close controls
remain available and are not covered or replaced.

The Shop Owner route was visually inspected in the installed window. The
other role routes share the same origin and manifest scope, but were not
separately opened because no safe test accounts for those roles were
available. The customer display is opened with `window.open(..., "popup=yes")`
as a separate browser-managed window; its chrome is not guaranteed to match
the installed app window and was not separately verified.

Install SamTill from Edge's **App available** / **Install this site as an
app** action (or the app's real **Install app** prompt). This removes the
normal browser tab strip and address bar, but does not remove every
browser-owned app-window control. If all browser controls must be absent, a
native desktop application is the supported alternative; adding a wrapper
requires separate approval. Kiosk mode and CSS overlays that hide or imitate
window controls are not used.

Keep the manifest's `start_url`, `scope`, `id`, name, and icons root-relative:
the app is served from the site root and the service worker scope is `/`.
