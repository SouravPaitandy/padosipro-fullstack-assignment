'use strict';

const { z } = require('zod');

// ── Shared ────────────────────────────────────────────────────────────────────

/**
 * Email normalization — trim and lowercase are applied before the email
 * format check so leading/trailing whitespace and mixed-case inputs
 * are normalized at the validation boundary. The service never receives
 * a non-normalized value.
 */
const normalizedEmail = z
  .string({ required_error: 'Email is required.' })
  .trim()        // remove surrounding whitespace before format check
  .toLowerCase() // fold to lowercase before format check
  .email('Enter a valid email address.');

// ── Register ──────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: normalizedEmail,
  password: z
    .string({ required_error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.')
    /**
     * bcrypt truncates input at 72 UTF-8 bytes, not 72 JavaScript characters.
     * A password like 'à'.repeat(36) is 36 chars but 72 bytes, while
     * 'à'.repeat(37) is 37 chars but 74 bytes — bcrypt would silently treat
     * both as equivalent after truncation, which is a security weakness.
     *
     * We measure UTF-8 bytes explicitly so multi-byte Unicode passwords
     * receive the same protection as ASCII passwords of the same length.
     */
    .refine(
      (v) => Buffer.byteLength(v, 'utf8') <= 72,
      'Password must be at most 72 UTF-8 bytes.',
    ),
});

// ── Verify OTP ────────────────────────────────────────────────────────────────

const verifyOtpSchema = z.object({
  email: normalizedEmail,
  code: z
    .string({ required_error: 'Code is required.' })
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits.'),
});

// ── Resend OTP ────────────────────────────────────────────────────────────────

const resendOtpSchema = z.object({
  email: normalizedEmail,
});

const loginSchema = z.object({
  email: normalizedEmail,
  // Apply the same 72 UTF-8 byte limit as registration. Passwords longer
  // than 72 bytes cannot match any stored hash (bcrypt truncates at 72)
  // so we can reject early without calling bcrypt at all.
  password: z
    .string({ required_error: 'Password is required.' })
    .min(1, 'Password is required.')
    .refine(
      (v) => Buffer.byteLength(v, 'utf8') <= 72,
      'Password must be at most 72 UTF-8 bytes.',
    ),
});

module.exports = { registerSchema, verifyOtpSchema, resendOtpSchema, loginSchema };
