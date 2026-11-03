/**
 * Dual-screen (customer display) preferences for this device.
 *
 * Follows the same architecture as src/lib/terminalSettings.ts: one cached
 * object, localStorage persistence, listener set, cross-window `storage` sync
 * and a read-only React hook. The shop owner configures it in Settings →
 * Dual-Screen Setup; the cashier till reads it live and reacts instantly
 * (a change applies to every open window on this device).
 *
 * These are per-device display preferences, not store-wide business rules —
 * monitor layout belongs to the machine, so they are deliberately kept out of
 * the shared terminal (printer/audio) settings and out of the database.
 */
import {useEffect, useState} from 'react';

export interface DualScreenSettings {
  /** Master switch: SamTill runs the customer-facing second screen. */
  enabled: boolean;
  /**
   * Try to open the customer display automatically when a till starts.
   * Browsers may still require one prior click on this origin (popup grant);
   * when that happens the till shows a one-click activation notice instead.
   */
  auto_open: boolean;
  /**
   * Try to enter full-screen (kiosk) mode automatically when a till starts,
   * in the installed app. Browsers require a user gesture, so the first
   * launch shows a one-click "Enter full screen" notice.
   */
  auto_fullscreen: boolean;
}

const STORAGE_KEY = 'samtech_dual_screen_settings_v1';

const DEFAULT_SETTINGS: DualScreenSettings = {
  // Opt-in: an existing single-monitor shop must not suddenly spawn popups.
  // One toggle in Settings turns the whole workflow on, and it is remembered.
  enabled: false,
  auto_open: true,
  auto_fullscreen: true,
};

const listeners = new Set<() => void>();

function readFromStorage(): DualScreenSettings {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {...DEFAULT_SETTINGS};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {...DEFAULT_SETTINGS};
    return {...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DualScreenSettings>)};
  } catch {
    return {...DEFAULT_SETTINGS};
  }
}

let cache: DualScreenSettings = readFromStorage();

function notify() {
  listeners.forEach((cb) => cb());
}

export function getDualScreenSettings(): DualScreenSettings {
  return cache;
}

export function updateDualScreenSettings(patch: Partial<DualScreenSettings>): DualScreenSettings {
  cache = {...cache, ...patch};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota / private-mode errors — settings still apply for this session.
  }
  notify();
  return cache;
}

export function subscribeDualScreenSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Keep every window on this device in sync (owner dashboard ↔ cashier till).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cache = readFromStorage();
      notify();
    }
  });
}

/** React hook: live, read-only view of the dual-screen settings. */
export function useDualScreenSettings(): DualScreenSettings {
  const [settings, setSettings] = useState<DualScreenSettings>(cache);

  useEffect(() => {
    setSettings(cache);
    return subscribeDualScreenSettings(() => setSettings(readFromStorage()));
  }, []);

  return settings;
}
