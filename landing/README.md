# SamTill Marketing Website

Public marketing/landing website for **SamTill by SamTeck Digital**, plus the
**prepared-but-disabled commerce system** (accounts, Paystack checkout,
entitlement-gated access) that lives entirely inside this folder
as reviewable code. The commercial model is a **one-time licence** per
computer with six months of maintenance and support.

## SamTill is a browser app (PWA)

SamTill runs in the browser and installs as an app — there is no Windows
installer to download. To get it on a device: open the SamTill web app, then
use the browser's **Install app** (Chrome/Edge) or **Add to Home Screen**
(Safari on iOS/Android) feature. The app then launches in its own window and
works like an installed application. The web-app address is configured in
`src/config/site.ts` (`SITE.webAppUrl`); while it is empty, the site never
links to a not-yet-published address.

This folder contains the marketing site source, which is now integrated into
the SamTill POS application in the repository root. The root app serves the
marketing homepage at `/` and the POS authentication screens at `/login`,
`/register`, and `/app`, all on one origin. The marketing **Register** button
opens the POS shop-owner registration tab at `/register`.

## Isolation guarantees

- The root Vite app builds and serves both the POS and marketing site.
- The optional commerce API has **no provisioned backend or API keys** and
  fails closed (HTTP 503) until an owner-approved commerce project and its
  environment variables exist. The marketing site's customer-account UI uses
  only that separate commerce project's publishable anon key via
  `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY`.
- The POS login and shop-owner registration use the POS app's existing auth
  configuration. They are separate from the optional commerce customer
  account flow.
- No secrets are stored in this repo.
- Start the integrated app from the repository root with `pnpm dev` on port
  3000; do not start a second landing-site server.

## Commerce preparation (code ready — backend not provisioned)

| Piece | Location | State |
| --- | --- | --- |
| Commercial decisions blocking launch | `docs/01-commercial-decisions.md` | **resolved** — one-time tiers approved (`PRICING_APPROVED = true`) |
| Architecture & test report | `docs/02-commerce-architecture.md` | prepared |
| Environment variable names (no values) | `docs/03-environment-variables.md`, `../docs/ENVIRONMENT.md` | prepared; none set anywhere |
| Customer journey (register → verify → login → buy → verify payment) | `docs/05-customer-journey.md` | implemented behind feature flags |
| API handlers (status/plans/checkout/verify/subscription/webhook) | `api/` | implemented, fail-closed, unit-tested |
| Database schema + RLS | `db/migrations/0001_commerce_init.sql` | prepared, **never executed** |
| Approved plan rows | `db/seeds/0001_approved_plans.sql` | prepared; run after the migration |
| Optional commerce customer-account UI (separate from POS shop-owner registration) | `src/pages/*Page.tsx`, `src/lib/authFlow.ts`, `src/lib/checkoutClient.ts` | implemented; requires commerce configuration |
| Unit tests | `tests/` | pure unit tests, no network/database |
| Site preview section (inert) | `src/components/CommercePreview.tsx`, `src/config/commerce.ts` | all capability flags `false` |

There is no working payment on the public site **yet**. The optional commerce
register / login / verify / account / checkout pages exist at hash
routes (`/#/register`, `/#/login`, `/#/verify`, `/#/forgot-password`,
`/#/reset-password`, `/#/account`, `/#/checkout`) but every
"buy" call to action is hidden while `COMMERCE.paymentsEnabled` is `false` in
`src/config/commerce.ts`; account screens also require the commerce service to
be configured. The API independently refuses to serve prices
(`PUBLISH_PRICES`) or start checkout (`CHECKOUT_ENABLED`). The main site's
Register button goes to the POS shop-owner registration at `/register`. The
price on the optional commerce checkout screen is whatever the server
publishes in the `plans` table; the browser never sends a price.

## Development

Run `pnpm dev` from the repository root; the integrated app is available at
`http://localhost:3000`.

## Checks

```bash
cd landing
pnpm lint        # TypeScript type check (src, api and tests)
pnpm test        # commerce unit tests — no network, no database
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
| Buy / Sign-in links | `src/config/commerce.ts` (capability flags) + `src/config/site.ts` (nav) |
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
5. For the whole customer journey (register → verify → pay):

   1. the `samtill-commerce` Supabase project exists, the migration **and**
      `db/seeds/0001_approved_plans.sql` have been run against it (never
      against the POS project);
   2. Auth email delivery is configured in that project;
   3. Vercel holds the server env vars plus the client
      `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY`
      (`../docs/ENVIRONMENT.md` is the full matrix);
   4. Paystack (test keys) is registered with the callback URL and webhook;
   5. `COMMERCE.accountEnabled` / `COMMERCE.paymentsEnabled` are flipped in
      `src/config/commerce.ts`, and
      the server-side `PUBLISH_PRICES=true` / `CHECKOUT_ENABLED=true` are set
      (`ALLOW_LIVE_PAYMENTS=true` only when the live key goes in).

No payment, registration or licensing claims may be added
without explicit approval.
