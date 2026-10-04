'use strict';

/**
 * Auth router — thin Express layer.
 *
 * All business logic lives in auth.service.js.
 * This file only:
 *   1. Validates request bodies with validate() middleware
 *   2. Calls the service with injected deps from res.locals (set by routerFactory)
 *   3. Maps service results to HTTP responses
 *
 * The routerFactory pattern allows tests to inject a stub mailer and
 * a fake clock without touching production service code.
 */

const { Router } = require('express');
const { validate }    = require('../../middleware/validate');
const { success }     = require('../../lib/response');
const { requireAuth } = require('../../middleware/require-auth');
const { registerSchema, verifyOtpSchema, resendOtpSchema, loginSchema } = require('./auth.schema');
const { register, verifyOtp, resendOtp, login, getMe } = require('./auth.service');
const { createOtpResendLimiter } = require('../../middleware/rateLimiter');

/**
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {{ sendOtp: Function }} deps.mailer
 * @param {string} deps.otpSecret
 * @param {string} deps.jwtSecret
 * @param {() => Date} [deps.now]    defaults to () => new Date()
 * @param {() => string} [deps.otpGen]  defaults to crypto.randomInt-based gen
 */
function createAuthRouter(deps) {
  const router = Router();
  const otpResendLimiter = createOtpResendLimiter();
  const resolvedDeps = {
    now:    () => new Date(),
    otpGen: undefined,
    ...deps,
  };

  // POST /api/v1/auth/register
  router.post(
    '/register',
    validate({ body: registerSchema }),
    async (req, res, next) => {
      try {
        const result = await register(resolvedDeps, req.body);
        return success(res, result, 201);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/auth/verify-otp
  router.post(
    '/verify-otp',
    validate({ body: verifyOtpSchema }),
    async (req, res, next) => {
      try {
        const result = await verifyOtp(resolvedDeps, req.body);
        return success(res, result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/auth/resend-otp
  router.post(
    '/resend-otp',
    otpResendLimiter,
    validate({ body: resendOtpSchema }),
    async (req, res, next) => {
      try {
        const result = await resendOtp(resolvedDeps, req.body);
        return success(res, result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/auth/login
  router.post(
    '/login',
    validate({ body: loginSchema }),
    async (req, res, next) => {
      try {
        const result = await login(resolvedDeps, req.body);
        return success(res, result);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /api/v1/auth/me
  router.get(
    '/me',
    requireAuth(resolvedDeps.jwtSecret),
    async (req, res, next) => {
      try {
        const result = await getMe(resolvedDeps, req.user.sub);
        return success(res, result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/auth/logout
  router.post(
    '/logout',
    requireAuth(resolvedDeps.jwtSecret),
    (req, res) => {
      // Sessions are stateless in v1. The client must delete its stored token.
      return success(res, { loggedOut: true });
    },
  );

  return router;
}

module.exports = { createAuthRouter };
