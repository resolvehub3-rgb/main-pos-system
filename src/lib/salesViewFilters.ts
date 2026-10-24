/**
 * Month + cashier filters on the Shop Owner's *Store Sales & Invoices* page.
 *
 * These are view state rather than business data, but they are worth
 * remembering: an owner who narrows the ledger to "October / Kwame", walks to
 * the till to serve a customer, then comes back should land on the same slice
 * of the ledger — not on an unfiltered list they then have to re-narrow.
 *
 * Scoped per shop, because neither filter means anything outside one shop: a
 * cashier's name from another supermarket would match no sales at all and
 * quietly show an empty ledger.
 *
 * Written on change rather than from an effect, so a filter is only ever
 * persisted as a deliberate act of the person clicking it.
 */

export interface SalesViewFilters {
  /** `'all'` or a `'YYYY-MM'` key. */
  month: string;
  /** `'all'` or a cashier's display name. */
  cashier: string;
}

export const ALL_SALES_VIEW_FILTERS: SalesViewFilters = { month: 'all', cashier: 'all' };

const STORAGE_KEY = 'samtech_sales_view_filters_v1';

/** `all`, or a zero-padded calendar month. Rejects hand-edited junk. */
function isMonthKey(value: unknown): value is string {
  return (
    value === 'all' ||
    (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value))
  );
}

/**
 * A cashier name is free text the app itself never validates, so the only real
 * requirement is that it is a plausible string. The length cap keeps a corrupted
 * storage value from turning into an enormous option in the dropdown.
 */
function isCashierFilter(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function sanitize(raw: unknown): SalesViewFilters {
  if (!raw || typeof raw !== 'object') return { ...ALL_SALES_VIEW_FILTERS };
  const record = raw as Record<string, unknown>;
  return {
    month: isMonthKey(record.month) ? record.month : ALL_SALES_VIEW_FILTERS.month,
    cashier: isCashierFilter(record.cashier) ? record.cashier : ALL_SALES_VIEW_FILTERS.cashier,
  };
}

function readStore(): Record<string, SalesViewFilters> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const store: Record<string, SalesViewFilters> = {};
    for (const [tenantId, value] of Object.entries(parsed as Record<string, unknown>)) {
      store[tenantId] = sanitize(value);
    }
    return store;
  } catch {
    // Corrupt storage must not stop the page rendering — start unfiltered.
    return {};
  }
}

/** The filters this shop was last left on, or `all` / `all` on first visit. */
export function loadSalesViewFilters(tenantId: string): SalesViewFilters {
  if (!tenantId) return { ...ALL_SALES_VIEW_FILTERS };
  return readStore()[tenantId] ?? { ...ALL_SALES_VIEW_FILTERS };
}

export function saveSalesViewFilters(tenantId: string, filters: SalesViewFilters): void {
  if (!tenantId) return;
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const store = readStore();
    store[tenantId] = sanitize(filters);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode — the filters still apply for this session, and
    // losing them on the next visit is not worth surfacing an error.
  }
}
