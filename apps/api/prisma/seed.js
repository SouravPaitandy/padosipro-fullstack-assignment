"use strict";

/**
 * Idempotent seed script — safe to rerun.
 *
 * WARNING: Task names below are STARTER/DEMO DATA invented for local
 * development. They are NOT from an official PadosiPro task catalog.
 * Replace these names with the authoritative list from the assignment
 * specification or product owner before any non-demo use.
 *
 * Categories and tasks are upserted by their unique slug, so rerunning
 * this script will update names/descriptions without duplicating rows.
 */

require("dotenv").config({
  path: require("node:path").resolve(__dirname, "..", ".env"),
});

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SEED_DATA = [
  {
    name: "Home Cleaning",
    slug: "home-cleaning",
    sortOrder: 10,
    tasks: [
      {
        name: "Full Home Deep Clean",
        slug: "full-home-deep-clean",
        description:
          "Thorough cleaning of all rooms, including dusting, mopping and surface sanitisation.",
        sortOrder: 10,
      },
      {
        name: "Kitchen Cleaning",
        slug: "kitchen-cleaning",
        description: "Cleaning countertops, appliances, sink and floor.",
        sortOrder: 20,
      },
      {
        name: "Bathroom Cleaning",
        slug: "bathroom-cleaning",
        description: "Scrubbing tiles, fixtures, toilet and floor.",
        sortOrder: 30,
      },
      {
        name: "Sofa & Upholstery Cleaning",
        slug: "sofa-upholstery-cleaning",
        description:
          "Spot-cleaning and vacuuming of sofas and fabric furniture.",
        sortOrder: 40,
      },
      {
        name: "Window Cleaning",
        slug: "window-cleaning",
        description: "Cleaning window panes, frames and sills from inside.",
        sortOrder: 50,
      },
    ],
  },
  {
    name: "Plumbing",
    slug: "plumbing",
    sortOrder: 20,
    tasks: [
      {
        name: "Leaking Tap Repair",
        slug: "leaking-tap-repair",
        description: "Identify and fix dripping or leaking taps.",
        sortOrder: 10,
      },
      {
        name: "Drain Unclogging",
        slug: "drain-unclogging",
        description: "Clear blocked kitchen or bathroom drains.",
        sortOrder: 20,
      },
      {
        name: "Toilet Flush Repair",
        slug: "toilet-flush-repair",
        description: "Fix faulty flush mechanisms or running cisterns.",
        sortOrder: 30,
      },
      {
        name: "Pipe Leak Repair",
        slug: "pipe-leak-repair",
        description: "Locate and seal minor pipe leaks.",
        sortOrder: 40,
      },
      {
        name: "Geyser Installation",
        slug: "geyser-installation",
        description: "Install or replace an electric or gas water heater.",
        sortOrder: 50,
      },
    ],
  },
  {
    name: "Electrical",
    slug: "electrical",
    sortOrder: 30,
    tasks: [
      {
        name: "Switch & Socket Replacement",
        slug: "switch-socket-replacement",
        description: "Replace faulty switches, sockets or modular plates.",
        sortOrder: 10,
      },
      {
        name: "Ceiling Fan Installation",
        slug: "ceiling-fan-installation",
        description: "Install or replace a ceiling fan with safe wiring.",
        sortOrder: 20,
      },
      {
        name: "Light Fixture Installation",
        slug: "light-fixture-installation",
        description: "Fit LED lights, tube lights or decorative fixtures.",
        sortOrder: 30,
      },
      {
        name: "MCB / Fuse Box Check",
        slug: "mcb-fuse-box-check",
        description: "Inspect miniature circuit breakers and fuse boards.",
        sortOrder: 40,
      },
      {
        name: "Inverter / UPS Setup",
        slug: "inverter-ups-setup",
        description: "Connect home inverter or UPS to household circuits.",
        sortOrder: 50,
      },
    ],
  },
  {
    name: "Appliance Repair",
    slug: "appliance-repair",
    sortOrder: 40,
    tasks: [
      {
        name: "Washing Machine Service",
        slug: "washing-machine-service",
        description: "Diagnose and repair common washing machine faults.",
        sortOrder: 10,
      },
      {
        name: "Refrigerator Service",
        slug: "refrigerator-service",
        description: "Gas refill, thermostat or cooling system repair.",
        sortOrder: 20,
      },
      {
        name: "AC Service & Gas Refill",
        slug: "ac-service-gas-refill",
        description: "Clean filters, service coils and top up refrigerant.",
        sortOrder: 30,
      },
      {
        name: "Microwave Repair",
        slug: "microwave-repair",
        description: "Diagnose and fix microwave heating or electrical faults.",
        sortOrder: 40,
      },
      {
        name: "Water Purifier Service",
        slug: "water-purifier-service",
        description: "Filter replacement and membrane cleaning for RO systems.",
        sortOrder: 50,
      },
    ],
  },
];

async function main() {
  console.log("🌱  Starting seed…");

  let categoryCount = 0;
  let taskCount = 0;

  for (const categoryData of SEED_DATA) {
    const { tasks, ...categoryFields } = categoryData;

    // Upsert category by slug
    const category = await prisma.category.upsert({
      where: { slug: categoryFields.slug },
      update: {
        name: categoryFields.name,
        sortOrder: categoryFields.sortOrder,
        isActive: true,
      },
      create: {
        ...categoryFields,
        isActive: true,
      },
    });

    categoryCount += 1;

    for (const taskData of tasks) {
      // Upsert task by slug
      await prisma.task.upsert({
        where: { slug: taskData.slug },
        update: {
          name: taskData.name,
          description: taskData.description ?? null,
          sortOrder: taskData.sortOrder,
          isActive: true,
          categoryId: category.id,
        },
        create: {
          ...taskData,
          isActive: true,
          categoryId: category.id,
        },
      });

      taskCount += 1;
    }
  }

  console.log(
    `✅  Seed complete — ${categoryCount} categories, ${taskCount} tasks.`,
  );
}

main()
  .catch((err) => {
    console.error("❌  Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
