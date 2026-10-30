import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
      // The POS entry imports the marketing site (../landing/src/App.tsx),
      // and landing/ carries its own pnpm-installed React. Without this the
      // production bundle contains TWO physical React copies — landing
      // components hook into one instance while react-dom renders with the
      // other, which crashes with "Invalid hook call" and a blank page.
      // (Dev hides the bug because Vite prebundles all bare imports into one
      // optimized copy; only the Rollup build resolves them separately.)
      // Forcing both package names to resolve from the project root makes
      // the build deterministic whether or not landing/node_modules exists.
      dedupe: ['react', 'react-dom'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
