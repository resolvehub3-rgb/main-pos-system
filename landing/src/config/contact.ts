/**
 * ---------------------------------------------------------------------------
 * CONTACT DETAILS — CONFIRMED
 * ---------------------------------------------------------------------------
 * Every field below holds a real, verified detail and `ownerConfirmed` is
 * true, so both enquiry buttons are live: they open the visitor's own email
 * app or WhatsApp with a pre-filled message. Nothing is sent from a server
 * and no third party is involved.
 *
 * If a detail ever becomes stale, empty the field — the site then shows a
 * "still being finalised" notice instead of publishing a wrong value.
 */

export const CONTACT = {
  /** Set to true once every field below holds a real, verified detail. */
  ownerConfirmed: true,

  /** Real business email, e.g. 'sales@samteckdigital.com' */
  email: 'samteckdigital@gmail.com',

  /** WhatsApp number in international format without '+', e.g. '233241234567' */
  whatsapp: '0594345424',

  /** Public phone number displayed as text, e.g. '+233 24 123 4567' */
  phoneDisplay: '0594345424',

  /** Physical address or service area, e.g. 'Accra, Ghana' */
  address: 'Mamprobi, Accra, Ghana',

  /** Business hours text, e.g. 'Mon–Fri, 9am–5pm' */
  hours: 'Mon–Fri, 9am–5pm',
};

/** True when the website should show "details pending" notices. */
export const CONTACT_PENDING = !CONTACT.ownerConfirmed;

/**
 * Enquiry helpers.
 *
 * These build a pre-filled email or WhatsApp message from the visitor's own
 * device. Nothing is sent from a server, no data is stored, and no third
 * party is involved — which is why no backend approval is needed.
 */
export function buildMailtoLink(subject: string, body: string): string {
  return `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildWhatsAppLink(body: string): string {
  const number = CONTACT.whatsapp.replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
}

/** The default enquiry text the visitor can edit before sending. */
export const DEFAULT_ENQUIRY = [
  'Hello SamTeck Digital,',
  '',
  'I would like to enquire about SamTill for my shop.',
  '',
  'Shop type:',
  'Location:',
  'Preferred package (Starter / Business / Professional):',
  'Best number to reach me on:',
  '',
  'Thank you.',
].join('\n');
