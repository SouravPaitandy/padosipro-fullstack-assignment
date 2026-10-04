'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createApp } = require('../src/app');

const SECRET = 'test-jwt-secret-at-least-32-chars!!';

function buildPrisma(initialProfiles = {}) {
  const profiles = new Map(Object.entries(initialProfiles));

  const prisma = {
    _profiles: profiles,
    profile: {
      findUnique: async ({ where }) => {
        return profiles.get(where.userId) ?? null;
      },
      upsert: async ({ where, create, update, select }) => {
        let p = profiles.get(where.userId);
        if (p) {
          p = { ...p, ...update };
        } else {
          p = { id: crypto.randomUUID(), ...create };
        }
        profiles.set(where.userId, p);
        
        // Return only selected fields
        const out = {};
        if (select) {
          for (const k in select) {
            if (select[k]) out[k] = p[k];
          }
        } else {
          Object.assign(out, p);
        }
        return out;
      }
    }
  };
  return prisma;
}

function buildApp(prisma = buildPrisma()) {
  return createApp({ prisma, jwtSecret: SECRET });
}

function makeToken(sub) {
  return jwt.sign({ sub }, SECRET, { algorithm: 'HS256', expiresIn: 60 });
}

describe('Profile API', () => {
  describe('GET /api/v1/profile', () => {
    it('returns 401 for unauthenticated access', async () => {
      const res = await request(buildApp()).get('/api/v1/profile');
      expect(res.status).toBe(401);
    });

    it('returns { profile: null } when user has no profile', async () => {
      const res = await request(buildApp())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(crypto.randomUUID())}`);
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toBeNull();
    });

    it('returns the profile for the authenticated user', async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma({
        [userId]: { name: 'Alice', mobile: '9876543210', address: '123 St', businessName: null }
      });
      const res = await request(buildApp(prisma))
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(userId)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toEqual({
        name: 'Alice',
        mobile: '9876543210',
        address: '123 St',
        businessName: null
      });
    });
  });

  describe('PUT /api/v1/profile', () => {
    it('returns 401 for unauthenticated access', async () => {
      const res = await request(buildApp()).put('/api/v1/profile').send({
        name: 'Bob', mobile: '9999999999', address: '123 St'
      });
      expect(res.status).toBe(401);
    });

    it('creates a new profile with required fields and optional businessName', async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma();
      const res = await request(buildApp(prisma))
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(userId)}`)
        .send({ name: 'Bob', mobile: '9999999999', address: '123 St' });
      
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toEqual({
        name: 'Bob',
        mobile: '9999999999',
        address: '123 St',
        businessName: null
      });
      expect(prisma._profiles.has(userId)).toBe(true);
    });

    it('updates an existing profile via upsert', async () => {
      const userId = crypto.randomUUID();
      const prisma = buildPrisma({
        [userId]: { name: 'Alice', mobile: '9876543210', address: 'Old St', businessName: null }
      });
      
      const res = await request(buildApp(prisma))
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(userId)}`)
        .send({ name: 'Alice 2', mobile: '9876543210', address: 'New St', businessName: 'Corp' });
      
      expect(res.status).toBe(200);
      expect(res.body.data.profile.address).toBe('New St');
      expect(prisma._profiles.get(userId).businessName).toBe('Corp');
    });

    it('normalizes +91 and 10-digit mobile numbers', async () => {
      const userId = crypto.randomUUID();
      const res = await request(buildApp())
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(userId)}`)
        .send({ name: 'C', mobile: '+91 8888888888', address: 'A' });
      
      expect(res.status).toBe(200);
      expect(res.body.data.profile.mobile).toBe('8888888888');
    });

    it('rejects invalid mobile numbers (e.g. starting with 0-5) with 422', async () => {
      const userId = crypto.randomUUID();
      
      // Too short
      let res = await request(buildApp())
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(userId)}`)
        .send({ name: 'C', mobile: '123', address: 'A' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      
      // Starts with 5
      res = await request(buildApp())
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(userId)}`)
        .send({ name: 'C', mobile: '5999999999', address: 'A' });
      expect(res.status).toBe(422);
      expect(res.body.error.fields.mobile).toBeDefined();
    });
    
    it('[unit] isolates updates between two users based on JWT sub', async () => {
      const aliceId = crypto.randomUUID();
      const bobId = crypto.randomUUID();
      const prisma = buildPrisma({
        [aliceId]: { name: 'Alice', mobile: '9876543210', address: 'A', businessName: null }
      });
      
      // Bob tries to update Alice's profile by injecting her ID in body
      const res = await request(buildApp(prisma))
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${makeToken(bobId)}`)
        .send({ userId: aliceId, name: 'Bob', mobile: '9876543211', address: 'B' });
        
      expect(res.status).toBe(200);
      // Alice's profile should be untouched
      expect(prisma._profiles.get(aliceId).name).toBe('Alice');
      // Bob's profile should be created using his own JWT sub
      expect(prisma._profiles.get(bobId).name).toBe('Bob');
      expect(prisma._profiles.get(bobId).mobile).toBe('9876543211');
    });
  });
});
