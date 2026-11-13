import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the build runs from a domain root or from a sub-path
  // (for example GitHub Pages at /izzad.ai/) without changes.
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      // Two pages: the front page (the funnel) and the designer's workspace.
      input: { index: 'index.html', workspace: 'workspace.html' },
    },
  },
});
