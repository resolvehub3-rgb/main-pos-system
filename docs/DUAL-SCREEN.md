# Dual-Screen (Customer Display) Setup

SamTill POS runs the cashier interface on monitor 1 and a read-only customer
display on monitor 2. It stays a PWA: no Electron, no rebuild, no backend or
database replacement. The browser's standard APIs (popup windows,
BroadcastChannel, Window Management API) do the work.

## Required window behaviour (Windows desktop)

SamTill opens as an **installed PWA in a standalone application window**:

- Automatically opened **maximized** to the available desktop work area (best
  effort — see "Maximization" below).
- The **Windows taskbar stays visible**.
- The **native Windows title bar is retained** (minimize / maximize-restore /
  close buttons are the OS ones — never a custom HTML title bar).
- No browser address bar, tabs, navigation controls, zoom UI, settings menu or
  full-screen control is shown (these are removed by `display: standalone` in
  the manifest, not by React/CSS).

SamTill deliberately does **not** use the browser Fullscreen API or kiosk mode.

## How it works (short version)

1. The cashier signs in and opens the till as usual.
2. In **Settings → Dual-Screen Setup — Customer Display** the owner enables
   **dual-screen mode** (off by default; opt-in per device).
3. SamTill opens a second browser window at `/?view=customer-display` and
   attempts to place it on a second monitor when the browser allows it.
4. Both windows talk over a scoped `BroadcastChannel`
   (`samtill-customer-display:<tenantId>:<userId>`). The cashier window is the
   single source of truth for the cart; the customer window is read-only and
   shows branding, items, quantities, unit prices, line totals, subtotal,
   discounts, tax, the amount due and the payment confirmation — nothing else.
5. The cashier window polls the popup handle every 2 s and the display
   heartbeats every 3 s, so a closed/reconnected display is reported honestly
   as **not open / connecting / connected / blocked**, never as a hard error.

## Windows 10 / 11 — configure the second display

1. Connect monitor 2 and turn it on.
2. Press `Win + P` → choose **Extend** (not Duplicate/Mirror).
3. Open **Settings → System → Display**: drag the second monitor to the right
   of monitor 1 and click **Identify** to confirm which is which.
4. Install SamTill from Edge/Chrome's **Install app** prompt (or **App
   available**). This removes the browser tab strip and address bar.
5. Open SamTill. It opens in its own window; maximize it once (the OS
   remembers this for future launches).
6. In SamTill: **Settings → Dual-Screen Setup → Enable dual-screen mode**,
   then click **Detect monitors**. The status should read **2 monitors**.
7. Click **Open / Reopen display**. SamTill opens the customer window and
   attempts to place it on monitor 2. Drag it there if the browser ignores
   placement; maximize it on that monitor.

## Maximization (honest limits)

- Web code cannot force a top-level window to maximize: `resizeTo`/`moveTo` are
  blocked for windows the page did not open, and there is no manifest field for
  window state. SamTill calls `tryMaximizeWindow()` once on load as a best-effort
  nudge and otherwise relies on the browser/OS restoring the last window state.
- For guaranteed maximization on first launch, an administrator can add
  `--start-maximized` to the installed-app shortcut target (Edge/Chrome create
  that shortcut on install) or apply the Edge enterprise policy for maximized
  startup. SamTill never claims to force it from the page.
- The Windows taskbar and native window controls are always retained.

## Browser-managed settings (outside the application)

These cannot be changed by React/CSS and require browser/OS configuration:

- **Address bar / tabs / navigation / zoom / settings menu / full-screen
  control**: removed automatically by `display: standalone` (manifest). No
  frontend code is involved.
- **Password-manager prompts**: control via the browser's own settings or the
  enterprise policies `PasswordManagerEnabled` (Edge) / Chrome's
  `PasswordManagerEnabled`. SamTill never disables browser security globally.
- **Zoom**: the installed app inherits the browser's default zoom; set it in
  the browser before installing, or via enterprise policy
  `DefaultZoomLevel`/`ZoomLevel`.
- **Popup blocking for the customer display**: handled by the one-click
  **Open customer display** notice and the in-page **Customer View** fallback.

## Activation workflow (dual screen)

- **Popup blocker:** the first automatic open at start-up may be blocked until
  the cashier clicks once on the SamTill origin. SamTill shows a one-click
  **Open customer display** notice (remembered afterwards) and falls back to
  the in-page **Customer View** preview so selling never stops.
- **Monitor 2 unavailable:** nothing breaks. Sales continue on monitor 1, the
  till shows "Customer display not open", and the in-page **Customer View**
  preview shows the customer the same totals. Reconnect the monitor, click
  **Detect monitors**, then **Open / Reopen display**, or turn dual-screen
  mode off to stop the automatic attempt.

## Settings reference (`Settings → Dual-Screen Setup`)

| Control | Meaning |
|---|---|
| Enable dual-screen mode | Master switch (off by default, opt-in per device). |
| Open automatically when the till starts | Tries to open the display on its own; first time may need one click. |
| Open / Reopen display | One-click open or reconnect (counts as the user gesture browsers require). |
| Detect monitors | Re-reads the Window Management API. |
| What the customer screen shows | Branding, items, quantities, unit prices, line totals, subtotal, discounts, tax, amount due, payment confirmation. Read-only. |

Live status: monitors count, customer display connection, auto-open state.

## Recovery

- **Display closed / crashed / Windows disconnected monitor 2:** the cashier
  window detects it within ~2 s and reports "Customer display not open". Click
  **Open / Reopen display** (or **Dual Customer Screen** in the till sidebar).
- **Cart lost on refresh:** the cashier's cart snapshot is reconciled against
  the live product mirror (drops inactive/foreign/malformed lines, clamps
  stock to what is on hand) so a refresh never resurrects a stale line.
- **Payment confirmation:** published on checkout and cleared when the next item
  is scanned or after 20 s.

## Limitations (honest)

- Placement on monitor 2 is honoured only where the browser grants it
  (Chrome/Edge on Windows implement the Window Management API; Firefox/Safari
  do not). SamTill never claims it untested.
- Single-monitor fallback is always available; selling never depends on the
  display being open.
- Two windows of the same origin share localStorage, so a customer-display
  window may run the app's sync loop without a session token; those requests
  are denied by RLS and are non-fatal (the display itself is driven by
  BroadcastChannel, not by the database).