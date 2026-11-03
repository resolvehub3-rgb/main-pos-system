import React, {useEffect, useState} from 'react';
import {
  Monitor,
  Maximize2,
  Minimize2,
  Search,
  Info,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import {
  detectMultiMonitorSync,
  enumerateMonitors,
  type MonitorReport,
} from '../lib/dualScreen';
import {
  updateDualScreenSettings,
  useDualScreenSettings,
} from '../lib/dualScreenSettings';
import {
  customerDisplayConnectionLabel,
  useCustomerDisplayConnection,
} from '../lib/customerDisplayStatus';
import {
  exitAppFullscreen,
  isFullscreenActive,
  isFullscreenSupported,
  requestAppFullscreen,
  useFullscreenActive,
} from '../lib/fullscreen';

interface DualScreenSetupProps {
  /** Open / reopen / focus the customer display window (user gesture). */
  onOpenCustomerDisplay: () => void;
}

/** One switch row in the setup panel (settings apply live, like the till's). */
const ToggleRow: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}> = ({label, hint, checked, onChange}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <p className="font-bold text-slate-800">{label}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${
        checked ? 'bg-[#F28C28]' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  </div>
);

const StatusRow: React.FC<{label: string; value: string; tone: 'ok' | 'warn' | 'idle'}> = ({
  label,
  value,
  tone,
}) => (
  <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-b-0">
    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
    <span
      className={`text-[11px] font-bold text-right ${
        tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-700'
      }`}
    >
      {value}
    </span>
  </div>
);

/**
 * Dual-Screen Setup — the professional second-monitor panel in the shop
 * owner's Settings page.
 *
 * Everything here is best-effort and honest: monitor detection only reports
 * what the browser actually tells us, the window can only be placed where the
 * browser allows, and full-screen needs a click. The till never depends on
 * any of it — if the second monitor is missing, blocked or unplugged, the
 * cashier keeps selling on screen 1 and this panel says exactly why.
 */
export const DualScreenSetup: React.FC<DualScreenSetupProps> = ({onOpenCustomerDisplay}) => {
  const settings = useDualScreenSettings();
  const connection = useCustomerDisplayConnection();
  const fullscreenActive = useFullscreenActive();

  const [monitorReport, setMonitorReport] = useState<MonitorReport>(() => detectMultiMonitorSync());
  const [detectMessage, setDetectMessage] = useState<{ok: boolean; text: string} | null>(null);
  const [detecting, setDetecting] = useState(false);

  // Refresh the permission-free signal when the panel mounts (a monitor may
  // have been plugged in since the app started).
  useEffect(() => {
    setMonitorReport(detectMultiMonitorSync());
  }, []);

  const handleDetectMonitors = async () => {
    setDetecting(true);
    setDetectMessage(null);
    const result = await enumerateMonitors();
    setDetecting(false);
    if (result.ok) {
      setMonitorReport(result.report);
      setDetectMessage({
        ok: true,
        text: result.report.monitorCount
          ? `${result.report.monitorCount} monitor(s) detected.`
          : 'Monitors detected.',
      });
    } else if (result.reason === 'unsupported') {
      setDetectMessage({
        ok: false,
        text: 'This browser does not expose monitor details. SamTill will still open the display — drag it to monitor 2 once.',
      });
    } else if (result.reason === 'denied') {
      setDetectMessage({
        ok: false,
        text: 'Permission to read screen layout was declined. Nothing else is affected — open the display and drag it across.',
      });
    } else {
      setDetectMessage({ok: false, text: 'Could not read the screen layout.'});
    }
  };

  const monitorValue = (() => {
    if (monitorReport.source === 'window-management' && monitorReport.monitorCount !== null) {
      return monitorReport.monitorCount > 1
        ? `${monitorReport.monitorCount} monitors — customer display ready for monitor 2`
        : '1 monitor — customer display will open as a window on this screen';
    }
    if (monitorReport.multipleMonitors === true) {
      return 'Multiple monitors reported by this browser';
    }
    if (monitorReport.multipleMonitors === false) {
      return 'Single monitor reported (or monitor 2 not connected)';
    }
    return 'Not reported by this browser';
  })();

  const fullscreenSupported = isFullscreenSupported();

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
      <div className="flex items-center gap-2 mb-1">
        <Monitor className="w-5 h-5 text-[#F28C28]" />
        <h3 className="text-lg font-black text-slate-900">Dual-Screen Setup — Customer Display</h3>
      </div>
      <p className="text-xs text-slate-500 mb-6">
        Runs the customer-facing screen on a second monitor while the cashier keeps full control on
        monitor 1. Settings are remembered on this device and apply to the open till instantly.
        Cashiers cannot change them here — the till only reads them.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ---------------- Controls ---------------- */}
        <div className="space-y-5 text-xs font-medium text-slate-700">
          <ToggleRow
            label="Enable dual-screen mode"
            hint="Shows the SamTill customer display (branding, items, totals) on a second screen."
            checked={settings.enabled}
            onChange={(next) => updateDualScreenSettings({enabled: next})}
          />
          <ToggleRow
            label="Open automatically when the till starts"
            hint="SamTill tries to open the customer display on its own at start-up. The first time, the browser asks for one click to allow it."
            checked={settings.auto_open}
            onChange={(next) => updateDualScreenSettings({auto_open: next})}
          />
          <ToggleRow
            label="Start in full screen (kiosk mode)"
            hint="In the installed app, SamTill asks to fill the whole monitor. Esc always exits; the browser decides whether it can be automatic."
            checked={settings.auto_fullscreen}
            onChange={(next) => updateDualScreenSettings({auto_fullscreen: next})}
          />

          <div className="pt-4 border-t border-slate-200 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenCustomerDisplay}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold transition"
            >
              <Monitor className="w-4 h-4" />
              {connection === 'connected' ? 'Focus customer display' : 'Open / Reopen display'}
            </button>
            <button
              type="button"
              onClick={handleDetectMonitors}
              disabled={detecting}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold transition disabled:opacity-60"
            >
              <Search className="w-4 h-4" />
              {detecting ? 'Checking displays…' : 'Detect monitors'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (isFullscreenActive()) {
                  void exitAppFullscreen();
                } else {
                  void requestAppFullscreen().then((result) => {
                    if (result === 'unsupported') {
                      setDetectMessage({
                        ok: false,
                        text: 'Full screen is not available in this browser — the app keeps running normally.',
                      });
                    }
                  });
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold transition"
            >
              {fullscreenActive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              {fullscreenActive ? 'Exit full screen' : 'Enter full screen'}
            </button>
          </div>

          {detectMessage && (
            <p
              role="status"
              className={`flex items-start gap-1.5 text-[11px] font-bold ${
                detectMessage.ok ? 'text-emerald-600' : 'text-amber-700'
              }`}
            >
              {detectMessage.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              )}
              <span>{detectMessage.text}</span>
            </p>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
            <p className="font-bold text-slate-700 mb-1">What the customer screen shows</p>
            <p>
              Shop name and logo, product names and photos, quantities, unit prices, line totals,
              subtotal, discounts, tax, the amount due and the payment confirmation — nothing else.
              It is read-only: no costs, no stock figures, no controls and no credentials ever
              reach it.
            </p>
          </div>
        </div>

        {/* ---------------- Status + Windows guide ---------------- */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[11px] font-black text-slate-800 uppercase tracking-wide mb-1">
              Live status
            </p>
            <StatusRow
              label="Monitors"
              value={monitorValue}
              tone={
                monitorReport.multipleMonitors === false && monitorReport.source === 'is-extended'
                  ? 'warn'
                  : 'idle'
              }
            />
            <StatusRow
              label="Customer display"
              value={customerDisplayConnectionLabel(connection)}
              tone={
                connection === 'connected'
                  ? 'ok'
                  : connection === 'blocked' || connection === 'connecting'
                    ? 'warn'
                    : 'idle'
              }
            />
            <StatusRow
              label="Full screen"
              value={
                fullscreenActive
                  ? 'Full-screen active'
                  : fullscreenSupported
                    ? 'Windowed (click “Enter full screen”)'
                    : 'Not supported by this browser'
              }
              tone={fullscreenActive ? 'ok' : fullscreenSupported ? 'idle' : 'warn'}
            />
            <StatusRow
              label="Auto-open at start-up"
              value={settings.enabled ? (settings.auto_open ? 'On' : 'Off') : 'Dual screen off'}
              tone="idle"
            />
          </div>

          {/* Windows extended-display instructions */}
          <details className="group rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <summary className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer text-[11px] font-black text-slate-800 uppercase tracking-wide list-none">
              <span className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#F28C28]" />
                Windows 10 / 11 — configure the second display
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 pt-1 text-[11px] text-slate-600 space-y-2">
              <ol className="list-decimal pl-4 space-y-1.5">
                <li>
                  Connect the customer monitor (HDMI/DisplayPort/VGA) and power it on. Windows
                  usually detects it automatically.
                </li>
                <li>
                  Right-click the desktop → <b>Display settings</b> (or Settings → System →
                  Display).
                </li>
                <li>
                  Under <b>Multiple displays</b> choose <b>Extend these displays</b> — not
                  “Duplicate”. Pick <b>Keep changes</b> when Windows asks.
                </li>
                <li>
                  Click <b>Identify</b>: monitor <b>1</b> is the cashier till, monitor <b>2</b> is
                  the customer screen. Drag the numbered boxes so they match the physical layout
                  (usually 1 on the left, 2 on the right).
                </li>
                <li>
                  Set the resolution and scale (100% is typical for a till) and make sure the
                  taskbar sits on monitor 1 if you want it out of the customer's view.
                </li>
                <li>
                  In SamTill click <b>Open / Reopen display</b>. SamTill asks the browser to place
                  the window on monitor 2 and to fill it; where the browser refuses, drag the window
                  to monitor 2 once and click the ⛶ button on the customer screen to make it fill
                  the screen.
                </li>
              </ol>
              <p className="flex items-start gap-1.5 pt-1 text-slate-500">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                <span>
                  Browsers decide what a web app may do with windows: the first auto-open needs one
                  click on this origin, and window placement/full-screen are honoured where the
                  browser allows them. SamTill reports the real state instead of pretending.
                </span>
              </p>
            </div>
          </details>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
            <p className="font-black mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              If the second monitor is unavailable
            </p>
            <p>
              Unplugged, disabled or not reporting? Nothing breaks: sales continue on monitor 1,
              the till shows “Customer display not open”, and the in-page preview (Customer View)
              still shows the customer the same totals. Reconnect the monitor, click{' '}
              <b>Detect monitors</b>, then <b>Open / Reopen display</b> — or turn dual-screen mode
              off to stop the automatic attempt.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
