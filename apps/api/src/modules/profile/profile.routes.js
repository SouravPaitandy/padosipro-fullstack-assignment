'use strict';

const { Router } = require('express');
const { requireAuth } = require('../../middleware/require-auth');
const { validate } = require('../../middleware/validate');
const { success } = require('../../lib/response');
const { putProfileSchema } = require('./profile.schema');
const { getProfile, upsertProfile } = require('./profile.service');

function createProfileRouter({ prisma, jwtSecret }) {
  const router = Router();
  const authMw = requireAuth(jwtSecret);

  router.get('/', authMw, async (req, res, next) => {
    try {
      const profile = await getProfile(prisma, req.user.sub);
      return success(res, { profile });
    } catch (err) {
      next(err);
    }
  });

  router.put('/', authMw, validate({ body: putProfileSchema }), async (req, res, next) => {
    try {
      const profile = await upsertProfile(prisma, req.user.sub, req.body);
      return success(res, { profile });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createProfileRouter };
