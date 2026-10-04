'use strict';

const { randomUUID } = require('crypto');

/**
 * Attaches a UUID v4 request ID to every request and echoes it in the
 * X-Request-Id response header. All error responses include this ID so
 * callers can correlate logs.
 */
function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };
