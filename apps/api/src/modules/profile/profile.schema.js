'use strict';

const { z } = require('zod');

// Accepts either 10 digits or +91 followed by 10 digits, and stores the 10 digits.
const mobileSchema = z.string().trim().transform((val, ctx) => {
  let num = val;
  if (num.startsWith('+91')) {
    num = num.slice(3).trim();
  }
  if (!/^[6-9]\d{9}$/.test(num)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Mobile number must be exactly 10 digits starting with 6-9 (with or without +91)',
    });
    return z.NEVER;
  }
  return num;
});

const putProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  mobile: mobileSchema,
  address: z.string().trim().min(1, 'Address is required').max(500, 'Address is too long'),
  businessName: z.string().trim().max(100, 'Business name is too long')
    .nullable()
    .optional()
    .transform((v) => (!v ? null : v)),
});

module.exports = {
  putProfileSchema,
};
