'use strict';

function makeValidationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  err.statusCode = 422;
  return err;
}

/**
 * Returns active categories with their active tasks, optionally filtered by name.
 */
async function getCatalog(prisma, search = '') {
  const taskFilter = { isActive: true };
  if (search && search.trim() !== '') {
    taskFilter.name = { contains: search.trim(), mode: 'insensitive' };
  }

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      tasks: {
        where: taskFilter,
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          sortOrder: true,
        },
      },
    },
  });

  // When searching, return only categories that have at least one matching task.
  if (search && search.trim() !== '') {
    return categories.filter(c => c.tasks.length > 0);
  }

  return categories;
}

/**
 * Returns the current user's selected tasks.
 */
async function getUserTasks(prisma, userId) {
  const userTasks = await prisma.userTask.findMany({
    where: { userId },
    orderBy: { selectedAt: 'asc' },
    include: {
      task: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          categoryId: true,
        },
      },
    },
  });

  return userTasks.map(ut => ut.task);
}

/**
 * Atomically replaces the user's selected tasks and returns the saved selection.
 *
 * The read is performed inside the same transaction to make the replacement
 * atomic.
 *
 * NOTE: The $transaction stub used in tests does not verify real PostgreSQL
 * rollback or concurrency isolation — that remains unverified until a
 * PostgreSQL integration test environment is available.
 */
async function putUserTasks(prisma, userId, taskIds) {
  return await prisma.$transaction(async (tx) => {
    const uniqueTaskIds = [...new Set(taskIds)];

    // 1. Verify all taskIds refer to active tasks.
    if (uniqueTaskIds.length > 0) {
      const activeTasks = await tx.task.findMany({
        where: {
          id: { in: uniqueTaskIds },
          isActive: true,
        },
        select: { id: true },
      });

      if (activeTasks.length !== uniqueTaskIds.length) {
        throw makeValidationError('One or more task IDs are invalid or inactive.');
      }
    }

    // 2. Clear existing selection.
    await tx.userTask.deleteMany({ where: { userId } });

    // 3. Insert new selection (already deduplicated to avoid unique-constraint violations).
    if (uniqueTaskIds.length > 0) {
      await tx.userTask.createMany({
        data: uniqueTaskIds.map(taskId => ({ userId, taskId })),
      });
    }

    // 4. Read the saved selection from within the same transaction so the
    //    response cannot diverge from what was written by a concurrent update.
    const savedRows = await tx.userTask.findMany({
      where: { userId },
      orderBy: { selectedAt: 'asc' },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            categoryId: true,
          },
        },
      },
    });

    return { tasks: savedRows.map(ut => ut.task) };
  });
}

module.exports = {
  getCatalog,
  getUserTasks,
  putUserTasks,
};
