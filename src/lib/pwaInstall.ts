/**
 * Pure PWA installation detection & platform guidance helpers.
 *
 * Kept browser-free and dependency-free so every state transition and
 * platform classification can be unit-tested directly under `node:test`.
 */

export type PwaInstallState = 'installed' | 'installable' | 'unsupported';

export type InstallPlatformId =
  | 'chrome-windows'
  | 'edge-windows'
  | 'chrome-android'
  | 'safari-ios';

export interface PlatformInstallGuide {
  id: InstallPlatformId;
  label: string;
  shortLabel: string;
  browserName: string;
  osName: string;
  steps: string[];
}

export const PLATFORM_INSTALL_GUIDES: PlatformInstallGuide[] = [
  {
    id: 'chrome-windows',
    label: 'Chrome on Windows',
    shortLabel: 'Chrome (Windows)',
    browserName: 'Google Chrome',
    osName: 'Windows',
    steps: [
      'Open this website in Google Chrome on your Windows PC.',
      'Click the Install icon at the right side of the address bar, or open the Chrome menu (⋮) → Cast, save, and share → Install page as app.',
      'Click Install to create the SamTill POS desktop app window and taskbar shortcut.',
    ],
  },
  {
    id: 'edge-windows',
    label: 'Microsoft Edge on Windows',
    shortLabel: 'Edge (Windows)',
    browserName: 'Microsoft Edge',
    osName: 'Windows',
    steps: [
      'Open this website in Microsoft Edge on your Windows PC.',
      'Click the App available icon in the address bar, or open Settings and more (⋯) → Apps → Install this site as an app.',
      'Confirm Install — SamTill POS opens in its own standalone till window.',
    ],
  },
  {
    id: 'chrome-android',
    label: 'Chrome on Android',
    shortLabel: 'Chrome (Android)',
    browserName: 'Google Chrome',
    osName: 'Android',
    steps: [
      'Open this website in Google Chrome on your Android phone or tablet.',
      'Tap the ⋮ menu button in the top-right corner.',
      'Tap Install app (or Add to Home screen) and confirm Install.',
    ],
  },
  {
    id: 'safari-ios',
    label: 'Safari on iPhone and iPad',
    shortLabel: 'Safari (iPhone / iPad)',
    browserName: 'Safari',
    osName: 'iPhone & iPad',
    steps: [
      'Open this website in Safari (native WebKit installation requires Safari on iOS/iPadOS).',
      'Tap the Share button (square with an upward arrow) in the Safari toolbar.',
      'Scroll down and tap Add to Home Screen, then tap Add in the top-right corner.',
    ],
  },
];

/**
 * Detect which platform guide should be pre-selected for the visitor.
 * Falls back to `'chrome-windows'` when the UA does not match a specific
 * mobile or Edge signature, while all four platform guides remain accessible.
 */
export function detectInstallPlatform(userAgent: string): InstallPlatformId {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) {
    return 'safari-ios';
  }
  if (/Android/i.test(ua)) {
    return 'chrome-android';
  }
  if (/Edg\//i.test(ua)) {
    return 'edge-windows';
  }
  return 'chrome-windows';
}

export interface InstallStateInput {
  /** Running inside a standalone PWA window or navigator.standalone === true. */
  isStandalone: boolean;
  /** `appinstalled` fired or `getInstalledRelatedApps()` confirmed installation. */
  isInstalledConfirmed: boolean;
  /** Browser fired `beforeinstallprompt` and the prompt has not been consumed. */
  hasDeferredPrompt: boolean;
}

/**
 * Resolve the three installation states required by the marketing website:
 *  - `'installed'`   → State B: Show "Open SamTill" (navigates to /app/)
 *  - `'installable'` → State A: Show "Install SamTill" (triggers native prompt)
 *  - `'unsupported'` → State C: Show installation instructions (no broken button)
 *
 * Notice `hasDeferredPrompt` always overrides a stale local installed hint: if
 * Chromium fires `beforeinstallprompt`, the browser is explicitly reporting that
 * the PWA is not currently installed.
 */
export function resolvePwaInstallState(input: InstallStateInput): PwaInstallState {
  if (input.isStandalone) return 'installed';
  if (input.hasDeferredPrompt) return 'installable';
  if (input.isInstalledConfirmed) return 'installed';
  return 'unsupported';
}
