import {useEffect, useState} from 'react';
import {NAV_LINKS, SITE} from '../config/site';
import {navigateRoute} from '../lib/navigation';
import {useHashRoute} from '../lib/useHashRoute';
import SmartInstallButton from './SmartInstallButton';

export default function Nav() {
  const [open, setOpen] = useState(false);
  const route = useHashRoute();

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
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigateRoute('/');
          }}
          className="flex items-center gap-3"
        >
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

        <ul className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = route.path === link.href;
            return (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateRoute(link.href);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`text-sm font-semibold transition-colors ${
                    active ? 'text-amber-400' : 'text-navy-100 hover:text-amber-400'
                  }`}
                >
                  {link.label}
                </a>
              </li>
            );
          })}
        </ul>

        <div className="hidden items-center gap-3 lg:flex">
          <SmartInstallButton variant="nav" />
          <a
            href={SITE.loginUrl}
            className="inline-flex items-center rounded-full bg-amber-700 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Login
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
                onClick={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  navigateRoute(link.href);
                }}
                className="block rounded-lg px-3 py-3 text-base font-semibold text-navy-100 transition-colors hover:bg-navy-800 hover:text-amber-400"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li className="mt-3">
            <SmartInstallButton variant="mobile" onAction={() => setOpen(false)} />
          </li>
          <li className="mt-2">
            <a
              href={SITE.loginUrl}
              onClick={() => setOpen(false)}
              className="block rounded-full bg-amber-700 px-5 py-3 text-center text-base font-bold text-white transition-colors hover:bg-amber-800"
            >
              Login
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
