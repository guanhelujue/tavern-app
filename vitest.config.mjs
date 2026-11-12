import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', 'scripts/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'],
    exclude: [...configDefaults.exclude, '**/output/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
