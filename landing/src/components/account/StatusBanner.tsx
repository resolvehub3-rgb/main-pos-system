/** Outcome banner (success / info / error) used by the account forms. */

import type {ReactNode} from 'react';

export type BannerTone = 'success' | 'info' | 'error';

const TONES: Record<BannerTone, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

export default function StatusBanner({
  tone,
  children,
}: {
  tone: BannerTone;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm font-medium leading-relaxed ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
