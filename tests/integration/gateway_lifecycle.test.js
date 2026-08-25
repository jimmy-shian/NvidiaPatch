import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { initDatabase, closeDatabase } = require('../../database/database');
const { createGatewayApp, closeGatewayResources, startGatewayResources } = require('../../gateway');

const TEST_DB = path.join(__dirname, 'lifecycle-test.db');
const TEST_PORT = 4199;

describe('Gateway Server Lifecycle Integration Tests', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDatabase(TEST_DB);
  });

  afterAll(() => {
    closeGatewayResources();
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should start gateway server and accept HTTP requests', async () => {
    startGatewayResources();
    const app = createGatewayApp();
    
    let server = null;
    await new Promise((resolve, reject) => {
      server = app.listen(TEST_PORT, '127.0.0.1', () => {
        resolve();
      });
      server.once('error', reject);
    });

    expect(server.listening).toBe(true);

    // Make an HTTP request to verify
    const responseBody = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    expect(responseBody.status).toBe('running');

    // Close server and release port
    await new Promise((resolve) => {
      closeGatewayResources();
      server.close(() => resolve());
    });

    expect(server.listening).toBe(false);
  });

  it('should release port completely so a new server can bind to the same port', async () => {
    // 1. Start First Server on TEST_PORT
    startGatewayResources();
    const app1 = createGatewayApp();
    let server1 = null;
    await new Promise((resolve, reject) => {
      server1 = app1.listen(TEST_PORT, '127.0.0.1', () => resolve());
      server1.once('error', reject);
    });
    expect(server1.listening).toBe(true);

    // 2. Stop First Server
    await new Promise((resolve) => {
      closeGatewayResources();
      server1.close(() => resolve());
    });

    // 3. Start Second Server on the exact same port without EADDRINUSE
    startGatewayResources();
    const app2 = createGatewayApp();
    let server2 = null;
    await new Promise((resolve, reject) => {
      server2 = app2.listen(TEST_PORT, '127.0.0.1', () => resolve());
      server2.once('error', reject);
    });
    expect(server2.listening).toBe(true);

    // 4. Clean up second server
    await new Promise((resolve) => {
      closeGatewayResources();
      server2.close(() => resolve());
    });
    expect(server2.listening).toBe(false);
  });
});
