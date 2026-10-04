"use strict";

const jwt = require("jsonwebtoken");
const { AuthError } = require("../modules/auth/auth.errors");

/**
 * Middleware factory for JWT verification.
 * We inject jwtSecret to keep it testable.
 *
 * Security notes:
 * - algorithms is restricted to HS256 to prevent algorithm-confusion attacks
 *   (e.g. RS256 public-key-as-secret, "none" algorithm bypass).
 * - sub must be a UUID string (after signature verification); tokens with missing
 *   or malformed sub are rejected as UNAUTHORIZED.
 *
 * @param {string} jwtSecret
 */
function requireAuth(jwtSecret) {
  return function requireAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(AuthError.unauthorized());
    }

    const token = authHeader.substring(7);
    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
      // Guard: sub must be UUID.
      const UUID_REGEX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof payload.sub !== "string" || !UUID_REGEX.test(payload.sub)) {
        return next(AuthError.unauthorized());
      }
      req.user = payload; // Attach payload { sub: 'uuid', iat, exp } to req
      next();
    } catch (err) {
      // Catches TokenExpiredError, JsonWebTokenError (invalid signature/malformed), etc.
      next(AuthError.unauthorized());
    }
  };
}

module.exports = { requireAuth };
