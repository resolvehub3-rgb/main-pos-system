import {CONTACT, CONTACT_PENDING} from '../config/contact';
import {FOOTER_LINKS, NAV_LINKS, SITE} from '../config/site';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-navy-800 bg-navy-950">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              <img
                src={SITE.logoSrc}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-lg bg-white object-contain p-0.5"
              />
              <div className="leading-tight">
                <p className="text-lg font-extrabold text-white">{SITE.brand}</p>
                <p className="text-xs font-medium text-navy-300">by {SITE.company}</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-navy-300">
              Point-of-sale and retail management for Ghanaian supermarkets and shops — barcode
              checkout, stock records, receipts and sales reports.
            </p>
          </div>

          <nav aria-label="Footer">
            <h2 className="text-sm font-bold uppercase tracking-widest text-white">Explore</h2>
            <ul className="mt-4 space-y-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-navy-300 transition-colors hover:text-amber-400"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-white">Contact</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-navy-300">
              <li>{SITE.company}</li>
              <li>{CONTACT.email || 'Email — to be confirmed'}</li>
              <li>{CONTACT.phoneDisplay || 'Phone / WhatsApp — to be confirmed'}</li>
              <li>{CONTACT.address || 'Location — to be confirmed'}</li>
            </ul>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm font-semibold text-navy-200 underline decoration-navy-600 underline-offset-4 transition-colors hover:text-amber-400 hover:decoration-amber-400"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-navy-800 pt-6">
          <p className="text-xs leading-relaxed text-navy-300">
            © {year} {SITE.company}. {SITE.brand} is a product of {SITE.company}. All rights
            reserved.
          </p>
          {CONTACT_PENDING && (
            <p className="mt-2 text-xs font-medium text-amber-400/90">
              Preview site — contact details, prices and policies are draft and awaiting owner
              confirmation. No downloads, online payments or registrations are offered on this
              site.
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
