'use strict';

/**
 * Consistent response helpers matching the DESIGN.md envelope.
 *
 * Success:  { data: <value> }
 * Error:    { error: { code, message, requestId, [fields] } }
 */

/** Send a 2xx success envelope. */
function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({ data });
}

/**
 * Send an error envelope.
 * @param {import('express').Response} res
 * @param {{ code: string, message: string, requestId?: string, fields?: object, statusCode?: number }} opts
 */
function fail(res, { code = 'INTERNAL_ERROR', message = 'An unexpected error occurred.', requestId, fields, statusCode = 500 }) {
  const body = { error: { code, message, requestId } };
  if (fields) body.error.fields = fields;
  return res.status(statusCode).json(body);
}

module.exports = { success, fail };
