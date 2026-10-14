import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone Vite config — this app is intentionally not wired into the
// tsc-based `pnpm -r build` pipeline used by the other packages/apps; run it
// via `pnpm --filter @rpg-assistant/gm-dashboard dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
