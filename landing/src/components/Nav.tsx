import {useEffect, useState} from 'react';
import {COMMERCE} from '../config/commerce';
import {NAV_LINKS, SITE} from '../config/site';
import {accountAvailability, downloadAvailability} from '../lib/availability';
import {readCommerceEnv} from '../lib/commerceClient';

export default function Nav() {
  const [open, setOpen] = useState(false);

  // Account/download links appear only when the owner switches them on AND
  // the deployment is actually configured — no promises the site cannot keep.
  const accountGate = accountAvailability(COMMERCE, readCommerceEnv());
  const downloadGate = downloadAvailability(COMMERCE, readCommerceEnv());
  const accountLinks = [
    ...(downloadGate.available ? [{label: 'Download', href: '#/download'}] : []),
    ...(accountGate.available ? [{label: 'Sign in', href: '#/login'}] : []),
  ];

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-navy-950 shadow-lg shadow-black/20">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:h-[72px] lg:px-8"
      >
        <a href="#top" className="flex items-center gap-3">
          <img
            src={SITE.logoSrc}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-lg bg-white object-contain p-0.5"
          />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-extrabold tracking-tight text-white">{SITE.brand}</span>
            <span className="hidden text-[11px] font-medium text-navy-200 sm:block">
              by {SITE.company}
            </span>
          </span>
        </a>

        <ul className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm font-semibold text-navy-100 transition-colors hover:text-amber-400"
              >
                {link.label}
              </a>
            </li>
          ))}
          {accountLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm font-semibold text-amber-300 transition-colors hover:text-amber-400"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <a
            href="#contact"
            className="inline-flex items-center rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Enquire now
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white lg:hidden"
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </nav>

      <div id="mobile-menu" hidden={!open} className="border-t border-navy-700 bg-navy-950 lg:hidden">
        <ul className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-3 text-base font-semibold text-navy-100 transition-colors hover:bg-navy-800 hover:text-amber-400"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li className="mt-2">
            <a
              href="#contact"
              onClick={() => setOpen(false)}
              className="block rounded-full bg-amber-700 px-5 py-3 text-center text-base font-bold text-white transition-colors hover:bg-amber-800"
            >
              Enquire now
            </a>
          </li>
          {accountLinks.map((link) => (
            <li key={link.href} className="mt-1">
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-3 text-base font-semibold text-amber-300 transition-colors hover:bg-navy-800 hover:text-amber-400"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
