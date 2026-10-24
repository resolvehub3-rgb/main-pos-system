# Receipt Printing

Samtech Helper POS prints receipts two ways, and the shop owner chooses which
one their tills use.

| Method | What happens | When to use it |
| --- | --- | --- |
| **Automatic** (default) | Print via the thermal printer if the local print bridge is running, otherwise open the browser print dialog | Most shops |
| **Thermal Printer Only** | Print via the thermal printer, never the browser. A failure is shown to the cashier instead of downgraded | Tills that must always produce paper |
| **Browser Print Dialog** | Always open the browser print dialog | No thermal printer available |

The owner sets this under **Settings → Terminal Settings → Receipt Output**.
It applies to every open cashier till instantly; cashiers cannot change it.

> **Browser printing is not silent printing.** Browsers open a print dialog that
> someone has to confirm. If you want paper to come out with no dialog, you need
> the thermal printer plus the local print bridge described below.

---

## Why a print bridge is needed

A browser cannot write to a USB thermal printer. It can only hand a rendered
page to the operating system's print dialog, which then applies driver options
and waits for a human to click Print.

ESC/POS thermal printers understand a raw byte stream, not a web page. The
**local print bridge** is a tiny service that runs on the till machine itself,
listens on `127.0.0.1`, and writes that byte stream straight to the printer.
The browser sends it the receipt; paper comes out.

```
Cashier clicks "Confirm & Print"
        │
        ▼
  Browser renders receipt → ESC/POS bytes
        │
        ▼
  POST http://127.0.0.1:9210/print
        │
        ├── bridge running ──► thermal printer ──► paper (no dialog)
        │
        └── bridge offline ──► window.print()    (browser dialog)
```

The bridge is **optional**. Without it the app still prints, through the browser
dialog. Nothing breaks by not installing it.

---

## Install and start

The bridge ships with this repository — there is nothing extra to download.

```bash
npm install
npm run print-bridge
```

You should see:

```
  Samtech print bridge
  Address:   http://127.0.0.1:9210
  Token:     3f2a9c...            (64 hex chars)
  Transport: auto
  Printer:   (auto-detect)
  Origins:   any loopback origin (localhost / 127.0.0.1 / [::1], any port)
```

Keep it running while the till is in use. To start it automatically with
Windows, use Task Scheduler with the trigger **At log on** and the action
`npm` with arguments `run print-bridge` in the project folder.

Then open **Settings → Terminal Settings → Local Print Bridge** and confirm the
status reads **Connected**. If it says *Not running*, the bridge isn't started
or the till browser isn't on the same machine as the printer.

### Connecting the printer

1. Plug the thermal printer in over USB and let Windows install it.
2. Print a self-test page from the printer's own buttons to confirm it works.
3. In **Local Print Bridge**, choose the printer from the **Thermal Printer**
   dropdown, or leave it on *Auto-select* — the bridge prefers a USB printer,
   then the Windows default.
4. Click **Test Print**. A short test page should come out.

Paper width is set separately under **Thermal Receipt Paper Width** (58 mm or
80 mm) and must match the roll in the printer.

---

## Configuration

App variables go in `.env` (see `.env.example`). Bridge variables are read by
the bridge process, so set them in the shell that starts it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_PRINT_BRIDGE_URL` | `http://127.0.0.1:9210` | Where the app looks for the bridge |
| `PRINT_BRIDGE_PORT` | `9210` | Port the bridge listens on |
| `PRINT_BRIDGE_HOST` | `127.0.0.1` | Bind address — keep on loopback |
| `PRINT_BRIDGE_ORIGINS` | *(unset)* | Optional comma-separated **exact** origins. Unset = any loopback origin on any port |
| `PRINT_BRIDGE_TOKEN` | generated | Shared secret; generated and stored on first run if unset |
| `PRINT_TRANSPORT` | `auto` | `auto`, `usb`, `network`, or `file` |
| `PRINT_PRINTER` | auto-detected | Windows printer name to target |
| `PRINT_NETWORK_HOST` | — | Printer IP, for a network printer |
| `PRINT_NETWORK_PORT` | `9100` | Network printer port |
| `PRINT_SPOOL_DIR` | `./print-spool` | Where receipts go when no printer is configured |

If the app and bridge run on **different machines**, set
`VITE_PRINT_BRIDGE_URL` on the app side *and* set `PRINT_BRIDGE_ORIGINS` to the
app's origin — a remote origin is never loopback, so the default gate rejects it
outright. The bridge binds to
loopback by default; binding to a LAN address exposes it to your network, so
only do that on a trusted, isolated network.

### Transports

- **`usb`** — the printer is installed in Windows (which is how a USB till
  printer appears) and the bridge writes raw bytes to it. This is what you want
  for a USB thermal printer.
- **`network`** — raw TCP to a printer on the LAN, port 9100 by default. Set
  `PRINT_NETWORK_HOST`.
- **`file`** — writes each receipt to `PRINT_SPOOL_DIR`. Useful for verifying
  output on a machine with no printer, and as a last-resort fallback so a
  receipt is never silently dropped.
- **`auto`** (default) — network if a host is configured, else USB if a printer
  can be found, else the spool directory.

---

## Security

The bridge can make paper come out of a printer on your machine, so it is
locked down in three layers.

1. **Loopback only.** It binds to `127.0.0.1` and is not reachable from
   another computer unless you deliberately change `PRINT_BRIDGE_HOST`.
2. **Loopback origin gate.** The browser is the thing being defended against,
   because any tab can try to reach `127.0.0.1`. Requests whose `Origin` is not
   served from this machine are rejected, and CORS headers are only ever echoed
   to loopback origins. Because the browser enforces this, it actually holds.
   Any *port* is accepted by default — `vite` silently moves from 3000 to 3001
   when 3000 is busy, and pinning a port turned that into an unexplained CORS
   failure. Set `PRINT_BRIDGE_ORIGINS` to switch to an exact allow-list (for a
   dedicated till on a fixed port), and set it *necessarily* if the app runs on
   another machine, whose origin is not loopback. The check is on the parsed
   hostname, so `http://localhost.evil.com` is refused despite starting with
   "localhost".
3. **Shared token.** Every printing endpoint requires an `X-Bridge-Token`
   header, so a page that happens to run on an allowed origin still cannot
   print unless it holds the secret. Non-browser clients (curl, another local
   user) need it too.

The token is generated on first run and stored in
`print-bridge/.bridge-token`, which is git-ignored. The app reads it once at
startup from `/bridge/info` — an endpoint protected by the loopback origin gate
rather than the token, which solves the chicken-and-egg problem of fetching a
secret you don't have yet.

Other limits: request bodies are capped at 256 KB (a receipt is a few KB), and
jobs are throttled to 20 per 10 seconds so a runaway loop cannot spin the
printer.

**If you change the token or the origins, restart the bridge.** The app caches
the token for the browser session, so if printing suddenly stops with a 403,
reload the till page.

---

## Troubleshooting

**Settings says "Not running"**
Start the bridge with `npm run print-bridge` and click **Refresh**. The app and
the bridge must be on the same machine unless you configured
`VITE_PRINT_BRIDGE_URL`.

**Status is Connected but nothing prints**
Click **Test Print**. If the test page prints, the bridge and printer are fine
— check the receipt path setting. If not, the printer selection is probably
wrong; try *Auto-select*.

**Receipt prints blank or as garbled text**
The printer is a normal Windows driver printer rather than a raw ESC/POS
device, or the wrong paper width is selected. Confirm the printer prints raw
text from other POS software, and match **Thermal Receipt Paper Width** to the
roll.

**Wrong characters for `GH₵`**
ESC/POS code pages do not include the cede sign, so receipts print `GHS`.
Accents are folded to plain ASCII for the same reason.

**Cashier sees "Thermal printer error"**
The owner selected *Thermal Printer Only* and the bridge could not take the
job. The receipt is not silently lost — reprint it from **Sales History** once
the printer is fixed.

**Nothing comes out but no error appears**
You are on *Automatic* and the browser dialog was dismissed. Switch to
*Thermal Printer Only* if you want a failed print to be reported.

---

## Verifying without a printer

Run the bridge with the `file` transport and send a job:

```bash
PRINT_TRANSPORT=file PRINT_SPOOL_DIR=./print-spool npm run print-bridge
```

Each receipt is written to `print-spool/receipt-<timestamp>.bin`. These files
contain real sale data and are git-ignored — do not share them. An automated
check of the origin gate, token gate, job validation, and byte delivery is in
`print-bridge/verify.ts`.

---

## Receipt layout

Receipts are generated as ESC/POS by `src/lib/escpos.ts`, which is covered by
tests in `src/lib/escpos.test.ts`:

```bash
npx tsx --test src/lib/escpos.test.ts
```

Widths are 32 columns for 58 mm and 48 columns for 80 mm.
