'use strict';

/**
 * Retrieves the profile for the given user ID.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 */
async function getProfile(prisma, userId) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: {
      name: true,
      mobile: true,
      address: true,
      businessName: true,
    }
  });
  return profile;
}

/**
 * Creates or updates the profile for the given user ID.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {object} data
 */
async function upsertProfile(prisma, userId, data) {
  const profile = await prisma.profile.upsert({
    where: { userId },
    update: {
      name: data.name,
      mobile: data.mobile,
      address: data.address,
      businessName: data.businessName,
    },
    create: {
      userId,
      name: data.name,
      mobile: data.mobile,
      address: data.address,
      businessName: data.businessName,
    },
    select: {
      name: true,
      mobile: true,
      address: true,
      businessName: true,
    }
  });
  return profile;
}

module.exports = {
  getProfile,
  upsertProfile,
};
