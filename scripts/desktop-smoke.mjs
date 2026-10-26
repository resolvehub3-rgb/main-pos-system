/**
 * QA smoke runner: starts the desktop app with SAMTILL_SMOKE=1 and forwards
 * the app's exit code (0 = all smoke checks passed).
 *
 * Requires a Windows session with a desktop (it opens real windows).
 * Run via `pnpm desktop:smoke` after `pnpm build && pnpm desktop:build`.
 */
import {spawn} from 'node:child_process';
import electronPath from 'electron';

const child = spawn(String(electronPath), ['.'], {
  stdio: 'inherit',
  env: {...process.env, SAMTILL_SMOKE: '1'},
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[desktop:smoke] terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
