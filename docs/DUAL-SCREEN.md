# Dual-Screen (Customer Display) Setup

SamTill POS runs the cashier interface on monitor 1 and a read-only customer
display on monitor 2. It stays a PWA: no Electron, no rebuild, no backend or
database replacement. The browser's standard APIs (Fullscreen API, popup
windows, BroadcastChannel, Window Management API) do the work.

## How it works (short version)

1. The cashier signs in and opens the till as usual.
2. In **Settings → Dual-Screen Setup — Customer Display** the owner enables
   **dual-screen mode** (off by default; opt-in per device).
3. SamTill opens a second browser window at `/?view=customer-display` and
   places it on a second monitor when the browser allows it.
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
4. Open SamTill in the browser (Chrome or Edge recommended — they implement
   the Window Management API that places the popup on monitor 2).
5. In SamTill: **Settings → Dual-Screen Setup → Enable dual-screen mode**,
   then click **Detect monitors**. The status should read **2 monitors**.
6. Click **Open / Reopen display**. SamTill opens the customer window and
   attempts to place it on monitor 2 and enter full-screen kiosk mode.
7. If the browser places it on monitor 1 (or ignores placement), drag it to
   monitor 2 and click **Enter full screen** on the customer window. Browsers
   require a user gesture for full-screen; this is expected and cannot be
   bypassed by SamTill.

## Activation workflow (honest limits)

- **Popup blocker:** the first automatic open at start-up may be blocked until
  the cashier clicks once on the SamTill origin. SamTill shows a one-click
  **Open customer display** notice (remembered afterwards) and falls back to
  the in-page **Customer View** preview so selling never stops.
- **Full screen:** `requestFullscreen()` needs a user gesture and the browser
  decides whether to honour it. SamTill attempts it automatically in the
  installed app; on refusal it raises a one-click notice. Esc always exits;
  SamTill never hides OS security UI.
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
| Start in full screen (kiosk mode) | Asks to fill the whole monitor in the installed app. |
| Open / Reopen display | One-click open or reconnect (counts as the user gesture browsers require). |
| Detect monitors | Re-reads the Window Management API. |
| Enter full screen | Full-screen the cashier window (header button too). |
| What the customer screen shows | Branding, items, quantities, unit prices, line totals, subtotal, discounts, tax, amount due, payment confirmation. Read-only. |

Live status: monitors count, customer display connection, full-screen state,
auto-open state.

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

- Placement on monitor 2 and full-screen kiosk mode are honoured only where the
  browser grants them (Chrome/Edge on Windows implement the Window Management
  API; Firefox/Safari do not). SamTill never claims them untested.
- The in-app browser used for testing cannot enter full screen (the request
  does not settle there), so full-screen activation was verified by code path
  and the honest one-click notice, not by an actual transition, in that
  environment.
- Two windows of the same origin share localStorage, so a customer-display
  window may run the app's sync loop without a session token; those requests
  are denied by RLS and are non-fatal (the display itself is driven by
  BroadcastChannel, not by the database).
- Single-monitor fallback is always available; selling never depends on the
  display being open.
path">
D:\main-pos-system\docs\DUAL-SCREEN.md