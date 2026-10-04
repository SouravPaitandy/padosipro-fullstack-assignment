'use strict';

/**
 * OTP helpers — cryptographic source only; no DB or SMTP here.
 *
 * Security guarantees:
 * - generateOtp() uses crypto.randomInt (CSPRNG) so each digit is
 *   independently uniform; codes are zero-padded to exactly 6 digits.
 * - computeDigest() is HMAC-SHA-256 keyed with OTP_HMAC_SECRET so
 *   a database-only attacker cannot enumerate codes offline.
 * - Raw codes exist only inside this module's call stack and in the
 *   email message; they are never written to the database or logs.
 */

const { createHmac, randomInt } = require('crypto');

const CODE_LENGTH = 6;

/**
 * Returns a zero-padded 6-digit code string.
 * Uses crypto.randomInt which is uniformly distributed and
 * cryptographically secure.
 *
 * @param {() => string} [_generator] - injected for tests only
 */
function generateOtp(_generator) {
  if (_generator) return _generator();
  // Upper bound is exclusive: randomInt(0, 1_000_000) → [0, 999999]
  const n = randomInt(0, 10 ** CODE_LENGTH);
  return String(n).padStart(CODE_LENGTH, '0');
}

/**
 * Returns the HMAC-SHA-256 hex digest of the code.
 * The digest is what gets stored; the raw code is discarded.
 *
 * @param {string} code   raw OTP string
 * @param {string} secret OTP_HMAC_SECRET
 */
function computeDigest(code, secret) {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/**
 * Constant-time comparison of a submitted code against a stored digest.
 * Uses timingSafeEqual via Buffer to prevent timing attacks.
 *
 * @param {string} submittedCode plain code from request body
 * @param {string} storedDigest  hex digest from OtpChallenge row
 * @param {string} secret        OTP_HMAC_SECRET
 */
function verifyCode(submittedCode, storedDigest, secret) {
  const expected = computeDigest(submittedCode, secret);
  // Both are fixed-length hex strings (64 chars) — safe to compare byte-by-byte
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(storedDigest, 'hex');
  if (a.length !== b.length) return false;
  const { timingSafeEqual } = require('crypto');
  return timingSafeEqual(a, b);
}

module.exports = { generateOtp, computeDigest, verifyCode };
