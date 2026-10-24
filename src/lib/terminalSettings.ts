/**
 * Terminal (till hardware) settings shared between the Shop Owner dashboard and the Cashier POS.
 *
 * Only the Shop Owner can change these values — the cashier till reads them and reacts live,
 * so a change made in the owner dashboard applies to every open till instantly.
 */
import { useEffect, useState } from 'react';

/**
 * How a receipt reaches paper.
 *
 * - `auto`    — prefer the local print bridge (direct thermal output), fall back
 *               to the browser print dialog if the bridge isn't running.
 * - `bridge`  — hardware only; never fall back to the browser.
 * - `browser` — always use the browser print dialog.
 */
export type PrintMethod = 'auto' | 'bridge' | 'browser';

export interface TerminalSettings {
  printer_paper_size: '58mm' | '80mm';
  beep_enabled: boolean;
  auto_print_receipt: boolean;
  till_id: string;
  /** Receipt output path. See {@link PrintMethod}. */
  print_method: PrintMethod;
  /**
   * Windows printer name to target. Empty means the bridge picks one —
   * a USB printer if it can find one, otherwise the OS default.
   */
  bridge_printer: string;
}

const STORAGE_KEY = 'samtech_terminal_settings_v1';

const DEFAULT_SETTINGS: TerminalSettings = {
  printer_paper_size: '80mm',
  beep_enabled: true,
  auto_print_receipt: true,
  till_id: 'POS-ACCRA-TILL-01',
  print_method: 'auto',
  bridge_printer: '',
};

const listeners = new Set<() => void>();

function readFromStorage(): TerminalSettings {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<TerminalSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let cache: TerminalSettings = readFromStorage();

function notify() {
  listeners.forEach((cb) => cb());
}

export function getTerminalSettings(): TerminalSettings {
  return cache;
}

export function updateTerminalSettings(patch: Partial<TerminalSettings>): TerminalSettings {
  cache = { ...cache, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota / private-mode errors — settings still apply for this session.
  }
  notify();
  return cache;
}

export function subscribeTerminalSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Keep tills in sync across browser tabs/windows (e.g. second till screen).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cache = readFromStorage();
      notify();
    }
  });
}

/** React hook: live, read-only view of the terminal settings. */
export function useTerminalSettings(): TerminalSettings {
  const [settings, setSettings] = useState<TerminalSettings>(cache);

  useEffect(() => {
    setSettings(cache);
    return subscribeTerminalSettings(() => setSettings(readFromStorage()));
  }, []);

  return settings;
}
