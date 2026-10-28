# SamTill Marketing Website

Public marketing/landing website for **SamTill by SamTeck Digital**, plus the
**prepared-but-disabled commerce system** (accounts, Paystack checkout,
entitlement-gated installer downloads) that lives entirely inside this folder
as reviewable code. The commercial model is a **one-time licence** per
computer with six months of maintenance and support.

This folder is a **standalone workspace**. It is completely separate from the
SamTill POS application in the repository root.

## Isolation guarantees

- Own `package.json`, own `node_modules`, own Vite config → no dependency
  sharing with the POS app.
- Build output goes to `landing/dist` and never touches the root `dist/`,
  `dist-electron/`, `release/` or the Electron packaging config.
- No database, **no provisioned backend, no API keys** — the commerce API in
  `api/` fails closed (HTTP 503) until an owner-approved commerce project and
  its environment variables exist (nothing is set, and no secrets are stored in
  this repo, ever). The account UI ships a Supabase **auth client**
  (`@supabase/supabase-js`) that is only ever configured with the commerce
  project's publishable anon key via `VITE_COMMERCE_SUPABASE_URL` /
  `VITE_COMMERCE_SUPABASE_ANON_KEY`, and only becomes reachable when the
  account feature flags are switched on.
- The POS app, its Supabase project and its `.env` are never read, copied or
  modified from here; the commerce system is designed for its own future,
  separate Supabase project.
- Nothing in the POS source tree is imported or modified by this site.
- Runs on its own port (`pnpm dev` → 5174), clear of the POS dev server (3000).

## Commerce preparation (code ready — backend not provisioned)

| Piece | Location | State |
| --- | --- | --- |
| Commercial decisions blocking launch | `docs/01-commercial-decisions.md` | **resolved** — one-time tiers approved (`PRICING_APPROVED = true`) |
| Architecture & test report | `docs/02-commerce-architecture.md` | prepared |
| Environment variable names (no values) | `docs/03-environment-variables.md`, `../docs/ENVIRONMENT.md` | prepared; none set anywhere |
| Installer delivery & licensing | `docs/04-installer-delivery-and-licensing.md` | prepared; installer never uploaded |
| Customer journey (register → verify → login → buy → verify payment → download) | `docs/05-customer-journey.md` | implemented behind feature flags |
| API handlers (status/plans/checkout/verify/subscription/download/webhook) | `api/` | implemented, fail-closed, unit-tested |
| Database schema + RLS | `db/migrations/0001_commerce_init.sql` | prepared, **never executed** |
| Approved plan rows | `db/seeds/0001_approved_plans.sql` | prepared; run after the migration |
| Account UI (register / verify / login / reset / account / checkout / download) | `src/pages/*Page.tsx`, `src/lib/authFlow.ts`, `src/lib/checkoutClient.ts` | implemented, flags `false` |
| Unit tests | `tests/` | 163 tests, no network/database |
| Site preview section (inert) | `src/components/CommercePreview.tsx`, `src/config/commerce.ts` | all capability flags `false` |

There is no working payment or download on the public site **yet**. The
register / login / verify / account / checkout / download pages exist at hash
routes (`/#/register`, `/#/login`, `/#/verify`, `/#/forgot-password`,
`/#/reset-password`, `/#/account`, `/#/checkout`, `/#/download`) but every
"buy" and "download" call to action is hidden while `COMMERCE.accountEnabled`
/ `COMMERCE.paymentsEnabled` / `COMMERCE.downloadEnabled` are `false` in
`src/config/commerce.ts` — and even then the API independently refuses to
serve prices (`PUBLISH_PRICES`) or start checkout (`CHECKOUT_ENABLED`). The
price on the checkout screen is whatever the server publishes in the `plans`
table; the browser never sends a price.

## Development

```bash
cd landing
pnpm install     # first time only — installs into landing/node_modules
pnpm dev         # http://localhost:5174
```

## Checks

```bash
cd landing
pnpm lint        # TypeScript type check (src, api and tests)
pnpm test        # commerce unit tests — no network, no database
pnpm build       # production build → landing/dist (api/ is never bundled)
pnpm preview     # serve the production build locally (http://localhost:4173)
```

## Editing content — where changes go

| What                          | File                                   |
| ----------------------------- | -------------------------------------- |
| Prices, package names, descriptions | `src/config/pricing.ts`          |
| Comparison table rows         | `src/config/pricing.ts` (`COMPARISON_ROWS`) |
| Licence & support terms       | `src/config/pricing.ts` (`LICENCE_TERMS`) |
| Show the draft-pricing notice again | `src/config/pricing.ts` (`PRICING_APPROVED = false`) |
| Contact details               | `src/config/contact.ts` (`CONTACT`)    |
| Disable the enquiry buttons   | `src/config/contact.ts` (`ownerConfirmed = false`) |
| Buy / Sign-in / Download links | `src/config/commerce.ts` (capability flags) + `src/config/site.ts` (nav) |
| Nav, footer, preview banner   | `src/config/site.ts`                   |
| Privacy / Terms text          | `public/privacy.html`, `public/terms.html` |

Nothing is hard-coded across components — every price, contact detail and
policy string exists only in the config files above.

## Screenshots

`public/assets/screenshot-*.png` are copies of genuine SamTill screenshots
taken from the existing `public/` folder in the repository. Never substitute a
mock-up for a real screenshot; if fresh screenshots are needed, capture them
from the application normally.

## Deployment (requires owner approval — do not deploy unattended)

This is a static site. Any static host works (Netlify, Vercel, Cloudflare
Pages, or a plain web server). One-time setup:

```bash
cd landing
pnpm build
# publish landing/dist
```

- Build command: `pnpm build`
- Output directory: `dist`
- Root directory: `landing`

**Do not publish until:**

1. ~~The owner has approved the prices in `src/config/pricing.ts`~~ — done
   (`PRICING_APPROVED = true`; one-time tiers GHS 499 / 899 / 1,499).
2. ~~Real contact details are filled into `src/config/contact.ts`~~ — done
   (`ownerConfirmed = true`).
3. ~~Privacy Policy and Terms of Service texts are approved~~ — done; both
   pages now cover the selling journey, refunds and Paystack payments.
4. `SITE.siteApprovedForLaunch` in `src/config/site.ts` is set to `true`
   (removes the preview banner) — **leave false until the commerce backend
   below exists and a test-mode purchase has succeeded end to end.**
5. For the whole customer journey (register → verify → pay → download):

   1. the `samtill-commerce` Supabase project exists, the migration **and**
      `db/seeds/0001_approved_plans.sql` have been run against it (never
      against the POS project);
   2. Auth email delivery is configured in that project;
   3. Vercel holds the server env vars plus the client
      `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY`
      (`../docs/ENVIRONMENT.md` is the full matrix);
   4. Paystack (test keys) is registered with the callback URL and webhook;
   5. the installer release row is `is_active = true` in the `installers`
      bucket;
   6. `COMMERCE.accountEnabled` / `COMMERCE.paymentsEnabled` /
      `COMMERCE.downloadEnabled` are flipped in `src/config/commerce.ts`, and
      the server-side `PUBLISH_PRICES=true` / `CHECKOUT_ENABLED=true` are set
      (`ALLOW_LIVE_PAYMENTS=true` only when the live key goes in).

No download link may be published until the owner approves a verified,
secure installer. No payment, registration or licensing claims may be added
without explicit approval.
