'use strict';

const { Router } = require('express');
const { requireAuth } = require('../../middleware/require-auth');
const { validate } = require('../../middleware/validate');
const { success } = require('../../lib/response');
const { getTasksSchema, putUserTasksSchema } = require('./tasks.schema');
const { getCatalog, getUserTasks, putUserTasks } = require('./tasks.service');

function createTasksRouter({ prisma, jwtSecret }) {
  const router = Router();
  const authMw = requireAuth(jwtSecret);

  // GET /api/v1/tasks
  router.get('/', authMw, validate({ query: getTasksSchema }), async (req, res, next) => {
    try {
      const search = req.query.search;
      const categories = await getCatalog(prisma, search);
      return success(res, { categories });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function createMeTasksRouter({ prisma, jwtSecret }) {
  const router = Router();
  const authMw = requireAuth(jwtSecret);

  // GET /api/v1/me/tasks
  router.get('/', authMw, async (req, res, next) => {
    try {
      const tasks = await getUserTasks(prisma, req.user.sub);
      return success(res, { tasks });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/v1/me/tasks
  router.put('/', authMw, validate({ body: putUserTasksSchema }), async (req, res, next) => {
    try {
      const result = await putUserTasks(prisma, req.user.sub, req.body.taskIds);
      return success(res, result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createTasksRouter,
  createMeTasksRouter,
};
