/**
 * Notice shown instead of a form when a customer screen is switched off or
 * the deployment has no commerce backend configured. Honest by design: it
 * explains the real state rather than pretending a feature works.
 */

export default function GateNotice({
  notice,
  actionHref,
  actionLabel,
}: {
  notice: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm font-medium leading-relaxed text-amber-900"
    >
      {notice}
      {actionHref && actionLabel && (
        <p className="mt-3">
          <a
            href={actionHref}
            className="font-bold text-amber-800 underline-offset-4 hover:underline"
          >
            {actionLabel} →
          </a>
        </p>
      )}
    </div>
  );
}
