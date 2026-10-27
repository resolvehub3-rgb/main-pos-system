# SamTill Marketing Website

Public marketing/landing website for **SamTill by SamTeck Digital**, plus the
**prepared-but-disabled commerce system** (accounts, Paystack test-mode
checkout, subscription-gated installer downloads) that lives entirely inside
this folder as reviewable code.

This folder is a **standalone workspace**. It is completely separate from the
SamTill POS application in the repository root.

## Isolation guarantees

- Own `package.json`, own `node_modules`, own Vite config → no dependency
  sharing with the POS app.
- Build output goes to `landing/dist` and never touches the root `dist/`,
  `dist-electron/`, `release/` or the Electron packaging config.
- No Supabase client, no `.env` usage, no database, **no provisioned backend,
  no API keys** — the commerce API in `api/` is written against the browser
  WebCrypto/fetch APIs and fails closed (HTTP 503) until an owner-approved
  commerce project and its environment variables exist (nothing is set, and
  no secrets are stored in this repo, ever).
- The POS app, its Supabase project and its `.env` are never read, copied or
  modified from here; the commerce system is designed for its own future,
  separate Supabase project.
- Nothing in the POS source tree is imported or modified by this site.
- Runs on its own port (`pnpm dev` → 5174), clear of the POS dev server (3000).

## Commerce preparation (review only — nothing is live)

| Piece | Location | State |
| --- | --- | --- |
| Commercial decisions blocking launch | `docs/01-commercial-decisions.md` | **unresolved** — checkout cannot be enabled |
| Architecture & test report | `docs/02-commerce-architecture.md` | prepared |
| Environment variable names (no values) | `docs/03-environment-variables.md` | prepared; none set anywhere |
| Installer delivery & licensing | `docs/04-installer-delivery-and-licensing.md` | prepared; installer never uploaded |
| API handlers (status/plans/checkout/verify/subscription/download/webhook) | `api/` | implemented, fail-closed, unit-tested |
| Database schema + RLS | `db/migrations/0001_commerce_init.sql` | prepared, **never executed** |
| Unit tests | `tests/` | 68 tests, no network/database |
| Site preview section (inert) | `src/components/CommercePreview.tsx`, `src/config/commerce.ts` | all capability flags `false` |

There is no checkout button, no working download and no registration form on
the site: the preview section shows status rows only. Prices remain flagged
as drafts (`PRICING_APPROVED = false`), and the API independently refuses
checkout (`CHECKOUT_ENABLED` unset) — the site cannot enable payments on its
own.

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
| Hide/replace the draft notice | `src/config/pricing.ts` (`PRICING_APPROVED = true`) |
| Contact details               | `src/config/contact.ts` (`CONTACT`)    |
| Enable send buttons           | `src/config/contact.ts` (fill fields + `ownerConfirmed = true`) |
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

1. The owner has approved the prices in `src/config/pricing.ts`
   (`PRICING_APPROVED = true`).
2. Real contact details are filled into `src/config/contact.ts`
   (`ownerConfirmed = true`).
3. Privacy Policy and Terms of Service texts are approved.
4. `SITE.siteApprovedForLaunch` in `src/config/site.ts` is set to `true`
   (removes the preview banner).

No download link may be published until the owner approves a verified,
secure installer. No payment, registration or licensing claims may be added
without explicit approval.
