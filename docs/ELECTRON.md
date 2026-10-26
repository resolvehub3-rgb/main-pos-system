# SamTill POS — Windows Desktop (Electron)

The desktop application is an **additional distribution target**: a Windows
installer that wraps the existing web/PWA build in a native window with a
second, customer-facing window for a second monitor. The web app, PWA,
backend, database, authentication and every POS feature are unchanged.

- Package manager: **pnpm** (never npm/yarn for this repo)
- Installer: **NSIS** via electron-builder → `release/SamTill-POS-Setup.exe`
- Electron: 45.x (devDependency), renderer: the existing Vite + React build

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Electron main process (dist-electron/main.cjs)                     │
│  • loopback server on 127.0.0.1 serves the production dist/ (CSP   │
│    header injected here — desktop only)                            │
│  • cashier BrowserWindow  +  customer BrowserWindow (2nd monitor)  │
│  • display detection / hot-plug handling                           │
│  • narrow validated IPC (electron/ipc.ts)                          │
│  • navigation/popup/permission security policy                     │
│  • update *notification* check (never installs)                    │
├────────────────────────────────────────────────────────────────────┤
│ Preload (dist-electron/preload.cjs, sandboxed)                     │
│  • exposes only window.samtillDesktop (src/types/desktop.ts)       │
├────────────────────────────────────────────────────────────────────┤
│ Renderer — the EXISTING app, unchanged business logic              │
│  • cashier window:  /            → src/App.tsx (as in the browser) │
│  • customer window: /?view=customer-display →                     │
│                     src/components/CustomerDisplayWindow.tsx       │
│  • src/lib/desktopBridge.ts: no-op on the web (PWA untouched)      │
└────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Why a loopback HTTP server, not `file://`:** the Vite build emits
  absolute `/assets/...` URLs; the local print bridge only accepts loopback
  origins; both windows must share one origin (shared localStorage/session);
  and the CSP is delivered as an HTTP header so it applies to the desktop
  build only. The server serves the built `dist/` — it is *not* a dev server.
- **Stable origin:** preferred port `9273` (remembered per install in
  `userData/renderer-port`; falls back through 9274–9289, then ephemeral).
  Keeping the port stable keeps the login session across restarts.
- **Customer display truth:** the cashier window pushes a narrow,
  field-validated `CustomerDisplayState` (shop name, projected cart lines,
  amount due — never cost/stock/tenant ids) over IPC; main caches it for
  late-open/reload; the customer window renders it. One source of truth.
- **Single instance:** `app.requestSingleInstanceLock()`; a second launch
  focuses the running till.

## 2. Scripts

| Script | What it does |
| --- | --- |
| `pnpm desktop:assets` | Generates `build-resources/app.ico` from `public/app-logo.png` |
| `pnpm desktop:build` | Bundles `electron/*.ts` → `dist-electron/main.cjs` + `preload.cjs` (esbuild) |
| `pnpm desktop:dist` | **Production installer**: `pnpm build` → assets → electron bundle → electron-builder NSIS |
| `pnpm desktop:smoke` | Launches the app with `SAMTILL_SMOKE=1` and runs the automated end-to-end checks (needs a Windows desktop session) |
| `pnpm desktop:dev` | Dev convenience: runs Vite + Electron against the dev server (packaged builds never do this) |

Web-only scripts (`dev`, `build`, `preview`, `lint`, `test`, `print-bridge`)
are exactly as before — Electron is never a prerequisite for web deployment.

## 3. Building the Windows installer

```bash
pnpm install                       # lockfile-consistent
pnpm lint                          # tsc --noEmit (whole repo, incl. electron/)
pnpm test                          # node test suite
pnpm desktop:dist                  # web build + electron bundle + NSIS installer
```

Output: **`release/SamTill-POS-Setup.exe`** (`release/` and `dist-electron/`
are git-ignored; installer binaries are never committed).

Notes:

- If Electron's binary download is blocked, point it at a reachable mirror,
  e.g. `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm desktop:dist`.
- `pnpm-workspace.yaml` pins `@electron/get@3.1.0` via `overrides`: 3.0.0
  lacks the `ElectronDownloadCacheMode` export electron-builder needs and
  fails at the packaging step with that name undefined. `pnpm install`
  applies it.

Optional update feed (see §7):

```bash
$env:SAMTILL_UPDATE_MANIFEST_URL='https://your-release-host/desktop/latest.json'
pnpm desktop:dist
```

### Installer properties

- Per-user install (no admin): `%LOCALAPPDATA%\Programs\SamTill POS`
- Wizard lets the operator change the folder; Desktop **and** Start menu
  shortcuts ("SamTill POS"); app name/version/icon from
  `productName`/`version`/`build-resources/app.ico`
- Upgrades keep `%APPDATA%\SamTill POS` (login session, shop settings);
  uninstall does not delete app data (`deleteAppDataOnUninstall: false`)
- x64 → Windows 10 and Windows 11 (Intel/AMD). arm64 is not built yet (see §8)
- Only `dist/`, `dist-electron/` and `package.json` are packed: no
  node_modules, no backend code, no `.env`, no service-role keys in the
  installer or renderer

## 4. Testing on Windows 10/11

1. Copy `release/SamTill-POS-Setup.exe` to a clean Windows 10 and a Windows 11
   machine (or VM) that has **not** run the app before.
2. Run the installer → accept the default folder → confirm **Desktop** and
   **Start menu** entries appear named *SamTill POS*.
3. Launch from the shortcut. First run starts logged out (the desktop app has
   its own empty session store — sign in once; the session persists across
   restarts).
4. Verify: sign-in against the real Supabase backend, shop loads, products
   render, barcode field accepts keyboard-wedge scanning (USB scanner types
   digits + Enter), cart maths, payment flow.
5. Receipts: with `pnpm print-bridge` running on the till machine, "Confirm &
   Print" must reach the thermal printer (the desktop app is served from a
   loopback origin, which the bridge's origin gate accepts); with no bridge,
   the OS print dialog must appear (browser-method fallback).
6. Reports (Stock Book → print) open the report window and then the system
   print dialog.
7. Upgrade: install `v(N)` with a signed-in session, install `v(N+1)` over it
   → app data/session still present. Uninstall → shortcuts removed; reinstall
   still keeps app data.
8. Failure cases: rename `dist/` out of a dev checkout before
   `desktop:dev`/smoke → clear startup error dialog (not a blank window);
   kill the renderer → it reloads itself (max 2 attempts) with a logged error.

Automated equivalent: `pnpm lint && pnpm test && pnpm build &&
pnpm desktop:build && pnpm desktop:smoke` → `SMOKE RESULT: PASS`.

## 5. Two-monitor verification (cashier + customer display)

Prerequisites: dual monitors extended (not mirrored) in Windows display
settings.

1. Start the app. Expected: cashier window on the primary monitor; **one**
   full-screen customer window on the secondary monitor (auto-opens when it
   was enabled before — persisted in `userData/desktop-state.json`).
2. Sign in at the till, start a sale, scan/add items → the second screen
   updates per scan (name, image, qty, line amount, total due).
3. Change quantity, remove a line, clear the cart, park/unpark a cart →
   display follows; "Amount Due" always matches the till exactly.
4. Complete a payment → the customer screen returns to the
   "Next Customer, Please" welcome screen (existing business logic clears
   the cart; nothing else changes).
5. Click "Dual Customer Screen"/"Customer View" again → the native window is
   focused (never duplicated).
6. **Unplug the second monitor mid-sale** → the customer window closes; the
   till keeps the transaction; no crash. Replug → the window reopens
   full-screen on it (only if the operator hadn't closed it manually).
7. **Single monitor only:** the same control opens the in-page preview modal
   instead (cashier always usable). Plugging in a monitor later opens the
   native window and closes the preview automatically.
8. Close the customer window with its own ✕ → it stays closed on restart
   until requested again (or auto-restored when it had been enabled).
9. Reload the customer window (View → Reload) → the current cart state is
   restored from the main process. Reload the cashier → same as web (the
   in-memory cart resets — pre-existing browser behaviour).
10. Odd/virtual displays smaller than 800×600 are never chosen as the
    customer display.

## 6. Security posture (desktop)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webviewTag: false`; no insecure Electron flags anywhere.
- IPC is a fixed channel list; every call checks main-frame + own-origin
  sender, cart state may only be *written* by the cashier window, and all
  payloads are field-validated (`electron/ipc.ts`).
- Preload exposes only the typed `DesktopApi` — no raw ipcRenderer, fs, shell
  or Node APIs in the renderer.
- CSP served with every desktop page (§ electron/staticServer.ts):
  `default-src/script-src 'self'` … `connect-src` limited to https/wss (the
  Supabase URL is runtime-configurable) and loopback (print bridge);
  `object-src 'none'`, `frame-ancestors 'none'`. Injected as a header for the
  desktop only — the web deployment's headers are whatever hosting provides.
- Navigation off-origin is blocked (external http(s) opens in the OS browser);
  popups are denied except the blank report-print window; all
  `windowOpenHandler` http(s) targets go to the OS browser.
- Permission requests/checks (camera, mic, geo, notifications, clipboard
  read, HID…) are denied wholesale — the app needs none.
- Single-instance lock prevents duplicate tills.
- No secrets in the build: `VITE_*` values are baked in exactly as for the
  web deployment (see docs/DEPLOYMENT.md for their exposure), and none of the
  server-side keys (`SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`,
  `PRINT_BRIDGE_TOKEN`) are read by Electron at all.

## 7. Updates (current state — read before promising auto-update)

Implemented: a **safe notification architecture**.

- At startup the main process fetches a JSON release manifest (URL baked in
  at build time via `SAMTILL_UPDATE_MANIFEST_URL`), validates it (https,
  dotted version, download URL must share the manifest's origin) and pushes
  the result to the cashier window.
- If a newer version exists, a dismissible strip appears under the header:
  `v(current) → v(new)`, **Download update** (opens the publisher-hosted page
  in the OS browser — the app never downloads or executes anything) and
  **Later**. Nothing installs, restarts or interrupts a sale; the check never
  blocks the UI.
- Without `SAMTILL_UPDATE_MANIFEST_URL`, checks report `not-configured` and
  nothing is shown — there is no fake update feed.

Manifest format (`https://…/desktop/latest.json`):

```json
{
  "version": "1.1.0",
  "notes": "Short release note shown in the strip.",
  "url": "https://same-host.example/desktop/SamTill-POS-Setup.exe",
  "sha256": "…"
}
```

To enable production update *notifications*, the release process must:

1. Bump `version` in `package.json`, run `pnpm desktop:dist`.
2. Publish `release/SamTill-POS-Setup.exe` + `latest.json` over **HTTPS on the
   same origin** (keep `sha256` current for out-of-band verification).
3. Build with `SAMTILL_UPDATE_MANIFEST_URL` set.

Still required for full in-app auto-update (not implemented on purpose — it
needs a real release provider and a tested publishing pipeline): add
electron-updater (or similar) with a signed feed, code-sign the installers,
and add a download/verify/quit flow with user confirmation. Code signing is
also needed to keep Windows SmartScreen quiet on downloaded installers.

## 8. Known limitations / not verifiable here

- **Code signing:** installers are unsigned (no certificate in this repo) —
  SmartScreen warnings on first download are expected until signing is
  configured in electron-builder (`win.certificateFile`/`certificatePassword`
  or a CI signing service).
- **arm64 Windows:** only x64 is built/tested; add
  `arch: ['x64','arm64']` when an arm64 target is required.
- Receipt printing to physical hardware and the print bridge were verified
  only up to the origin-gate/flow level here (no printer attached in this
  environment); run §4.5 on a real till.
- Two-monitor placement was verified programmatically for a single-display
  machine (customer window opens via the test fallback, state relay checked);
  run §5 on actual dual-monitor hardware.
- `render.yaml` references `build:backend`/`start:backend` scripts that do not
  exist in `package.json` (pre-existing web-deployment quirk, untouched by
  this integration).
