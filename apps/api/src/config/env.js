'use strict';

/**
 * Environment configuration — validated at startup.
 *
 * Import this module only in server.js (process entry point).
 * Do NOT import it from app.js or middleware so tests can import
 * app.js without triggering process.exit().
 *
 * Missing or invalid required variables cause a clear console error
 * listing the variable *names* only — never their values — then exit(1).
 */

const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  API_PORT: z.coerce.number().int().positive().default(3000),

  // TRUST_PROXY defines if and how Express should trust X-Forwarded-* headers.
  // Can be a boolean, a number (hop count), or a string (IPs/subnets).
  // Defaults to false (untrusted proxy).
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => {
      if (v === 'true') return true;
      if (v === 'false' || !v) return false;
      const num = parseInt(v, 10);
      if (!Number.isNaN(num) && String(num) === v) return num;
      return v;
    })
    .default('false'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  OTP_HMAC_SECRET: z
    .string()
    .min(32, 'OTP_HMAC_SECRET must be at least 32 characters'),

  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().email('SMTP_FROM must be a valid email address'),
  // SMTP_SECURE=true → TLS from start (port 465).
  // Default false → plaintext or STARTTLS depending on server.
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // SMTP_IGNORE_TLS=true → disable STARTTLS upgrade (Mailpit local dev).
  // Never set to true in production.
  SMTP_IGNORE_TLS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const names = result.error.issues.map((i) => i.path.join('.') || '(root)');
  // Print variable names only — never values
  console.error(
    '❌  API startup failed — invalid or missing environment variables:\n  ' +
      names.join('\n  '),
  );
  console.error('Copy .env.example to apps/api/.env and fill in the values.');
  process.exit(1);
}

module.exports = result.data;
