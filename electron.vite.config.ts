import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: {
      // react-dom's production client alone is ~537 kB; the rest of the app
      // is split below. Keep the warning threshold just above that chunk.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // The renderer is a local bundle, but one 1 MB chunk still makes
          // parsing and cache invalidation coarse. Split the framework and
          // the largest feature surfaces into stable chunks.
          manualChunks(id) {
            if (id.includes('/node_modules/react-dom/')) return 'react-dom';
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/scheduler/')) {
              return 'react';
            }
            if (id.includes('/node_modules/minisearch')) return 'search';
            if (id.includes('/src/renderer/settings/')) return 'settings';
            if (id.includes('/src/renderer/ui/')) return 'ui';
            if (id.includes('/src/renderer/shell/Knowledge')) return 'knowledge';
            if (id.includes('/src/renderer/shell/LongPlanPage')) return 'plan';
            if (id.includes('/src/renderer/shell/Review')) return 'review';
            if (id.includes('/src/renderer/shell/Practice')) return 'practice';
            return undefined;
          }
        }
      }
    }
  }
});
