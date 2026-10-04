'use strict';

const { z } = require('zod');

const getTasksSchema = z.object({
  search: z.string().optional(),
});

const putUserTasksSchema = z.object({
  taskIds: z.array(z.string().uuid('Invalid task ID format')),
});

module.exports = {
  getTasksSchema,
  putUserTasksSchema,
};
