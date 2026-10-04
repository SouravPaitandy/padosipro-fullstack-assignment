'use strict';

const { PrismaClient } = require('@prisma/client');

// Singleton: reuse the same client instance across hot-reloads in development.
// The global guard prevents multiple instances when nodemon restarts modules.
const globalRef = globalThis;

const prisma =
  globalRef.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalRef.__prisma = prisma;
}

module.exports = prisma;
