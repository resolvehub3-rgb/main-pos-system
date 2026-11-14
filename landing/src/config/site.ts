/** Site-wide copy and navigation routes. */

export const SITE = {
  brand: 'SamTill',
  company: 'SamTeck Digital',
  tagline: 'Supermarket & retail point of sale',
  logoSrc: '/assets/logo.png',
  /** Public URL path of the SamTill POS PWA application. */
  webAppUrl: '/app/',
  loginUrl: '/app/login',
  siteApprovedForLaunch: true,
} as const;

export const NAV_LINKS = [
  {label: 'Home', href: '/'},
  {label: 'Features', href: '/features'},
  {label: 'Pricing', href: '/pricing'},
  {label: 'About', href: '/about'},
  {label: 'Contact', href: '/contact'},
] as const;

export const FOOTER_LINKS = [
  {label: 'Install & Download', href: '/download'},
  {label: 'Customer Billing', href: '#/account'},
  {label: 'Privacy Policy', href: '/privacy.html'},
  {label: 'Terms of Service', href: '/terms.html'},
] as const;
