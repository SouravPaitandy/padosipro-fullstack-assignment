'use strict';

/**
 * Foundation tests — no live database required.
 *
 * Covers:
 *  1. GET /health  — 200 + body + X-Request-Id header
 *  2. Unknown route — 404 NOT_FOUND error envelope
 *  3. validate() middleware — 422 VALIDATION_ERROR with field-level messages
 *
 * The validate() test builds a minimal Express app inline so the route can be
 * registered before the notFound/errorHandler fallthrough, without mutating
 * the shared app instance.
 */

const request  = require('supertest');
const express  = require('express');
const { z }    = require('zod');

const app            = require('../src/app');
const { requestId }  = require('../src/middleware/requestId');
const { validate }   = require('../src/middleware/validate');
const { errorHandler } = require('../src/middleware/errorHandler');

// UUID v4 regex used to assert request IDs
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sets X-Request-Id header to a UUID v4', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(UUID_RE);
  });
});

// ── Error envelope: NOT_FOUND ─────────────────────────────────────────────────

describe('Error envelope — 404 NOT_FOUND', () => {
  it('returns 404 with error envelope for unmatched routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        requestId: expect.stringMatching(UUID_RE),
      },
    });
  });

  it('does not expose a stack trace in the response', async () => {
    const res = await request(app).get('/no-such-route');
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});

// ── Error envelope: Malformed JSON ────────────────────────────────────────────

describe('Error envelope — 400 BAD_REQUEST (Malformed JSON)', () => {
  it('returns stable 400 error envelope and request ID when sending invalid JSON', async () => {
    // express.json() runs on all paths, so posting invalid JSON anywhere triggers it
    const res = await request(app)
      .post('/api/v1/dummy')
      .set('Content-Type', 'application/json')
      .send('{ "bad": json }');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON payload.',
        requestId: expect.stringMatching(UUID_RE),
      },
    });
    // Ensure the header was set because requestId ran first
    expect(res.headers['x-request-id']).toMatch(UUID_RE);
  });
});

// ── Error envelope: VALIDATION_ERROR ─────────────────────────────────────────
// Uses a fresh minimal app so the validate route is registered before
// the notFound/errorHandler fallthrough — no mutation of the shared app.

describe('validate() middleware — 422 VALIDATION_ERROR', () => {
  const testSchema = z.object({
    email: z.string().email('Enter a valid email address.'),
    age:   z.coerce.number().int().min(0, 'Age must be a positive integer.'),
  });

  const testApp = express();
  testApp.use(requestId);
  testApp.use(express.json());
  testApp.post('/test-validate', validate({ body: testSchema }), (_req, res) => {
    res.json({ data: 'ok' });
  });
  testApp.use(errorHandler);

  it('passes valid data through to the handler', async () => {
    const res = await request(testApp)
      .post('/test-validate')
      .send({ email: 'user@example.com', age: 25 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: 'ok' });
  });

  it('returns 422 with VALIDATION_ERROR code for invalid body', async () => {
    const res = await request(testApp)
      .post('/test-validate')
      .send({ email: 'not-an-email', age: -1 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the submitted fields.',
        requestId: expect.stringMatching(UUID_RE),
      },
    });
  });

  it('includes per-field error messages', async () => {
    const res = await request(testApp)
      .post('/test-validate')
      .send({ email: 'bad', age: 'not-a-number' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty('email');
  });

  it('returns 200 when body is coerced correctly', async () => {
    const res = await request(testApp)
      .post('/test-validate')
      .send({ email: 'a@b.co', age: '30' }); // age sent as string, coerced to number
    expect(res.status).toBe(200);
  });
});
