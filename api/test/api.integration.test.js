import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL);
const secret = 'integration-test-secret-at-least-32-bytes-long';
const { Pool } = pg;
let pool;
let server;
let base;

before(async () => {
  if (!enabled) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const migration = await readFile(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  const app = createApp({ pool, env: { JWT_SECRET: secret, CORS_ORIGINS: 'http://localhost:5173' } });
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

test('API enforces tenant-scoped idempotent revision sync', { skip: !enabled }, async () => {
  await pool.query('TRUNCATE sync_events,sync_operations,sync_records,users,tenants RESTART IDENTITY CASCADE');
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }
    });
    return { status: response.status, body: await response.json() };
  };

  const accountA = await call('/v1/auth/register', { method:'POST', body:JSON.stringify({
    displayName:'Owner A',tenantName:'Business A',email:'owner-a@example.com',password:'very-long-test-password-123'
  }) });
  const accountB = await call('/v1/auth/register', { method:'POST', body:JSON.stringify({
    displayName:'Owner B',tenantName:'Business B',email:'owner-b@example.com',password:'very-long-test-password-456'
  }) });
  assert.equal(accountA.status,201);
  assert.equal(accountB.status,201);

  const entityId = randomUUID();
  const operationId = randomUUID();
  const operation = { operationId,entityType:'offer',entityId,action:'upsert',expectedRevision:null,payload:{name:'1GB bundle',category:'Data',priceKes:101} };
  const first = await call('/v1/sync/push',{method:'POST',token:accountA.body.token,body:JSON.stringify({operations:[operation]})});
  assert.equal(first.status,200);
  assert.equal(first.body.results[0].outcome,'APPLIED');
  assert.equal(first.body.results[0].serverRevision,1);

  const replay = await call('/v1/sync/push',{method:'POST',token:accountA.body.token,body:JSON.stringify({operations:[operation]})});
  assert.equal(replay.body.results[0].replayed,true);

  const conflict = await call('/v1/sync/push',{method:'POST',token:accountA.body.token,body:JSON.stringify({operations:[{...operation,operationId:randomUUID(),payload:{name:'stale write'}}]})});
  assert.equal(conflict.body.results[0].outcome,'CONFLICT');
  assert.equal(conflict.body.results[0].serverRevision,1);

  const pullA = await call('/v1/sync/pull?after=0',{token:accountA.body.token});
  assert.equal(pullA.body.events.length,1);
  assert.equal(pullA.body.events[0].entityId,entityId);
  const pullB = await call('/v1/sync/pull?after=0',{token:accountB.body.token});
  assert.equal(pullB.body.events.length,0);

  const forbidden = await call('/v1/sync/push',{method:'POST',token:accountA.body.token,body:JSON.stringify({operations:[{...operation,operationId:randomUUID(),entityId:randomUUID(),payload:{status:'VERIFIED'}}]})});
  assert.equal(forbidden.status,400);
  const unauthorized = await call('/v1/sync/pull?after=0');
  assert.equal(unauthorized.status,401);
});
