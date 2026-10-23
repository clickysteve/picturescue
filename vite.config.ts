import { defineConfig } from 'vite';

export default defineConfig({
  // Relative by default (works from any folder); the Pages workflow passes --base.
  base: './',
  server: { port: 5207 },
  test: { include: ['test/**/*.test.ts'] },
} as never);
