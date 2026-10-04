'use strict';

// Load and validate env vars first — exits with a clear message if any are
// missing or invalid. Must run before importing app or any DB code.
require('dotenv').config();
const env = require('./config/env');

const { createApp } = require('./app');
const prisma        = require('./lib/prisma');
const { createMailer } = require('./mail/mailer');

const mailer = createMailer({
  host:      env.SMTP_HOST,
  port:      env.SMTP_PORT,
  from:      env.SMTP_FROM,
  secure:    env.SMTP_SECURE,
  ignoreTLS: env.SMTP_IGNORE_TLS,
});

const app = createApp({
  prisma,
  mailer,
  otpSecret: env.OTP_HMAC_SECRET,
  jwtSecret: env.JWT_SECRET,
  trustProxy: env.TRUST_PROXY,
});

const PORT = env.API_PORT;

const server = app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish,
// then disconnect Prisma before the process exits.
const shutdown = (signal) => {
  console.log(`[api] received ${signal}, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('[api] server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
