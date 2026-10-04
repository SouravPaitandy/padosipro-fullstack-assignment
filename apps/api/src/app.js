'use strict';

const express = require('express');

const { requestId }    = require('./middleware/requestId');
const { notFound }     = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');
const { createAuthRouter } = require('./modules/auth/auth.routes');

/**
 * Creates and returns the Express application.
 *
 * @param {object} [deps]  optional injected dependencies for testing
 * @param {import('@prisma/client').PrismaClient} [deps.prisma]
 * @param {{ sendOtp: Function }} [deps.mailer]
 * @param {string} [deps.otpSecret]
 * @param {string} [deps.jwtSecret]
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.otpGen]
 */
function createApp(deps = {}) {
  const app = express();

  // ── Global middleware ───────────────────────────────────────────────────────
  if (deps.trustProxy !== undefined) {
    app.set('trust proxy', deps.trustProxy);
  } else {
    app.set('trust proxy', false);
  }
  app.use(requestId); // attaches req.id and X-Request-Id header FIRST
  app.use(express.json());

  // ── Routes ──────────────────────────────────────────────────────────────────

  // Health check — no auth, no DB; used by load-balancers and tests.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Auth routes — deps injected for testability
  if (deps.prisma) {
    app.use('/api/v1/auth', createAuthRouter(deps));
  }

  // /api/v1/*
  if (deps.prisma) {
    const { createProfileRouter } = require('./modules/profile/profile.routes');
    const { createTasksRouter, createMeTasksRouter } = require('./modules/tasks/tasks.routes');
    
    app.use('/api/v1/profile', createProfileRouter(deps));
    app.use('/api/v1/tasks', createTasksRouter(deps));
    app.use('/api/v1/me/tasks', createMeTasksRouter(deps));
  }

  // ── Fallthrough handlers (must be last) ─────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

// Default export: app with no deps (for /health tests and legacy imports)
module.exports = createApp();
module.exports.createApp = createApp;
