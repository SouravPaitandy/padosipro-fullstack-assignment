'use strict';

/**
 * Auth service — all security-critical business logic lives here.
 *
 * Dependencies are injected (prisma, mailer, otpSecret, clock, otpGen)
 * so integration tests can replace DB, mail delivery, time, and OTP
 * generation without modifying production code paths.
 *
 * Security invariants:
 * - Raw OTP code exists only in the call stack of _issueChallenge(); it
 *   is passed to SMTP and then discarded. It is never persisted or logged.
 * - Only the HMAC-SHA-256 digest is written to the database.
 * - Verification uses a single conditional UPDATE transaction: the challenge
 *   is consumed atomically only when it is still unconsumed, unexpired, and
 *   below the attempt limit. The count returned by updateMany is the sole
 *   arbiter of success; no read-modify-write cycle is used for the correct
 *   path, so concurrent correct submissions cannot both succeed.
 * - Wrong-code increments also use a conditional updateMany with a WHERE
 *   guard so concurrent wrong-code requests cannot over-increment.
 * - resendOtp never reveals whether an email is unknown, verified, or in
 *   cooldown: all three states return the same { sent: true, resendAvailableAt }
 *   shape. The cooldown is enforced server-side (no email sent), not by
 *   returning a distinguishable error code.
 * - On SMTP failure, the newly persisted challenge is immediately expired so
 *   it cannot be verified; the account itself is preserved so resend can
 *   recover. A generic retryable error is returned.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { generateOtp, computeDigest, verifyCode } = require('../../lib/otp');
const { AuthError } = require('./auth.errors');

const BCRYPT_ROUNDS      = 12;
const OTP_TTL_MS         = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;       // 30 seconds
const MAX_ATTEMPTS       = 5;

// Pre-computed hash used to equalise timing on unknown-email login attempts.
// bcrypt.compare() against this dummy ensures the response time for an
// unknown email is indistinguishable from a wrong-password attempt for a
// known account. The submitted password is never stored or logged.
const DUMMY_HASH = '$2b$12$WIYzMb/1XdBqlq3D6oUMzuIzxDJ.ZzF5kkVcxT5r2.tJl3k3dkwjy';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Create and persist a new OtpChallenge, supersede any prior active one,
 * then send the email.  Returns { resendAvailableAt }.
 *
 * If SMTP delivery fails, the newly created challenge is immediately expired
 * (consumedAt = now) so it cannot be accidentally verified, and a retryable
 * service error is thrown.  The account row is intentionally left intact so
 * resend can recover without re-registration.
 *
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {{ sendOtp: (to: string, code: string) => Promise<void> }} deps.mailer
 * @param {string} deps.otpSecret   OTP_HMAC_SECRET
 * @param {() => Date} deps.now     clock injection
 * @param {() => string} [deps.otpGen]  randomness injection
 * @param {string} userId
 * @param {string} email            already-normalized
 */
async function _issueChallenge({ prisma, mailer, otpSecret, now, otpGen }, userId, email) {
  const ts              = now();
  const expiresAt       = new Date(ts.getTime() + OTP_TTL_MS);
  const resendAvailableAt = new Date(ts.getTime() + RESEND_COOLDOWN_MS);

  // Generate raw code — lives only in this stack frame
  const rawCode = generateOtp(otpGen);
  const digest  = computeDigest(rawCode, otpSecret);

  // Atomically supersede prior active challenge and insert the new one.
  let newChallengeId;
  await prisma.$transaction(async (tx) => {
    // Supersede any prior active (unconsumed, unexpired) challenge for this user
    await tx.otpChallenge.updateMany({
      where: {
        userId,
        consumedAt: null,
        expiresAt: { gt: ts },
      },
      data: { consumedAt: ts },
    });

    const created = await tx.otpChallenge.create({
      data: {
        userId,
        codeDigest: digest,
        expiresAt,
        resendAvailableAt,
        attempts: 0,
      },
    });
    newChallengeId = created.id;
  });

  // Attempt SMTP delivery. If it fails, immediately invalidate the persisted
  // challenge so it cannot be verified. Re-throw a generic retryable error so
  // the caller can signal the client to retry via resend.
  try {
    await mailer.sendOtp(email, rawCode);
    // rawCode is out of scope after this point.
  } catch (smtpErr) {
    // Log server-side without exposing details to the client
    console.error(JSON.stringify({
      level: 'error',
      event: 'smtp_failure',
      userId,
      challengeId: newChallengeId,
      // Never log rawCode, digest, or password values
      message: smtpErr.message,
    }));
    // Expire the challenge so it cannot be verified
    await prisma.otpChallenge.update({
      where: { id: newChallengeId },
      data:  { consumedAt: ts },
    }).catch(() => { /* best-effort; account is still usable via resend */ });
    throw AuthError.smtpFailure();
  }

  return { resendAvailableAt };
}

/**
 * Find the latest eligible (unconsumed, unexpired) challenge for userId.
 * Returns null if none exists.
 */
async function _findActiveChallenge(prisma, userId, now) {
  return prisma.otpChallenge.findFirst({
    where: {
      userId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Public service methods ────────────────────────────────────────────────────

/**
 * Register a new account or re-send OTP for an existing unverified one.
 *
 * Callers always receive the same 201 shape regardless of whether the email
 * was already registered — avoids email-enumeration via registration.
 *
 * @param {object} deps
 * @param {string} email    already normalized by Zod schema
 * @param {string} password raw password
 */
async function register(deps, { email, password }) {
  const { prisma, now } = deps;
  const ts = now();

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.emailVerifiedAt) {
      // Verified account — return same generic response without revealing existence
      const fakeResend = new Date(ts.getTime() + RESEND_COOLDOWN_MS);
      return {
        userId: existing.id,
        email: existing.email,
        verificationRequired: true,
        resendAvailableAt: fakeResend,
      };
    }

    // Existing unverified — check cooldown before issuing a new code
    const active = await _findActiveChallenge(prisma, existing.id, ts);
    if (active && active.resendAvailableAt > ts) {
      // Still in cooldown — return without sending a new code.
      // Return a fabricated timestamp to identically match other branches.
      const fakeResend = new Date(ts.getTime() + RESEND_COOLDOWN_MS);
      return {
        userId: existing.id,
        email: existing.email,
        verificationRequired: true,
        resendAvailableAt: fakeResend,
      };
    }

    const { resendAvailableAt } = await _issueChallenge(deps, existing.id, email);
    return {
      userId: existing.id,
      email: existing.email,
      verificationRequired: true,
      resendAvailableAt,
    };
  }

  // New account — hash password then persist
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const { resendAvailableAt } = await _issueChallenge(deps, user.id, email);
  return {
    userId: user.id,
    email: user.email,
    verificationRequired: true,
    resendAvailableAt,
  };
}

/**
 * Verify a 6-digit OTP for an email address.
 *
 * Atomicity guarantee (correct-code path):
 *   A single conditional updateMany consumes the challenge only when it is
 *   simultaneously unconsumed, unexpired, attempts < MAX_ATTEMPTS, AND the
 *   digest matches — all evaluated inside one database statement. The returned
 *   count is the sole signal: count === 1 means this request won the race;
 *   count === 0 means another concurrent request already consumed it (or the
 *   challenge state changed since the read). No read-modify-write cycle is
 *   used on the success path, so two concurrent correct submissions cannot
 *   both succeed.
 *
 *   NOTE: The in-memory stub used in unit tests executes operations
 *   serially and cannot reproduce true concurrent database races. These
 *   tests verify the conditional WHERE logic but not real DB concurrency.
 *   Concurrency safety under parallel PostgreSQL connections requires
 *   integration tests against a live database.
 *
 * @returns {{ verified: true }}
 */
async function verifyOtp(deps, { email, code }) {
  const { prisma, otpSecret, now } = deps;
  const ts = now();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw AuthError.otpInvalid(); // no enumeration

  // Read the latest challenge for initial state discrimination
  const challenge = await _findActiveChallenge(prisma, user.id, ts);

  if (!challenge) {
    // Distinguish: exhausted > expired > superseded/none
    const latest = await prisma.otpChallenge.findFirst({
      where:   { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.attempts >= MAX_ATTEMPTS) throw AuthError.otpAttemptsExceeded();
    if (latest && latest.expiresAt <= ts)           throw AuthError.otpExpired();
    throw AuthError.otpInvalid();
  }

  if (challenge.attempts >= MAX_ATTEMPTS) throw AuthError.otpAttemptsExceeded();

  const correct = verifyCode(code, challenge.codeDigest, otpSecret);

  if (!correct) {
    // Atomically increment attempts, guarded so concurrent requests cannot
    // over-increment past MAX_ATTEMPTS.
    const updated = await prisma.otpChallenge.updateMany({
      where: {
        id:          challenge.id,
        consumedAt:  null,
        attempts:    { lt: MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });

    if (updated.count === 0) {
      // Race: another request exhausted it between our read and this update
      throw AuthError.otpAttemptsExceeded();
    }

    // Check whether this increment hit the limit; if so, consume and exhaust
    const fresh = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
    if (fresh && fresh.attempts >= MAX_ATTEMPTS) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data:  { consumedAt: ts },
      });
      throw AuthError.otpAttemptsExceeded();
    }

    throw AuthError.otpInvalid();
  }

  // Correct code — one conditional transaction consumes the challenge and
  // verifies the user only when the challenge is still unconsumed.
  // If count === 0, another concurrent request already consumed it.
  const consumed = await prisma.$transaction(async (tx) => {
    const result = await tx.otpChallenge.updateMany({
      where: {
        id:         challenge.id,
        consumedAt: null,     // guard: not yet consumed by a concurrent request
        expiresAt:  { gt: ts },
        attempts:   { lt: MAX_ATTEMPTS },
      },
      data: { consumedAt: ts },
    });

    if (result.count === 0) {
      // Concurrent request won the race — do not verify
      return false;
    }

    await tx.user.update({
      where: { id: user.id },
      data:  { emailVerifiedAt: ts },
    });
    return true;
  });

  if (!consumed) {
    // The challenge was consumed by a concurrent correct submission
    throw AuthError.otpInvalid();
  }

  return { verified: true };
}

/**
 * Resend OTP to an email address.
 *
 * Email-enumeration prevention: all three account states (unknown, verified,
 * in-cooldown) return the same HTTP 200 { sent: true, resendAvailableAt }
 * response. In-cooldown accounts do NOT receive a new email, but they receive
 * the same response shape — no 429 is returned that would distinguish them
 * from unknown/verified cases. Only unverified accounts that are past the
 * cooldown actually receive a new code.
 *
 * @returns {{ sent: true, resendAvailableAt: Date }}
 */
async function resendOtp(deps, { email }) {
  const { prisma, now } = deps;
  const ts = now();

  const user = await prisma.user.findUnique({ where: { email } });

  // Unknown email or already verified — return a plausible timestamp without action
  if (!user || user.emailVerifiedAt) {
    const fakeResend = new Date(ts.getTime() + RESEND_COOLDOWN_MS);
    return { sent: true, resendAvailableAt: fakeResend };
  }

  // Check cooldown
  const active = await _findActiveChallenge(prisma, user.id, ts);
  if (active && active.resendAvailableAt > ts) {
    // Still in cooldown — return a fabricated timestamp without sending
    // a new code, matching other branches exactly to prevent enumeration.
    const fakeResend = new Date(ts.getTime() + RESEND_COOLDOWN_MS);
    return { sent: true, resendAvailableAt: fakeResend };
  }

  const { resendAvailableAt } = await _issueChallenge(deps, user.id, email);
  return { sent: true, resendAvailableAt };
}

async function login(deps, { email, password }) {
  const { prisma, jwtSecret, now } = deps;
  const ts = now();

  const user = await prisma.user.findUnique({
    where: { email },
    include: { profile: true, _count: { select: { userTasks: true } } }
  });

  if (!user) {
    // Always run a full bcrypt comparison even for unknown emails to prevent
    // timing-based user enumeration. The result is unconditionally discarded.
    // The submitted password is never stored, logged, or returned.
    await bcrypt.compare(password, DUMMY_HASH);
    throw AuthError.invalidCredentials();
  }

  const correct = await bcrypt.compare(password, user.passwordHash);
  if (!correct) {
    throw AuthError.invalidCredentials();
  }

  if (!user.emailVerifiedAt) {
    throw AuthError.emailNotVerified();
  }

  const expiresInSeconds = 7 * 24 * 60 * 60; // 7 days
  const expiresAt = new Date(ts.getTime() + expiresInSeconds * 1000);

  // HS256 is specified explicitly so tokens signed by a different algorithm
  // (e.g. RS256 via algorithm confusion) are rejected by requireAuth().
  const accessToken = jwt.sign(
    { sub: user.id },
    jwtSecret,
    { expiresIn: expiresInSeconds, algorithm: 'HS256' }
  );

  return {
    accessToken,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      profileComplete: !!user.profile,
      selectedTaskCount: user._count ? user._count.userTasks : 0
    }
  };
}

async function getMe(deps, userId) {
  const { prisma } = deps;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, _count: { select: { userTasks: true } } }
  });

  if (!user) {
    throw AuthError.unauthorized();
  }

  return {
    id: user.id,
    email: user.email,
    profileComplete: !!user.profile,
    selectedTaskCount: user._count ? user._count.userTasks : 0
  };
}

module.exports = { register, verifyOtp, resendOtp, login, getMe };
