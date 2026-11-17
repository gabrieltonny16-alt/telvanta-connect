import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const pool = {
  async query() { return { rowCount: 0, rows: [] }; },
  async connect() { throw new Error('Database connection should not be used in these validation tests'); }
};

async function withServer(run) {
  const app = createApp({ pool, env: { JWT_SECRET: 'test-secret-with-at-least-32-bytes-long' } });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { await run('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('OTP request validates email and mode before calling a provider', async () => {
  await withServer(async base => {
    let response = await fetch(base + '/v1/auth/otp/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', mode: 'login' })
    });
    assert.equal(response.status, 400);
    response = await fetch(base + '/v1/auth/otp/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', mode: 'unknown' })
    });
    assert.equal(response.status, 400);
    response = await fetch(base + '/v1/auth/otp/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', mode: 'login' })
    });
    assert.equal(response.status, 503);
  });
});

test('OTP verification requires exactly six digits and configured Auth', async () => {
  await withServer(async base => {
    let response = await fetch(base + '/v1/auth/otp/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', code: '12345', mode: 'login' })
    });
    assert.equal(response.status, 400);
    response = await fetch(base + '/v1/auth/otp/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', code: '123456', mode: 'login' })
    });
    assert.equal(response.status, 503);
  });
});
