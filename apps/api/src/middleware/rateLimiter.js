'use strict';

const rateLimit = require('express-rate-limit');

/**
 * IP-based rate limiter for OTP resend requests.
 * Uses an in-memory store by default, which is sufficient for a single instance
 * but limits state sharing across multiple node instances. For multi-instance
 * deployments, a Redis-based store should be used.
 */
function createOtpResendLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res, next, options) => {
      const err = new Error('Too many OTP resend requests from this IP. Please try again later.');
      err.code = 'TOO_MANY_REQUESTS';
      err.statusCode = options.statusCode || 429;
      next(err);
    },
  });
}

module.exports = {
  createOtpResendLimiter,
};
