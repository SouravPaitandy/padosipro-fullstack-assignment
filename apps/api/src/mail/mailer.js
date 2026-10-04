'use strict';

/**
 * SMTP mail adapter — thin nodemailer wrapper configured from environment.
 *
 * Production usage:   createMailer(config).sendOtp(to, code)
 * Test usage:         inject a stub { sendOtp } object into the service.
 *
 * TLS/STARTTLS behaviour:
 *   - config.secure = true  → port 465, TLS from the start (production SMTP).
 *   - config.secure = false (default) → port 587 STARTTLS or plain.
 *   - config.ignoreTLS = true → disable STARTTLS upgrade (Mailpit / local dev).
 *
 * Never log `code` or any OTP plaintext — the parameter is named `code`
 * deliberately; callers must not pass digests.
 */

const nodemailer = require('nodemailer');

/**
 * Creates a nodemailer transporter from an explicit config object.
 *
 * @param {{
 *   host:      string,
 *   port:      number,
 *   from:      string,
 *   secure?:   boolean,   // true = TLS from start (port 465); default false
 *   ignoreTLS?: boolean,  // true = disable STARTTLS (Mailpit); default false
 * }} config
 */
function createMailer(config) {
  const transporter = nodemailer.createTransport({
    host:      config.host,
    port:      config.port,
    secure:    config.secure    ?? false,
    ignoreTLS: config.ignoreTLS ?? false,
  });

  /**
   * Send OTP email. Throws on delivery failure (caller decides retry policy).
   * @param {string} to   recipient email
   * @param {string} code raw 6-digit OTP — NOT a digest
   */
  async function sendOtp(to, code) {
    await transporter.sendMail({
      from:    config.from,
      to,
      subject: 'Your PadosiPro verification code',
      text:    `Your PadosiPro verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
      html:    `<p>Your PadosiPro verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
    });
  }

  return { sendOtp };
}

module.exports = { createMailer };
