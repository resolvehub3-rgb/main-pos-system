/**
 * ---------------------------------------------------------------------------
 * APPROVED PRICING — SINGLE 6-MONTH SUBSCRIPTION PACKAGE
 * ---------------------------------------------------------------------------
 * All pricing copy across the website and checkout reads from this single file.
 *
 * MODEL:
 *   Product:       SamTill POS
 *   Plan Code:     samtill-6m
 *   Subscription:  6-Month Subscription
 *   Price:         GH₵500.00 (50000 pesewas)
 *   Payment Type:  Single upfront payment (no automatic recurring billing)
 *   Duration:      6 Months from successful activation
 */
export const PRICING_APPROVED = true;

export const SAMTILL_PLAN_CODE = 'samtill-6m' as const;

export interface PackageFeature {
  label: string;
  detail?: string;
}

export interface PricingPackage {
  id: typeof SAMTILL_PLAN_CODE;
  productName: string;
  name: string;
  /** Display price in Ghana cedis. */
  price: number;
  amountMinor: number;
  currency: string;
  paymentType: string;
  durationLabel: string;
  intervalMonths: number;
  description: string;
  features: PackageFeature[];
}

/** Approved subscription terms. Editable in one place. */
export const LICENCE_TERMS = {
  includedSupportMonths: 6,
  summary:
    'A single upfront payment of GH₵500.00 grants full access to SamTill POS for 6 calendar months from successful activation.',
  noAutoRenewal:
    'Single upfront payment — no automatic deductions or hidden recurring charges. When your 6-month period ends, you can renew manually anytime.',
  renewalNote:
    'Active subscriptions extend cleanly from your existing expiry date if renewed early, or restart for a fresh 6 months after expiry.',
};

export const SAMTILL_PLAN: PricingPackage = {
  id: SAMTILL_PLAN_CODE,
  productName: 'SamTill POS',
  name: '6-Month Subscription',
  price: 500,
  amountMinor: 50000,
  currency: 'GH₵',
  paymentType: 'Single upfront payment',
  durationLabel: '6 Months',
  intervalMonths: 6,
  description:
    'Complete supermarket and retail Point of Sale suite with barcode checkout, Stock Book inventory, receipt printing, staff accounts, and live analytics.',
  features: [
    {label: 'Fast barcode checkout & cashier POS terminal'},
    {label: 'Unlimited products, categories & Stock Book inventory ledger'},
    {label: 'Thermal receipt printing & Windows print bridge support'},
    {label: 'Live sales, expense, and profit analytics reports'},
    {label: 'Customer-facing dual display & shift cash drawer control'},
    {label: 'Staff cashier accounts with PIN security & cloud backup'},
    {label: 'Offline-ready PWA resilience & 6 months updates + support'},
  ],
};

export const PACKAGES: PricingPackage[] = [SAMTILL_PLAN];
