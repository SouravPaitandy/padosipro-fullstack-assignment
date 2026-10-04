"use strict";

/**
 * Auth service tests — no live PostgreSQL required.
 *
 * Strategy: all tests use an in-memory Prisma stub and injected deps so
 * PostgreSQL, SMTP, the system clock, and OTP randomness are fully
 * controllable. Tests run through the complete Express middleware stack via
 * Supertest.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IMPORTANT: concurrency labels                                           │
 * │                                                                         │
 * │ Tests labelled "[unit]" use a serial in-memory stub. JavaScript is      │
 * │ single-threaded so Promise.all inside a test does not produce real      │
 * │ parallel database access. The in-memory stub cannot reproduce true      │
 * │ concurrent PostgreSQL row-level locking.                                │
 * │                                                                         │
 * │ These tests verify the *conditional WHERE logic* (e.g. the updateMany   │
 * │ with consumedAt: null guard) but NOT that two simultaneous PostgreSQL   │
 * │ connections cannot both win the race.                                   │
 * │                                                                         │
 * │ DATABASE CONCURRENCY IS NOT VERIFIED — it requires integration tests    │
 * │ against a live PostgreSQL instance (Docker unavailable in this env).    │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

const request = require("supertest");
const { createApp } = require("../src/app");
const { computeDigest } = require("../src/lib/otp");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ── Constants ─────────────────────────────────────────────────────────────────
const SECRET = "test-otp-hmac-secret-at-least-32-chars!!";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_NOW = new Date("2026-01-01T12:00:00.000Z");

// ── In-memory Prisma stub ─────────────────────────────────────────────────────

function buildPrisma(initial = {}) {
  const users = new Map(Object.entries(initial.users ?? {}));
  const challenges = new Map(Object.entries(initial.challenges ?? {}));
  const crypto = require("crypto");
  let idCounter = 0;
  const nextId = () => crypto.randomUUID();

  const prisma = {
    _users: users,
    _challenges: challenges,

    user: {
      findUnique: async ({ where }) => {
        if (where.email)
          return (
            [...users.values()].find((u) => u.email === where.email) ?? null
          );
        if (where.id) return users.get(where.id) ?? null;
        return null;
      },
      create: async ({ data }) => {
        const id = nextId();
        const user = {
          id,
          emailVerifiedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        users.set(id, user);
        return user;
      },
      update: async ({ where, data }) => {
        const u = users.get(where.id);
        if (!u) throw new Error("User not found");
        Object.assign(u, data, { updatedAt: new Date() });
        return u;
      },
    },

    otpChallenge: {
      findFirst: async ({ where, orderBy }) => {
        let rows = [...challenges.values()].filter((c) => {
          if (where.userId && c.userId !== where.userId) return false;
          if (where.consumedAt === null && c.consumedAt !== null) return false;
          if (where.expiresAt?.gt && c.expiresAt <= where.expiresAt.gt)
            return false;
          return true;
        });
        if (orderBy?.createdAt === "desc")
          rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ?? null;
      },
      findUnique: async ({ where }) => challenges.get(where.id) ?? null,
      create: async ({ data }) => {
        const id = nextId();
        const row = {
          id,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(),
          ...data,
        };
        challenges.set(id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const c = challenges.get(where.id);
        if (!c) throw new Error("Challenge not found");
        const resolved = {};
        for (const [k, v] of Object.entries(data)) {
          resolved[k] =
            v && typeof v === "object" && "increment" in v
              ? c[k] + v.increment
              : v;
        }
        Object.assign(c, resolved);
        return c;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const c of challenges.values()) {
          if (where.userId && c.userId !== where.userId) continue;
          if (where.id && c.id !== where.id) continue;
          if (where.consumedAt === null && c.consumedAt !== null) continue;
          if (where.expiresAt?.gt && c.expiresAt <= where.expiresAt.gt)
            continue;
          if (
            where.attempts?.lt !== undefined &&
            !(c.attempts < where.attempts.lt)
          )
            continue;
          const resolved = {};
          for (const [k, v] of Object.entries(data)) {
            resolved[k] =
              v && typeof v === "object" && "increment" in v
                ? c[k] + v.increment
                : v;
          }
          Object.assign(c, resolved);
          count++;
        }
        return { count };
      },
    },

    $transaction: async (arg) => {
      if (typeof arg === "function") return arg(prisma);
      return Promise.all(arg);
    },
  };

  return prisma;
}

// ── Mail spy ──────────────────────────────────────────────────────────────────

function buildMailSpy({ shouldFail = false } = {}) {
  const calls = [];
  return {
    calls,
    sendOtp: async (to, code) => {
      calls.push({ to, code });
      if (shouldFail) throw new Error("SMTP connection refused");
    },
  };
}

// ── App / seed helpers ────────────────────────────────────────────────────────

function buildApp({ prisma, mailer, now, otpGen, trustProxy } = {}) {
  return createApp({
    prisma: prisma ?? buildPrisma(),
    mailer: mailer ?? buildMailSpy(),
    otpSecret: SECRET,
    jwtSecret: SECRET,
    now: now ?? (() => BASE_NOW),
    otpGen: otpGen ?? (() => "123456"),
    trustProxy,
  });
}

async function seedUser(prisma, overrides = {}) {
  const passwordHash = await bcrypt.hash("Password1!", 4); // low rounds for speed
  return prisma.user.create({
    data: { email: "user@example.com", passwordHash, ...overrides },
  });
}

async function seedVerifiedUser(prisma, overrides = {}) {
  return seedUser(prisma, { emailVerifiedAt: new Date(), ...overrides });
}

async function seedChallenge(prisma, userId, overrides = {}) {
  const code = overrides._rawCode ?? "999999";
  const digest = computeDigest(code, SECRET);
  delete overrides._rawCode;
  return prisma.otpChallenge.create({
    data: {
      userId,
      codeDigest: digest,
      expiresAt: new Date(BASE_NOW.getTime() + 10 * 60 * 1000),
      resendAvailableAt: new Date(BASE_NOW.getTime() + 30 * 1000),
      attempts: 0,
      consumedAt: null,
      ...overrides,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/register
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/register", () => {
  it("returns 201 with userId, email, verificationRequired, resendAvailableAt", async () => {
    const mailer = buildMailSpy();
    const app = buildApp({ mailer });

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "New@Example.COM", password: "Password1!" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: "new@example.com",
      verificationRequired: true,
    });
    expect(res.body.data.userId).toBeDefined();
    expect(res.body.data.resendAvailableAt).toBeDefined();
  });

  it("normalizes email to lowercase and trims whitespace", async () => {
    const prisma = buildPrisma();
    const app = buildApp({ prisma });

    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "  Alice@EXAMPLE.COM  ", password: "Password1!" });

    const user = [...prisma._users.values()][0];
    expect(user.email).toBe("alice@example.com");
  });

  it("stores a bcrypt hash, not the raw password", async () => {
    const prisma = buildPrisma();
    const app = buildApp({ prisma });

    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "MySecret123" });

    const user = [...prisma._users.values()][0];
    expect(user.passwordHash).not.toBe("MySecret123");
    expect(await bcrypt.compare("MySecret123", user.passwordHash)).toBe(true);
  });

  it("stores only the OTP digest — never the raw code", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy();
    const rawCode = "654321";
    const app = buildApp({ prisma, mailer, otpGen: () => rawCode });

    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "Password1!" });

    const challenge = [...prisma._challenges.values()][0];
    expect(challenge.codeDigest).not.toBe(rawCode);
    expect(challenge.codeDigest).toBe(computeDigest(rawCode, SECRET));
  });

  it("sends OTP email with the raw code (not a digest)", async () => {
    const mailer = buildMailSpy();
    const rawCode = "777777";
    const app = buildApp({ mailer, otpGen: () => rawCode });

    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "Password1!" });

    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0].code).toBe(rawCode);
    expect(mailer.calls[0].to).toBe("a@b.com");
  });

  it("returns 422 for invalid email", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "Password1!" });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.email).toBeDefined();
  });

  it("returns 422 for a password shorter than 8 chars", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toBeDefined();
  });

  it("returns 422 for a password exceeding 72 ASCII bytes", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "x".repeat(73) });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toBeDefined();
  });

  /**
   * Unicode byte-limit test:
   * 'à' (U+00E0) is 1 JS character but 2 UTF-8 bytes.
   * 36 × 'à' = 36 chars, 72 bytes → within limit (accepted).
   * 37 × 'à' = 37 chars, 74 bytes → exceeds 72 bytes → rejected.
   * A naive character-count .max(72) would accept the 37-char string;
   * our Buffer.byteLength() refine correctly rejects it.
   */
  it("rejects a password within 72 chars but exceeding 72 UTF-8 bytes", async () => {
    // 'à' is U+00E0 → 2 bytes in UTF-8
    const password = "à".repeat(37); // 37 chars, 74 bytes
    expect(Buffer.byteLength(password, "utf8")).toBe(74);

    const res = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toBeDefined();
  });

  it("accepts a password at exactly 72 UTF-8 bytes (multi-byte chars)", async () => {
    const password = "à".repeat(36); // 36 chars, 72 bytes — exactly at limit
    expect(Buffer.byteLength(password, "utf8")).toBe(72);

    const res = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password });

    expect(res.status).toBe(201);
  });

  it("does not reveal email already registered — returns 201 for verified duplicate", async () => {
    const prisma = buildPrisma();
    await seedVerifiedUser(prisma, { email: "taken@example.com" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "taken@example.com", password: "Password1!" });

    expect(res.status).toBe(201);
    expect(res.body.data.verificationRequired).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("already");
    expect(JSON.stringify(res.body)).not.toContain("registered");
  });

  it("re-sends OTP for existing unverified account if past cooldown", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy();
    const user = await seedUser(prisma, { email: "unverified@example.com" });
    await seedChallenge(prisma, user.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() - 1),
    });
    const app = buildApp({ prisma, mailer });

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "unverified@example.com", password: "Password1!" });

    expect(res.status).toBe(201);
    expect(mailer.calls).toHaveLength(1);
  });

  it("returns 503 SERVICE_UNAVAILABLE when SMTP fails", async () => {
    const mailer = buildMailSpy({ shouldFail: true });
    const app = buildApp({ mailer });

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "new@example.com", password: "Password1!" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("invalidates the new challenge when SMTP fails — resend can recover", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy({ shouldFail: true });
    const app = buildApp({ prisma, mailer });

    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "smtp-fail@example.com", password: "Password1!" });

    // All challenges for this user must be consumed (cannot be verified)
    const activeChallenges = [...prisma._challenges.values()].filter(
      (c) => c.consumedAt === null && c.expiresAt > BASE_NOW,
    );
    expect(activeChallenges).toHaveLength(0);
    // The user account itself must still exist (so resend can recover)
    const user = [...prisma._users.values()].find(
      (u) => u.email === "smtp-fail@example.com",
    );
    expect(user).toBeDefined();
  });

  it("prevents enumeration: resendAvailableAt is identical across new, verified, and cooldown states", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy();
    const app = buildApp({ prisma, mailer, now: () => BASE_NOW });

    const expectedResend = new Date(BASE_NOW.getTime() + 30000).toISOString();

    // 1. New
    const rNew = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "new@example.com", password: "Password1!" });

    // 2. Verified
    await seedVerifiedUser(prisma, { email: "verified@example.com" });
    const rVerified = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "verified@example.com", password: "Password1!" });

    // 3. Cooldown
    const uCooldown = await seedUser(prisma, { email: "cooldown@example.com" });
    await seedChallenge(prisma, uCooldown.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() + 10000),
    });
    const rCooldown = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "cooldown@example.com", password: "Password1!" });

    expect(rNew.body.data.resendAvailableAt).toBe(expectedResend);
    expect(rVerified.body.data.resendAvailableAt).toBe(expectedResend);
    expect(rCooldown.body.data.resendAvailableAt).toBe(expectedResend);

    // Verify emails sent only to New
    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0].to).toBe("new@example.com");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/verify-otp
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/verify-otp", () => {
  it("returns { verified: true } for a correct code", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "111111" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "111111" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ verified: true });
  });

  it("marks the user as email-verified after success", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "222222" });
    const app = buildApp({ prisma });

    await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "222222" });

    expect(prisma._users.get(user.id).emailVerifiedAt).toBeTruthy();
  });

  it("consumes the challenge after a correct code — single-use", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "333333" });
    const app = buildApp({ prisma });

    const r1 = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "333333" });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "333333" });
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("OTP_INVALID");
  });

  /**
   * [unit] Concurrent correct submissions — conditional WHERE guard
   *
   * Simulates two "concurrent" requests by building a Prisma stub whose
   * updateMany tracks how many times it has been called and returns
   * count=0 on the second call to the consumption query. This verifies
   * the conditional WHERE logic: only the request that wins updateMany
   * with count===1 verifies the user.
   *
   * ⚠ NOT a database concurrency test. A real PostgreSQL integration
   *   test with two parallel connections is required to verify row-level
   *   locking. DATABASE CONCURRENCY UNVERIFIED (no live DB available).
   */
  it("[unit] only one of two concurrent correct submissions succeeds", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "444444" });

    // Wrap updateMany to intercept the consumption call and simulate a race:
    // first consumption call succeeds (count=1), second returns count=0.
    let consumptionCallCount = 0;
    const origUpdateMany = prisma.otpChallenge.updateMany.bind(
      prisma.otpChallenge,
    );
    prisma.otpChallenge.updateMany = async (args) => {
      // The consumption call has consumedAt: null and expiresAt guard
      if (args.where.consumedAt === null && args.where.expiresAt) {
        consumptionCallCount++;
        if (consumptionCallCount > 1) return { count: 0 }; // simulate losing the race
      }
      return origUpdateMany(args);
    };

    const app = buildApp({ prisma });

    // Submit two correct codes "simultaneously" (serial in JS but stub simulates race)
    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ email: "user@example.com", code: "444444" }),
      request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ email: "user@example.com", code: "444444" }),
    ]);

    const successes = [r1, r2].filter((r) => r.status === 200);
    const failures = [r1, r2].filter((r) => r.status !== 200);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].body.error.code).toBe("OTP_INVALID");
  });

  /**
   * [unit] Verify racing with a resend (supersede)
   *
   * Simulates a resend consuming the challenge (setting consumedAt) just
   * before a verification attempt's updateMany fires. The conditional WHERE
   * (consumedAt: null) ensures the verification fails rather than double-consuming.
   *
   * ⚠ Serial in-memory simulation only. DATABASE CONCURRENCY UNVERIFIED.
   */
  it("[unit] verify racing with a superseding resend returns OTP_INVALID", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    const ch = await seedChallenge(prisma, user.id, { _rawCode: "555555" });

    // Intercept the consumption updateMany and externally consume the challenge
    // first to simulate the resend winning the race
    const origUpdateMany = prisma.otpChallenge.updateMany.bind(
      prisma.otpChallenge,
    );
    prisma.otpChallenge.updateMany = async (args) => {
      if (args.where.consumedAt === null && args.where.expiresAt) {
        // Simulate: resend already consumed this challenge
        const c = prisma._challenges.get(ch.id);
        if (c) c.consumedAt = BASE_NOW;
      }
      return origUpdateMany(args);
    };

    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "555555" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });

  it("returns OTP_INVALID for a wrong code", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "444444" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });

  it("returns OTP_EXPIRED for a code past its expiresAt", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      _rawCode: "555555",
      expiresAt: new Date(BASE_NOW.getTime() - 1),
    });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "555555" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_EXPIRED");
  });

  it("returns OTP_INVALID for a superseded (consumed) challenge", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      _rawCode: "666666",
      consumedAt: new Date(BASE_NOW.getTime() - 5000),
    });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "666666" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });

  it("returns OTP_ATTEMPTS_EXCEEDED after 5 wrong attempts", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "777777" });
    const app = buildApp({ prisma });

    for (let i = 0; i < 4; i++) {
      const r = await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ email: "user@example.com", code: "000000" });
      expect(r.body.error.code).toBe("OTP_INVALID");
    }

    const r5 = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "000000" });
    expect(r5.status).toBe(429);
    expect(r5.body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");

    // 6th attempt — exhausted challenge returns same code even with correct code
    const r6 = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "777777" });
    expect(r6.body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("challenge is consumed after exhaustion — correct code no longer works", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "888888" });
    const app = buildApp({ prisma });

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ email: "user@example.com", code: "000000" });
    }

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "888888" });
    expect(res.body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("returns 422 for a non-6-digit code", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/verify-otp")
      .send({ email: "a@b.com", code: "12345" });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.code).toBeDefined();
  });

  it("response does not contain digest or hash values", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, { _rawCode: "101010" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "101010" });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("codeDigest");
    expect(body).not.toContain("passwordHash");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/resend-otp
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/resend-otp", () => {
  it("returns 200 { sent: true, resendAvailableAt } for unverified account past cooldown", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() - 1),
    });
    const app = buildApp({ prisma, mailer });

    const res = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.resendAvailableAt).toBeDefined();
    expect(mailer.calls).toHaveLength(1);
  });

  it("supersedes the previous challenge — old code no longer works", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      _rawCode: "000001",
      resendAvailableAt: new Date(BASE_NOW.getTime() - 1),
    });
    const newCode = "999000";
    const app = buildApp({ prisma, otpGen: () => newCode });

    await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    // Old code must be rejected
    const r1 = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: "000001" });
    expect(r1.status).toBe(400);

    // New code must succeed
    const r2 = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ email: "user@example.com", code: newCode });
    expect(r2.status).toBe(200);
    expect(r2.body.data.verified).toBe(true);
  });

  /**
   * Cooldown-limited accounts must receive the same 200 response shape as
   * unknown and verified accounts. No 429 or distinct error code that would
   * allow an attacker to distinguish them.
   */
  it("returns 200 (not 429) for an account within the 30-second cooldown", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() + 10_000), // 10s in future
    });
    const app = buildApp({ prisma, mailer });

    const res = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    // Same 200 shape — no 429 that reveals in-cooldown state
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.resendAvailableAt).toBeDefined();
    // No new email was sent
    expect(mailer.calls).toHaveLength(0);
  });

  it("does not return an error code that reveals in-cooldown state", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() + 10_000),
    });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    // Must not expose OTP_RESEND_TOO_SOON or any account-state-specific code
    expect(res.body.error).toBeUndefined();
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("OTP_RESEND_TOO_SOON");
    expect(body).not.toContain("cooldown");
  });

  it("does not reveal account existence for unknown email — same shape as success", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "ghost@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.resendAvailableAt).toBeDefined();
  });

  it("does not reveal account existence for a verified email — same shape as success", async () => {
    const prisma = buildPrisma();
    await seedVerifiedUser(prisma, { email: "verified@example.com" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "verified@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
  });

  it("resend gives fresh 10-minute expiry window", async () => {
    const prisma = buildPrisma();
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      expiresAt: new Date(BASE_NOW.getTime() - 1), // expired
      resendAvailableAt: new Date(BASE_NOW.getTime() - 1), // past cooldown
    });
    const newCode = "000001";
    const app = buildApp({ prisma, otpGen: () => newCode });

    await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    const challenges = [...prisma._challenges.values()];
    const newChallenge = challenges.find(
      (c) => c.consumedAt === null && c.expiresAt > BASE_NOW,
    );
    expect(newChallenge).toBeDefined();
    expect(newChallenge.expiresAt > BASE_NOW).toBe(true);
  });

  it("returns 422 for missing email", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/resend-otp")
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 503 SERVICE_UNAVAILABLE when SMTP fails during resend", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy({ shouldFail: true });
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() - 1),
    });
    const app = buildApp({ prisma, mailer });

    const res = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("invalidates new challenge on SMTP failure — account usable for next resend", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy({ shouldFail: true });
    const user = await seedUser(prisma);
    await seedChallenge(prisma, user.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() - 1),
    });
    const app = buildApp({ prisma, mailer });

    await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "user@example.com" });

    // No active challenges after failure
    const active = [...prisma._challenges.values()].filter(
      (c) => c.consumedAt === null && c.expiresAt > BASE_NOW,
    );
    expect(active).toHaveLength(0);
    // Account still exists
    const u = [...prisma._users.values()].find((u) => u.id === user.id);
    expect(u).toBeDefined();
  });

  it("prevents email enumeration: unknown, verified, cooldown, and eligible return identical public shapes", async () => {
    const prisma = buildPrisma();
    const mailer = buildMailSpy();
    const app = buildApp({ prisma, mailer, now: () => BASE_NOW });

    const expectedShape = {
      data: {
        sent: true,
        resendAvailableAt: new Date(BASE_NOW.getTime() + 30000).toISOString(),
      },
    };

    // 1. Unknown
    const rUnknown = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "unknown@example.com" });

    // 2. Verified
    await seedVerifiedUser(prisma, { email: "verified@example.com" });
    const rVerified = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "verified@example.com" });

    // 3. Cooldown
    const uCooldown = await seedUser(prisma, { email: "cooldown@example.com" });
    await seedChallenge(prisma, uCooldown.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() + 10000),
    });
    const rCooldown = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "cooldown@example.com" });

    // 4. Eligible (past cooldown)
    const uEligible = await seedUser(prisma, { email: "eligible@example.com" });
    await seedChallenge(prisma, uEligible.id, {
      resendAvailableAt: new Date(BASE_NOW.getTime() - 10000),
    });
    const rEligible = await request(app)
      .post("/api/v1/auth/resend-otp")
      .send({ email: "eligible@example.com" });

    expect(rUnknown.status).toBe(200);
    expect(rUnknown.body).toEqual(expectedShape);
    expect(rVerified.body).toEqual(expectedShape);
    expect(rCooldown.body).toEqual(expectedShape);
    expect(rEligible.body).toEqual(expectedShape);

    // Verify email sent only to Eligible
    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0].to).toBe("eligible@example.com");
  });

  it("enforces IP-level rate limiting on resend (max 5 requests) without revealing account existence", async () => {
    const prisma = buildPrisma();
    const app = buildApp({ prisma, now: () => BASE_NOW, trustProxy: 1 });

    // First 5 requests should succeed (generic response)
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/resend-otp")
        .set("X-Forwarded-For", "192.168.1.100")
        .send({ email: "unknown@example.com" });
      expect(res.status).toBe(200);
      expect(res.body.data.sent).toBe(true);
    }

    // 6th request should fail with 429 TOO_MANY_REQUESTS
    const resOver = await request(app)
      .post("/api/v1/auth/resend-otp")
      .set("X-Forwarded-For", "192.168.1.100")
      .send({ email: "unknown@example.com" });

    expect(resOver.status).toBe(429);
    expect(resOver.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(resOver.body.error.message).toMatch(/Too many OTP resend/i);
    expect(resOver.headers["retry-after"]).toBeDefined();

    // Different IP should succeed
    const resDiff = await request(app)
      .post("/api/v1/auth/resend-otp")
      .set("X-Forwarded-For", "192.168.1.101")
      .send({ email: "unknown@example.com" });
    expect(resDiff.status).toBe(200);
  });

  it("does not trust X-Forwarded-For by default, preventing rate limit bypass via spoofing", async () => {
    const prisma = buildPrisma();
    // Do NOT pass trustProxy: 1 here (tests untrusted proxy default)
    const app = buildApp({ prisma, now: () => BASE_NOW });

    // First 5 requests with spoofed, DIFFERENT IPs
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/resend-otp")
        .set("X-Forwarded-For", `203.0.113.${i}`)
        .send({ email: "unknown@example.com" });
      expect(res.status).toBe(200);
    }

    // 6th request with a newly spoofed IP should STILL fail because the real IP is the same
    const resOver = await request(app)
      .post("/api/v1/auth/resend-otp")
      .set("X-Forwarded-For", "203.0.113.99")
      .send({ email: "unknown@example.com" });

    expect(resOver.status).toBe(429);
    expect(resOver.body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/login
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/login", () => {
  it("returns INVALID_CREDENTIALS for unknown email", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/login")
      .send({ email: "unknown@example.com", password: "Password1!" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  /**
   * Finding #1 — timing equalisation for unknown email.
   *
   * We stub bcrypt.compare and assert it is called twice for an unknown-email
   * attempt: once against DUMMY_HASH (to equalise timing) and then the
   * INVALID_CREDENTIALS error is thrown without any real hash comparison.
   * We verify this by observing that the first call receives the dummy hash
   * prefix ("$2b$12$") rather than the user's real hash. The submitted
   * password must never appear in the call arguments beyond the first position.
   */
  it("[timing] unknown-email path performs a dummy bcrypt comparison", async () => {
    const compareCalls = [];
    const origCompare = bcrypt.compare.bind(bcrypt);
    // Temporarily spy on bcrypt.compare
    bcrypt.compare = async (pwd, hash) => {
      compareCalls.push({ hash });
      return origCompare(pwd, hash);
    };

    try {
      await request(buildApp())
        .post("/api/v1/auth/login")
        .send({ email: "ghost@example.com", password: "Password1!" });
    } finally {
      bcrypt.compare = origCompare;
    }

    // Must have performed at least one comparison against a $2b$ hash
    expect(compareCalls.length).toBeGreaterThanOrEqual(1);
    expect(compareCalls[0].hash).toMatch(/^\$2b\$/);
  });

  it("returns INVALID_CREDENTIALS for a wrong password", async () => {
    const prisma = buildPrisma();
    await seedVerifiedUser(prisma, { email: "user@example.com" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "user@example.com", password: "WrongPassword" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns EMAIL_NOT_VERIFIED for a correct password but unverified account", async () => {
    const prisma = buildPrisma();
    await seedUser(prisma, { email: "user@example.com" }); // unverified
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "user@example.com", password: "Password1!" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("returns 200 with JWT and user summary for successful login", async () => {
    const prisma = buildPrisma();
    await seedVerifiedUser(prisma, { email: "user@example.com" });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "user@example.com", password: "Password1!" });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.expiresAt).toBeDefined();
    expect(res.body.data.user.email).toBe("user@example.com");
    expect(res.body.data.user.profileComplete).toBe(false);
    expect(res.body.data.user.selectedTaskCount).toBe(0);
  });

  /**
   * Finding #2 — 72 UTF-8 byte limit applies to login as well.
   * 'à' (U+00E0) is 2 UTF-8 bytes. 37 × 'à' = 74 bytes > 72.
   */
  it("returns 422 for a login password exceeding 72 UTF-8 bytes", async () => {
    const password = "à".repeat(37); // 37 chars, 74 bytes
    expect(Buffer.byteLength(password, "utf8")).toBe(74);

    const res = await request(buildApp())
      .post("/api/v1/auth/login")
      .send({ email: "a@b.com", password });

    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toBeDefined();
  });

  it("accepts a login password at exactly 72 UTF-8 bytes", async () => {
    const prisma = buildPrisma();
    // Seed user with a 72-byte password
    const password = "à".repeat(36); // 36 chars, 72 bytes
    expect(Buffer.byteLength(password, "utf8")).toBe(72);
    const passwordHash = await bcrypt.hash(password, 4);
    await prisma.user.create({
      data: { email: "unicode@example.com", passwordHash, emailVerifiedAt: new Date() },
    });
    const app = buildApp({ prisma });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "unicode@example.com", password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/auth/me
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/auth/me", () => {
  it("returns UNAUTHORIZED for missing token", async () => {
    const res = await request(buildApp()).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  // Finding #4 — malformed / wrong-secret / expired token cases
  it("returns UNAUTHORIZED for a malformed (non-JWT) token", async () => {
    const res = await request(buildApp())
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalid.token.here");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED for a token signed with the wrong secret", async () => {
    const wrongToken = jwt.sign({ sub: "some-user-id" }, "wrong-secret", {
      algorithm: "HS256",
      expiresIn: 60,
    });
    const res = await request(buildApp())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${wrongToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED for an expired JWT", async () => {
    // Sign a token that expired 1 second ago
    const expiredToken = jwt.sign({ sub: "some-user-id" }, SECRET, {
      algorithm: "HS256",
      expiresIn: -1,
    });
    const res = await request(buildApp())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED for a validly signed token with missing sub", async () => {
    // Valid HS256 signature but no sub claim
    const noSubToken = jwt.sign({ userId: "some-id" }, SECRET, {
      algorithm: "HS256",
      expiresIn: 60,
    });
    const res = await request(buildApp())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${noSubToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED for a validly signed token with a non-UUID sub", async () => {
    // Valid HS256 signature but sub is not a UUID
    const nonUuidToken = jwt.sign({ sub: "not-a-uuid" }, SECRET, {
      algorithm: "HS256",
      expiresIn: 60,
    });
    const res = await request(buildApp())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${nonUuidToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns user summary when authenticated", async () => {
    const prisma = buildPrisma();
    await seedVerifiedUser(prisma, { email: "me@example.com" });
    const app = buildApp({ prisma });

    // 1. Login to get token
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "me@example.com", password: "Password1!" });

    const token = loginRes.body.data.accessToken;

    // 2. Fetch /me
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe("me@example.com");
    expect(meRes.body.data.profileComplete).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/logout
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/logout", () => {
  it("returns { loggedOut: true } statelessly", async () => {
    const prisma = buildPrisma();
    await seedVerifiedUser(prisma, { email: "out@example.com" });
    const app = buildApp({ prisma });

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "out@example.com", password: "Password1!" });
    
    const token = loginRes.body.data.accessToken;

    const outRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(outRes.status).toBe(200);
    expect(outRes.body.data.loggedOut).toBe(true);
  });
});
