# SamTill POS

Multi-tenant supermarket and retail point-of-sale for Ghanaian businesses —
barcode checkout, inventory ledger, live sales analytics and role-based
access, backed by Supabase.

**SamTill is a Progressive Web App (PWA).** Customers visit
[https://samtillpos.vercel.app](https://samtillpos.vercel.app), register and
verify their email, sign in, and install the app from the browser's
**Install app** / **Add to Home Screen** menu. There is no Windows `.exe`
installer — the Electron desktop app was removed in favour of the PWA.

## Customer journey

1. Visit `https://samtillpos.vercel.app`.
2. Register with email + password (a shop owner registration provisions the
   shop server-side via a SECURITY DEFINER RPC).
3. Verify the email via the confirmation link.
4. Sign in — the server-side `profiles.role` row is the authoritative role.
5. Use the authorized app in the browser.
6. Install it: Chromium browsers show a real install prompt (also reachable
   via the in-app **Install app** button); iOS Safari and others get accurate
   manual Add-to-Home-Screen instructions.

## Development

Requires [pnpm](https://pnpm.io) (this repo's package manager — `pnpm-lock.yaml`
is committed).

```bash
pnpm install        # install dependencies
pnpm dev            # unified marketing site + POS on http://localhost:3000
pnpm lint           # tsc --noEmit (type check)
pnpm test           # unit tests (node:test via tsx)
pnpm build          # production build → dist/ (marketing site at /, POS at /app)
pnpm preview        # serve the production build locally
pnpm print-bridge   # optional local receipt-print bridge (see docs/PRINTING.md)
```

The marketing site is served at `/`; its **Register** button opens the POS
shop-owner registration tab at `/register` on the same origin. `/login` opens
the POS sign-in tab. The former standalone landing workspace is now part of
this app; run the root `pnpm dev` command rather than starting a second Vite
server from `landing/`.

Copy `.env.example` to `.env` and fill in the Supabase project URL and anon
key. **Never put a secret in a `VITE_` variable** — Vite compiles those into
the public bundle (`docs/SECURITY.md`).

## Deployment

The web app deploys to **Vercel** as a static Vite site (build `pnpm build`,
output `dist/`, HTTPS required for the service worker and install prompt).
Full instructions: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Environment
matrix: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

The marketing site in [`landing/`](landing/README.md) is a separate Vercel
project with its own serverless `/api/*`.

## PWA notes

- `public/manifest.json` + `public/sw.js` provide installability and
  safe static-asset caching (the service worker never caches Supabase
  responses, auth, or private data).
- Updates are operator-controlled: a new version waits until **Update now**
  is pressed, so an active checkout is never interrupted.
- The app is local-first: sales keep working offline and sync later via
  idempotent upserts. A new sign-in and mobile-money payments need a
  connection.
- Customer display: the **Customer Display** button opens a popup window for
  the second monitor (cart state syncs via `BroadcastChannel`); the in-page
  modal is the fallback when popups are blocked.

## Receipt printing

Receipts print through the browser's print dialog by default. For silent
USB/thermal printing, run the bundled local print bridge on the till machine
(`pnpm print-bridge`). See [`docs/PRINTING.md`](docs/PRINTING.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | The SamTill POS PWA (React + Vite + Tailwind) |
| `public/` | Static assets: manifest, service worker, icons |
| `supabase/` | SQL migrations and seed data |
| `print-bridge/` | Optional localhost receipt-print helper |
| `scripts/` | DB verification utilities (`pnpm exec tsx scripts/db-*.ts`) |
| `docs/` | Architecture, deployment, security, printing, database docs |
| `landing/` | Separate marketing-site project (own package.json) |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploying to Vercel, PWA behaviour
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, auth design, migration runbook
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema and sync layer
- [`docs/PRINTING.md`](docs/PRINTING.md) — receipt printing
- [`docs/API.md`](docs/API.md) — data-access API notes
