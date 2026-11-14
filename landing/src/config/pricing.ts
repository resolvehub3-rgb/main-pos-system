/**
 * ---------------------------------------------------------------------------
 * SAMTILL POS — SINGLE 6-MONTH SUBSCRIPTION PRICING
 * ---------------------------------------------------------------------------
 * Every price, subscription name, duration and description on the website is
 * read from this single file.
 *
 * MODEL:
 *   - Product:      SamTill POS
 *   - Subscription: 6-Month Subscription
 *   - Price:        GH₵500.00 (50,000 pesewas)
 *   - Payment type: Single upfront payment
 *   - Duration:     6 calendar months from successful payment activation
 *
 * The `id` MUST match the active `code` in the commerce `public.plans` table:
 * the server (GET /api/plans, POST /api/checkout) is the single source of
 * truth for the amount charged via Paystack.
 */
export const PRICING_APPROVED = true;

export interface PackageFeature {
  label: string;
  detail?: string;
}

export interface SubscriptionPlan {
  id: 'samtill-pos-6m';
  productName: string;
  name: string;
  /** Display price in Ghana cedis (500 = GH₵500.00). */
  price: number;
  /** Authoritative amount in minor units (pesewas) matching seeded `plans.amount_minor`. */
  amountMinor: number;
  currency: string;
  currencyCode: 'GHS';
  paymentType: string;
  durationLabel: string;
  durationMonths: number;
  description: string;
  features: PackageFeature[];
}

export const SUBSCRIPTION_PLAN: SubscriptionPlan = {
  id: 'samtill-pos-6m',
  productName: 'SamTill POS',
  name: '6-Month Subscription',
  price: 500,
  amountMinor: 50000,
  currency: 'GH₵',
  currencyCode: 'GHS',
  paymentType: 'Single upfront payment',
  durationLabel: '6 Months',
  durationMonths: 6,
  description:
    'Get full access to the SamTill POS system for six months from the date your payment is verified and activated.',
  features: [
    {label: 'Fast barcode checkout till'},
    {label: 'Product & category management'},
    {label: 'Stock Book inventory ledger & stock alerts'},
    {label: 'Thermal receipt printing & invoice reprints'},
    {label: 'Daily sales, expense & profit reports'},
    {label: 'Staff accounts, shift & cash drawer control'},
    {label: 'Customer-facing display & offline-ready PWA'},
    {label: 'Software updates & support for 6 months'},
  ],
};

/** Single-element list preserved for helpers that iterate over active plans. */
export const PACKAGES: readonly SubscriptionPlan[] = [SUBSCRIPTION_PLAN];

/** Terms shown below the subscription card and on checkout. */
export const SUBSCRIPTION_TERMS = {
  durationMonths: 6,
  summary:
    'A single upfront payment of GH₵500.00 activates your SamTill POS subscription for six (6) calendar months.',
  activation:
    'Your subscription start date is recorded immediately upon backend payment verification, and expiry is set six calendar months after activation.',
  renewalNote:
    'There is no automatic monthly billing. When your six-month period approaches expiry, you can renew directly from your account.',
};

/** Backwards-compatible alias for any shared callers referencing term copy. */
export const LICENCE_TERMS = {
  includedSupportMonths: SUBSCRIPTION_TERMS.durationMonths,
  summary: SUBSCRIPTION_TERMS.summary,
  permanentUse: SUBSCRIPTION_TERMS.activation,
  renewalNote: SUBSCRIPTION_TERMS.renewalNote,
};
