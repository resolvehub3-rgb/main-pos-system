# SamTill Marketing Website

Public marketing/landing website for **SamTill by SamTeck Digital**.

This folder is a **standalone static site**. It is completely separate from the
SamTill POS application in the repository root.

## Isolation guarantees

- Own `package.json`, own `node_modules`, own Vite config → no dependency
  sharing with the POS app.
- Build output goes to `landing/dist` and never touches the root `dist/`,
  `dist-electron/`, `release/` or the Electron packaging config.
- No Supabase client, no `.env` usage, no database, no backend, no API keys.
- Nothing in the POS source tree is imported or modified by this site.
- Runs on its own port (`pnpm dev` → 5174), clear of the POS dev server (3000).

## Development

```bash
cd landing
pnpm install     # first time only — installs into landing/node_modules
pnpm dev         # http://localhost:5174
```

## Checks

```bash
cd landing
pnpm lint        # TypeScript type check
pnpm build       # production build → landing/dist
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
