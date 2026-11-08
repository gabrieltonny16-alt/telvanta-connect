import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../src/security.js';
import { validateRegistration, validateOperation } from '../src/validation.js';

const secret = 'test-secret-that-is-long-enough-for-hmac-256';

test('password hashes are salted and verify correctly', async () => {
  const a = await hashPassword('a-strong-test-password');
  const b = await hashPassword('a-strong-test-password');
  assert.notEqual(a,b);
  assert.equal(await verifyPassword('a-strong-test-password',a),true);
  assert.equal(await verifyPassword('wrong-password',a),false);
});
test('signed session token validates and rejects tampering', () => {
  const token = signToken({sub:'user-1',tenantId:'tenant-1',role:'owner'},secret);
  assert.equal(verifyToken(token,secret).tenantId,'tenant-1');
  assert.throws(()=>verifyToken(token+'x',secret));
});
test('registration enforces valid identity and a long password', () => {
  assert.throws(()=>validateRegistration({displayName:'A',tenantName:'Shop',email:'a@b.com',password:'short'}));
  const valid=validateRegistration({displayName:'Gabriel',tenantName:'My Shop',email:'OWNER@example.com',password:'a-long-secure-password'});
  assert.equal(valid.email,'owner@example.com');
});
test('sync operation validation rejects verified claims and unsafe transaction edits', () => {
  const entityId='123e4567-e89b-42d3-a456-426614174000';
  assert.throws(()=>validateOperation({entityId,entityType:'order',action:'upsert',payload:{status:'VERIFIED'}}));
  assert.throws(()=>validateOperation({entityId,entityType:'transaction_note',action:'delete',payload:{}}));
  assert.equal(validateOperation({operationId:'123e4567-e89b-42d3-a456-426614174001',entityId,entityType:'offer',action:'upsert',payload:{name:'1GB'}}).expectedRevision,null);
});
