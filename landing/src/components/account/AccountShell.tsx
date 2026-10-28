import type {ReactNode} from 'react';

/**
 * Shared chrome for the hash-routed account screens: heading, card and a way
 * back to the marketing page. Deliberately plain — no marketing claims are
 * made from these screens.
 */

export default function AccountShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="bg-slate-50 py-14 lg:py-20">
      <div className="mx-auto max-w-xl px-4 sm:px-6">
        <a
          href="#/"
          className="text-sm font-semibold text-navy-600 underline-offset-4 hover:text-amber-700 hover:underline"
        >
          ← Back to the SamTill website
        </a>

        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-navy-950">{title}</h1>
        {subtitle && <p className="mt-3 text-sm leading-relaxed text-navy-700">{subtitle}</p>}

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {children}
        </div>

        {footer && <div className="mt-5 text-sm text-navy-700">{footer}</div>}
      </div>
    </section>
  );
}
