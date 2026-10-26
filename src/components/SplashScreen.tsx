import React, { useEffect, useState } from 'react';

/**
 * Startup splash screen.
 *
 * Shows the SamTill brand logo full-screen the moment the app opens, then
 * fades out to reveal whichever screen the session resolves to:
 *   - not signed in  → the Login tab of the auth page (Register is one click away)
 *   - signed in      → the dashboard (session restored from localStorage)
 *
 * It renders as a fixed overlay on top of the already-mounted app, so nothing
 * behind it is delayed or restructured — this is purely presentational and is
 * unmounted once its fade-out completes. It never shows on the customer
 * display window (that branch of main.tsx does not include it).
 *
 * Timings are local constants; reduced-motion users get the entrance
 * animations collapsed via CSS (`index.css`).
 */

/** How long the logo holds on screen before the fade-out begins. */
const HOLD_MS = 1500;
/** Fade-out duration before the overlay unmounts. */
const FADE_MS = 400;

type Phase = 'in' | 'out' | 'gone';

export const SplashScreen: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('in');

  useEffect(() => {
    const startFade = setTimeout(() => setPhase('out'), HOLD_MS);
    const unmount = setTimeout(() => setPhase('gone'), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(startFade);
      clearTimeout(unmount);
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div
      data-testid="splash-screen"
      aria-hidden="true"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#102A4C] transition-opacity duration-[400ms] ease-out ${
        phase === 'out' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Same framed logo treatment as the navbar / auth header for brand consistency */}
      <img
        src="/logo.png"
        alt=""
        className="splash-appear h-28 w-auto rounded-2xl bg-white p-3 shadow-2xl shadow-black/40"
      />
      <p className="splash-appear splash-stagger mt-6 text-sm font-bold uppercase tracking-[0.35em] text-slate-300">
        SamTill POS
      </p>
      {/* Indeterminate brand-orange sweep so the hold reads as "starting" */}
      <div className="splash-appear splash-stagger mt-9 h-1 w-44 overflow-hidden rounded-full bg-white/10">
        <span className="splash-sweep block h-full w-full" />
      </div>
    </div>
  );
};
