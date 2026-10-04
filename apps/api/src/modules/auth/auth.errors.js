'use strict';

/**
 * Stable API error constructors for auth module.
 * Each returns a plain Error with code + statusCode attached so
 * errorHandler can map it to the DESIGN.md envelope without string-matching.
 *
 * Rule: never put OTP codes, password hashes, or secrets in messages.
 */

function makeError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

const AuthError = {
  otpInvalid:          () => makeError('OTP_INVALID',          'The code entered is incorrect.',                           400),
  otpExpired:          () => makeError('OTP_EXPIRED',          'The code has expired. Please request a new one.',          400),
  otpAttemptsExceeded: () => makeError('OTP_ATTEMPTS_EXCEEDED','Too many incorrect attempts. Please request a new code.',  429),
  // smtpFailure maps to 503 — retryable by the client via resend-otp
  smtpFailure:         () => makeError('SERVICE_UNAVAILABLE',  'Verification email could not be delivered. Please try again shortly.', 503),
  invalidCredentials:  () => makeError('INVALID_CREDENTIALS',  'Incorrect email or password.', 401),
  emailNotVerified:    () => makeError('EMAIL_NOT_VERIFIED',   'Please verify your email address before logging in.', 403),
  unauthorized:        () => makeError('UNAUTHORIZED',         'Invalid, expired, or missing authentication token.', 401),
};

module.exports = { AuthError };
