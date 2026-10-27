/**
 * ---------------------------------------------------------------------------
 * DRAFT PRICING — REQUIRES OWNER APPROVAL BEFORE PUBLIC LAUNCH
 * ---------------------------------------------------------------------------
 * Every price, package name and description on the website is read from this
 * single file. Change a value here and the whole site updates — nothing is
 * hard-coded in any component.
 *
 * The figures below are PROPOSED. They must be confirmed or amended by the
 * owner of SamTeck Digital before this website is published.
 */

/** Flip to `true` only once the owner has approved the prices for publication. */
export const PRICING_APPROVED = false;

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

/** Proposed licence terms. Editable in one place. */
export const LICENCE_TERMS = {
  /** Number of months of maintenance and support included at purchase. */
  includedSupportMonths: 6,
  summary:
    'Each package is a one-time licence for one computer and includes six (6) months of maintenance and support from activation.',
  permanentUse:
    'Permanent use applies to the licensed version of SamTill. Future maintenance, support and software updates may require renewal, according to the final terms approved by the owner of SamTeck Digital.',
  renewalNote:
    'Renewal terms for maintenance, support and updates beyond the initial six-month period are still being finalised and will be published before launch.',
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
    draftTierFeatures: true,
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
    draftTierFeatures: true,
  },
];

/**
 * PACKAGE COMPARISON — feature-by-feature matrix.
 *
 * Rows marked `ownerReview: true` are shown on the site as "To be confirmed"
 * until the owner defines exactly which capability belongs to which package.
 * This prevents the website from advertising functionality that has not been
 * agreed. Edit freely; set ownerReview to false once confirmed.
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
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
  {
    feature: 'Customer records',
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
  {
    feature: 'Staff accounts',
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
  {
    feature: 'Expense tracking',
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
  {
    feature: 'Customer-facing display',
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
  {
    feature: 'Shift & cash drawer control',
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
  {
    feature: 'Report export (PDF, print, CSV)',
    values: ['To be confirmed', 'To be confirmed', 'To be confirmed'],
    ownerReview: true,
  },
];
