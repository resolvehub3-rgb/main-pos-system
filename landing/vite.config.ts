import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// The landing site is fully self-contained. It builds to landing/dist and never
// touches the POS application build output (dist/ at the repository root).
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      // Port 5174 keeps the marketing site clear of the POS dev server (3000).
      port: 5174,
    },
  };
});
