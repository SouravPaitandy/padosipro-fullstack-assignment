'use strict';

/**
 * Global Express error handler — must have exactly 4 parameters so Express
 * recognises it as an error-handling middleware.
 *
 * Converts any error forwarded via next(err) into the DESIGN.md envelope:
 *   { error: { code, message, requestId, [fields] } }
 *
 * Rules:
 * - Known codes (set by validate / notFound / service layers) pass through.
 * - Unknown errors become INTERNAL_ERROR (500); their stack is logged but
 *   never sent to the client.
 * - Secret values, SQL details and OTP digests must never appear in responses.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Catch Express body-parser malformed JSON errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    err.code = 'BAD_REQUEST';
    err.message = 'Malformed JSON payload.';
  }

  const requestId = req.id ?? 'unknown';
  const code      = err.code ?? 'INTERNAL_ERROR';
  const statusCode = err.statusCode ?? 500;

  if (statusCode >= 500) {
    // Log full error server-side; suppress from client response
    console.error(JSON.stringify({
      level: 'error',
      requestId,
      code,
      message: err.message,
      stack: err.stack,
    }));
  }

  const body = {
    error: {
      code,
      message: statusCode >= 500 ? 'An unexpected error occurred.' : err.message,
      requestId,
    },
  };

  if (err.fields) body.error.fields = err.fields;

  return res.status(statusCode).json(body);
}

module.exports = { errorHandler };
