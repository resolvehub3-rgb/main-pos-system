/** Site-wide copy. Edit here to change wording across the whole website. */

export const SITE = {
  brand: 'SamTill',
  company: 'SamTeck Digital',
  tagline: 'Supermarket & retail point of sale',
  logoSrc: '/assets/logo.png',
  /**
   * Public URL of the deployed SamTill web/PWA application.
   * Leave '' until the owner confirms the address — nothing is linked or
   * claimed while it is empty.
   */
  webAppUrl: '',
  /** Set true once the site is approved for public launch. */
  siteApprovedForLaunch: false,
  previewNotice:
    'Preview build — package pricing is proposed and awaits owner approval before public launch.',
} as const;

export const NAV_LINKS = [
  {label: 'Features', href: '#features'},
  {label: 'Pricing', href: '#pricing'},
  {label: 'How it works', href: '#how-it-works'},
  {label: 'FAQ', href: '#faq'},
  {label: 'Contact', href: '#contact'},
] as const;

export const FOOTER_LINKS = [
  {label: 'Privacy Policy', href: '/privacy.html'},
  {label: 'Terms of Service', href: '/terms.html'},
] as const;
