// vitest.config.mjs — ESM config file (works regardless of package "type")
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,              // gives describe/it/expect without imports
    include: ['test/**/*.test.js'],
    reporters: ['verbose'],
  },
});
