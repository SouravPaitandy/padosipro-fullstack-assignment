"use strict";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { createApp } = require("../src/app");

const SECRET = "test-jwt-secret-at-least-32-chars!!";

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// NOTE: The $transaction stub executes operations sequentially in memory.
// It does NOT verify real PostgreSQL rollback or concurrency isolation.
// Database-level concurrency remains unverified until a PostgreSQL
// integration test environment is available.
// ---------------------------------------------------------------------------

function buildPrisma(initialData = {}) {
  const categories = initialData.categories ?? [];
  const tasks = initialData.tasks ?? [];
  // Use a mutable array reference so deleteMany/createMany mutate shared state.
  const userTasksRef = {
    list: initialData.userTasks ? [...initialData.userTasks] : [],
  };

  const prisma = {
    _categories: categories,
    _tasks: tasks,
    get _userTasks() {
      return userTasksRef.list;
    },
    set _userTasks(v) {
      userTasksRef.list = v;
    },

    category: {
      findMany: async ({ where, include }) => {
        // Simple mock for this specific query
        let cats = categories.filter((c) => c.isActive === where.isActive);
        // Include tasks
        if (include && include.tasks) {
          const taskWhere = include.tasks.where || {};
          cats = cats.map((c) => {
            let catTasks = tasks.filter((t) => t.categoryId === c.id);
            if (taskWhere.isActive !== undefined) {
              catTasks = catTasks.filter(
                (t) => t.isActive === taskWhere.isActive,
              );
            }
            if (taskWhere.name && taskWhere.name.contains) {
              const search = taskWhere.name.contains.toLowerCase();
              catTasks = catTasks.filter((t) =>
                t.name.toLowerCase().includes(search),
              );
            }
            // Sort
            catTasks.sort((a, b) => a.sortOrder - b.sortOrder);
            return { ...c, tasks: catTasks };
          });
        }
        // Sort categories
        cats.sort((a, b) => a.sortOrder - b.sortOrder);
        return cats;
      },
    },

    task: {
      findMany: async ({ where }) => {
        let t = tasks;
        if (where.id && where.id.in) {
          t = t.filter((task) => where.id.in.includes(task.id));
        }
        if (where.isActive !== undefined) {
          t = t.filter((task) => task.isActive === where.isActive);
        }
        return t;
      },
    },

    userTask: {
      findMany: async ({ where, include }) => {
        let ut = userTasksRef.list.filter((u) => u.userId === where.userId);
        if (include && include.task) {
          ut = ut.map((u) => ({
            ...u,
            task: tasks.find((t) => t.id === u.taskId),
          }));
        }
        return ut;
      },
      deleteMany: async ({ where }) => {
        const before = userTasksRef.list.length;
        userTasksRef.list = userTasksRef.list.filter(
          (u) => u.userId !== where.userId,
        );
        return { count: before - userTasksRef.list.length };
      },
      createMany: async ({ data }) => {
        userTasksRef.list.push(...data);
        return { count: data.length };
      },
    },

    $transaction: async (fn) => fn(prisma),
  };

  return prisma;
}

function buildApp(prisma = buildPrisma()) {
  return createApp({ prisma, jwtSecret: SECRET });
}

function makeToken(sub) {
  return jwt.sign({ sub }, SECRET, { algorithm: "HS256", expiresIn: 60 });
}

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

describe("Tasks API", () => {
  const catId = crypto.randomUUID();
  const task1Id = crypto.randomUUID();
  const task2Id = crypto.randomUUID();
  const inactiveTaskId = crypto.randomUUID();

  const initialData = {
    categories: [
      {
        id: catId,
        name: "Home Services",
        slug: "home",
        sortOrder: 1,
        isActive: true,
      },
      {
        id: crypto.randomUUID(),
        name: "Inactive Cat",
        slug: "inactive",
        sortOrder: 2,
        isActive: false,
      },
    ],
    tasks: [
      {
        id: task1Id,
        categoryId: catId,
        name: "Plumbing",
        slug: "plumbing",
        description: "Fix pipes",
        sortOrder: 1,
        isActive: true,
      },
      {
        id: task2Id,
        categoryId: catId,
        name: "Electrical",
        slug: "electrical",
        description: "Fix wiring",
        sortOrder: 2,
        isActive: true,
      },
      {
        id: inactiveTaskId,
        categoryId: catId,
        name: "Cleaning",
        slug: "cleaning",
        description: "Clean",
        sortOrder: 3,
        isActive: false,
      },
    ],
  };

  // -------------------------------------------------------------------------
  // GET /api/v1/tasks
  // -------------------------------------------------------------------------

  describe("GET /api/v1/tasks", () => {
    it("returns 401 for unauthenticated access", async () => {
      const res = await request(buildApp()).get("/api/v1/tasks");
      expect(res.status).toBe(401);
    });

    it("returns active categories and active tasks, sorted", async () => {
      const prisma = buildPrisma(initialData);
      const res = await request(buildApp(prisma))
        .get("/api/v1/tasks")
        .set("Authorization", `Bearer ${makeToken(crypto.randomUUID())}`);

      expect(res.status).toBe(200);
      const cats = res.body.data.categories;
      expect(cats).toHaveLength(1); // only active categories
      expect(cats[0].tasks).toHaveLength(2); // only active tasks
      expect(cats[0].tasks[0].name).toBe("Plumbing"); // sortOrder asc
      expect(cats[0].tasks[1].name).toBe("Electrical");
    });

    it("supports ?search= query to filter tasks by name", async () => {
      const prisma = buildPrisma(initialData);
      const res = await request(buildApp(prisma))
        .get("/api/v1/tasks?search=plumb")
        .set("Authorization", `Bearer ${makeToken(crypto.randomUUID())}`);

      expect(res.status).toBe(200);
      const cats = res.body.data.categories;
      expect(cats).toHaveLength(1);
      expect(cats[0].tasks).toHaveLength(1);
      expect(cats[0].tasks[0].name).toBe("Plumbing");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/me/tasks
  // -------------------------------------------------------------------------

  describe("GET /api/v1/me/tasks", () => {
    it("returns 401 for unauthenticated access", async () => {
      const res = await request(buildApp()).get("/api/v1/me/tasks");
      expect(res.status).toBe(401);
    });

    it("returns saved selections with task summaries", async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma({
        ...initialData,
        userTasks: [{ userId, taskId: task1Id }],
      });

      const res = await request(buildApp(prisma))
        .get("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userId)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.tasks).toHaveLength(1);
      const task = res.body.data.tasks[0];
      expect(task.id).toBe(task1Id);
      expect(task.name).toBe("Plumbing");
      expect(task.slug).toBe("plumbing");
      expect(task.categoryId).toBe(catId);
    });

    it("[unit] isolates selections between users", async () => {
      const userA = crypto.randomUUID();
      const userB = crypto.randomUUID();
      const prisma = buildPrisma({
        ...initialData,
        userTasks: [
          { userId: userA, taskId: task1Id },
          { userId: userB, taskId: task2Id },
        ],
      });

      const resA = await request(buildApp(prisma))
        .get("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userA)}`);
      expect(resA.body.data.tasks[0].id).toBe(task1Id);

      const resB = await request(buildApp(prisma))
        .get("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userB)}`);
      expect(resB.body.data.tasks[0].id).toBe(task2Id);
    });
  });

  // -------------------------------------------------------------------------
  // PUT /api/v1/me/tasks
  // -------------------------------------------------------------------------

  describe("PUT /api/v1/me/tasks", () => {
    it("returns 401 for unauthenticated access", async () => {
      const res = await request(buildApp())
        .put("/api/v1/me/tasks")
        .send({ taskIds: [] });
      expect(res.status).toBe(401);
    });

    it("[unit] replaces selections and returns task summaries", async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma({
        ...initialData,
        userTasks: [{ userId, taskId: task1Id }],
      });

      const res = await request(buildApp(prisma))
        .put("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userId)}`)
        .send({ taskIds: [task2Id] });

      expect(res.status).toBe(200);
      // Response shape is { data: { tasks: [...] } } — consistent with GET
      expect(res.body.data.tasks).toHaveLength(1);
      const task = res.body.data.tasks[0];
      expect(task.id).toBe(task2Id);
      expect(task.name).toBe("Electrical");
      expect(task.slug).toBe("electrical");
      expect(task.categoryId).toBe(catId);

      // DB state is updated
      const dbTasks = prisma._userTasks.filter((u) => u.userId === userId);
      expect(dbTasks).toHaveLength(1);
      expect(dbTasks[0].taskId).toBe(task2Id);
    });

    it("[unit] empty taskIds clears selection and returns empty list", async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma({
        ...initialData,
        userTasks: [{ userId, taskId: task1Id }],
      });

      const res = await request(buildApp(prisma))
        .put("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userId)}`)
        .send({ taskIds: [] });

      expect(res.status).toBe(200);
      expect(res.body.data.tasks).toEqual([]);

      const dbTasks = prisma._userTasks.filter((u) => u.userId === userId);
      expect(dbTasks).toHaveLength(0);
    });

    it("[unit] an injected userId in the body does not affect another user — JWT sub is the authoritative identity", async () => {
      const aliceId = crypto.randomUUID();
      const bobId = crypto.randomUUID();
      const prisma = buildPrisma({
        ...initialData,
        userTasks: [{ userId: aliceId, taskId: task1Id }],
      });

      // Bob sends his JWT but tries to inject Alice's userId in the body.
      const res = await request(buildApp(prisma))
        .put("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(bobId)}`)
        .send({ userId: aliceId, taskIds: [task2Id] });

      expect(res.status).toBe(200);
      // Bob's selection was written under his own id.
      expect(res.body.data.tasks[0].id).toBe(task2Id);
      const bobDb = prisma._userTasks.filter((u) => u.userId === bobId);
      expect(bobDb).toHaveLength(1);
      // Alice's selection is untouched.
      const aliceDb = prisma._userTasks.filter((u) => u.userId === aliceId);
      expect(aliceDb).toHaveLength(1);
      expect(aliceDb[0].taskId).toBe(task1Id);
    });

    it("rejects unknown task IDs with 422 and VALIDATION_ERROR code", async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma(initialData);

      const res = await request(buildApp(prisma))
        .put("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userId)}`)
        .send({ taskIds: [crypto.randomUUID()] }); // unknown UUID

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects inactive task IDs with 422", async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma(initialData);

      const res = await request(buildApp(prisma))
        .put("/api/v1/me/tasks")
        .set("Authorization", `Bearer ${makeToken(userId)}`)
        .send({ taskIds: [inactiveTaskId] });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
