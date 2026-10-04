'use strict';

/**
 * Catch-all for routes not matched by any handler.
 * Sets up a NOT_FOUND error and delegates to errorHandler.
 */
function notFound(req, _res, next) {
  const err = Object.assign(
    new Error(`${req.method} ${req.path} not found.`),
    { code: 'NOT_FOUND', statusCode: 404 },
  );
  next(err);
}

module.exports = { notFound };
