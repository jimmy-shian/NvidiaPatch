import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { initDatabase, closeDatabase } = require('../../database/database');
const { createGatewayApp } = require('../../gateway');

const TEST_DB = path.join(__dirname, 'routes-test.db');

describe('Express API Routes Integration Tests', () => {
  let app;

  beforeAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDatabase(TEST_DB);
    app = createGatewayApp();
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should set x-request-id on response header', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.body.status).toBe('running');
  });

  it('should get OpenAI models list via /v1/models', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should check health status via /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.metrics).toBeDefined();
  });

  it('should manage API keys via /api/keys', async () => {
    // Add key
    const addRes = await request(app)
      .post('/api/keys')
      .set('Authorization', 'Bearer bypass')
      .send({ key: 'nvapi-route-test-key-12345678' });
    expect(addRes.status).toBe(200);
    expect(addRes.body.success).toBe(true);

    // List keys
    const listRes = await request(app)
      .get('/api/keys')
      .set('Authorization', 'Bearer bypass');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThan(0);
    expect(listRes.body[0].masked_key).toContain('...');
  });

  it('should read and update settings via /api/settings', async () => {
    const getRes = await request(app)
      .get('/api/settings')
      .set('Authorization', 'Bearer bypass');
    expect(getRes.status).toBe(200);
    expect(getRes.body.ROUND_DELAY_MS).toBeDefined();

    const postRes = await request(app)
      .post('/api/settings')
      .set('Authorization', 'Bearer bypass')
      .send({ ROUND_DELAY_MS: 12 });
    expect(postRes.status).toBe(200);
    expect(postRes.body.ROUND_DELAY_MS).toBe(12);
  });

  it('should manage rules via /api/rules', async () => {
    const addRes = await request(app)
      .post('/api/rules')
      .set('Authorization', 'Bearer bypass')
      .send({ title: 'Route Rule', content: 'Act as a senior engineer' });
    expect(addRes.status).toBe(200);
    expect(addRes.body.success).toBe(true);

    const listRes = await request(app)
      .get('/api/rules')
      .set('Authorization', 'Bearer bypass');
    expect(listRes.status).toBe(200);
    expect(listRes.body.some(r => r.title === 'Route Rule')).toBe(true);
  });
});
