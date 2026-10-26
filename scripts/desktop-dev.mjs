/**
 * Run the Electron app against the Vite dev server (`pnpm dev` on port 3000).
 *
 * Development convenience only: the packaged production app NEVER uses a dev
 * server — it always serves the built `dist/` through the loopback server
 * (see electron/staticServer.ts).
 *
 * Run via `pnpm desktop:dev` (starts Vite if it isn't already running).
 */
import {spawn} from 'node:child_process';
import electronPath from 'electron';

const DEV_URL = 'http://localhost:3000';

function fetchOk(url) {
  return fetch(url, {signal: AbortSignal.timeout(1500)})
    .then((r) => r.ok || r.status === 404)
    .catch(() => false);
}

async function waitForVite(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchOk(`${DEV_URL}/`)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let vite = null;
let viteAlreadyRunning = false;

if (await fetchOk(`${DEV_URL}/`)) {
  viteAlreadyRunning = true;
  console.log(`[desktop:dev] Reusing the Vite dev server already on ${DEV_URL}`);
} else {
  console.log('[desktop:dev] Starting the Vite dev server…');
  vite = spawn('pnpm', ['dev'], {shell: true, stdio: 'inherit', env: process.env});
}

const ready = await waitForVite();
if (!ready) {
  console.error('[desktop:dev] Vite did not become reachable in time.');
  if (vite) vite.kill();
  process.exit(1);
}

const app = spawn(String(electronPath), ['.'], {
  stdio: 'inherit',
  env: {...process.env, SAMTILL_DEV_URL: DEV_URL},
});

const shutdown = (code) => {
  if (vite && !viteAlreadyRunning) vite.kill();
  process.exit(code ?? 0);
};

app.on('exit', (code) => shutdown(code));
process.on('SIGINT', () => {
  app.kill();
  shutdown(0);
});
