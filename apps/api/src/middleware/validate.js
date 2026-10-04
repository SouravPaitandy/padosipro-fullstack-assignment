'use strict';

const { ZodError } = require('zod');

/**
 * Validates req.body / req.params / req.query against Zod schemas.
 * On failure, forwards a structured error that errorHandler converts
 * to the DESIGN.md VALIDATION_ERROR envelope (422).
 *
 * Usage:
 *   router.post('/path', validate({ body: mySchema }), handler);
 *
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
function validate({ body, params, query } = {}) {
  return (req, _res, next) => {
    try {
      if (body)   req.body   = body.parse(req.body);
      if (params) req.params = params.parse(req.params);
      if (query)  req.query  = query.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Build flat field→message map. Use '_root' for top-level errors.
        const fields = {};
        for (const issue of err.issues) {
          const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
          if (!fields[key]) fields[key] = issue.message; // first message wins
        }

        const validationErr = Object.assign(new Error('Check the submitted fields.'), {
          code: 'VALIDATION_ERROR',
          statusCode: 422,
          fields,
        });

        return next(validationErr);
      }
      next(err);
    }
  };
}

module.exports = { validate };
