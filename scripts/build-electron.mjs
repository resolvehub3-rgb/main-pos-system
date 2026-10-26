/**
 * Bundle the Electron main process and preload into single CommonJS files in
 * `dist-electron/`.
 *
 * - `main.cjs`   — electron/main.ts (node platform, `electron` external)
 * - `preload.cjs` — electron/preload.ts (sandbox-compatible CJS)
 *
 * `SAMTILL_UPDATE_MANIFEST_URL` is baked in at build time as a compile-time
 * constant; unset means "updates not configured" and every check reports so.
 *
 * Run via `pnpm desktop:build`.
 */
import {build} from 'esbuild';

const updateManifestUrl = process.env.SAMTILL_UPDATE_MANIFEST_URL ?? '';

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
    define: {__UPDATE_MANIFEST_URL__: JSON.stringify(updateManifestUrl)},
  }),
  build({
    ...common,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
  }),
]);
