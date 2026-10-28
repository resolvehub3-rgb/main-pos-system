/**
 * ---------------------------------------------------------------------------
 * APPROVED PRICING — ONE-TIME LICENCE TIERS
 * ---------------------------------------------------------------------------
 * Every price, package name and description on the website is read from this
 * single file. Change a value here and the whole site updates — nothing is
 * hard-coded in any component.
 *
 * APPROVED: one-time licences (GHS 499 / 899 / 1,499), one computer, six
 * months of maintenance and support from activation. This replaces the
 * earlier subscription proposal in landing/docs/01-commercial-decisions.md,
 * which remains on file as the record of that discussion.
 *
 * The `id` of each package MUST match the `code` of a row in the commerce
 * `plans` table: the website renders the copy here, but the server is the
 * only source of the price actually charged (GET /api/plans, POST
 * /api/checkout). A package with no matching active plan row cannot be
 * bought, so never rename an `id` without reseeding the plans table.
 */
export const PRICING_APPROVED = true;

export interface PackageFeature {
  /** Short label shown in the package card and the comparison table. */
  label: string;
  /** Optional clarifying detail. */
  detail?: string;
}

export interface PricingPackage {
  id: 'starter' | 'business' | 'professional';
  name: string;
  /** Display price in Ghana cedis. */
  price: number;
  currency: string;
  /** e.g. "One-time licence" */
  licenceType: string;
  /** e.g. "1 computer" */
  licenceSeats: string;
  description: string;
  features: PackageFeature[];
  highlighted: boolean;
  /**
   * True when this package lists features whose assignment to this tier has
   * not been confirmed by the owner yet. The card then shows a visible note
   * so the website never overstates what a package includes.
   */
  draftTierFeatures: boolean;
}

/** Approved licence terms. Editable in one place. */
export const LICENCE_TERMS = {
  /** Number of months of maintenance and support included at purchase. */
  includedSupportMonths: 6,
  summary:
    'Each package is a one-time licence for one computer and includes six (6) months of maintenance and support from activation.',
  permanentUse:
    'You keep permanent use of the version of SamTill you bought. Maintenance, support and software updates are included for the first six (6) months; after that the software keeps working, and only renewed support and newer versions require a new fee.',
  renewalNote:
    'Six months after activation, support and updates can be renewed for a fee quoted at the time. Renewal is optional — the version you bought does not stop working if you do not renew.',
};

export const PACKAGES: PricingPackage[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 499,
    currency: 'GH₵',
    licenceType: 'One-time licence',
    licenceSeats: '1 computer',
    description:
      'For a single shop that needs fast, reliable barcode checkout and clear daily sales records.',
    features: [
      {label: 'Barcode checkout till'},
      {label: 'Product and category management'},
      {label: 'Stock movement records'},
      {label: 'Receipt printing'},
      {label: 'Daily sales reports'},
    ],
    highlighted: false,
    draftTierFeatures: false,
  },
  {
    id: 'business',
    name: 'Business',
    price: 899,
    currency: 'GH₵',
    licenceType: 'One-time licence',
    licenceSeats: '1 computer',
    description:
      'For a growing shop that wants fuller stock control, customer records and stronger reporting.',
    features: [
      {label: 'Everything in Starter'},
      {label: 'Stock Book inventory ledger'},
      {label: 'Customer records'},
      {label: 'Staff accounts'},
      {label: 'Expense tracking'},
      {label: 'Report export (PDF, print, CSV)'},
    ],
    highlighted: true,
    draftTierFeatures: false,
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 1499,
    currency: 'GH₵',
    licenceType: 'One-time licence',
    licenceSeats: '1 computer',
    description:
      'For a busy supermarket that needs the full till workflow, customer-facing display and shift control.',
    features: [
      {label: 'Everything in Business'},
      {label: 'Customer-facing display'},
      {label: 'Shift and cash drawer control'},
      {label: 'Price checker'},
      {label: 'Sales history and invoice reprints'},
    ],
    highlighted: false,
    draftTierFeatures: false,
  },
];

/**
 * PACKAGE COMPARISON — feature-by-feature matrix.
 *
 * Rows marked `ownerReview: true` are shown on the site as "To be confirmed"
 * until the owner defines exactly which capability belongs to which package.
 * This prevents the website from advertising functionality that has not been
 * agreed. Every row below is now confirmed and matches PACKAGES exactly —
 * keep the two in sync when a package changes.
 */
export interface ComparisonRow {
  feature: string;
  detail?: string;
  /** Values must line up with PACKAGES order: Starter, Business, Professional. */
  values: [string, string, string];
  ownerReview: boolean;
}

export const COMPARISON_ROWS: ComparisonRow[] = [
  {
    feature: 'Licence type',
    values: ['One-time', 'One-time', 'One-time'],
    ownerReview: false,
  },
  {
    feature: 'Licensed computers',
    values: ['1', '1', '1'],
    ownerReview: false,
  },
  {
    feature: 'Included maintenance & support',
    detail: 'From activation',
    values: ['6 months', '6 months', '6 months'],
    ownerReview: false,
  },
  {
    feature: 'Barcode checkout till',
    values: ['Included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Receipt printing',
    values: ['Included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Product & category management',
    values: ['Included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Stock movement records',
    values: ['Included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Sales reports',
    values: ['Included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Stock Book inventory ledger',
    values: ['Not included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Customer records',
    values: ['Not included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Staff accounts',
    values: ['Not included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Expense tracking',
    values: ['Not included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Report export (PDF, print, CSV)',
    values: ['Not included', 'Included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Customer-facing display',
    detail: 'Second screen for the customer',
    values: ['Not included', 'Not included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Shift & cash drawer control',
    values: ['Not included', 'Not included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Price checker',
    values: ['Not included', 'Not included', 'Included'],
    ownerReview: false,
  },
  {
    feature: 'Sales history and invoice reprints',
    values: ['Not included', 'Not included', 'Included'],
    ownerReview: false,
  },
];
