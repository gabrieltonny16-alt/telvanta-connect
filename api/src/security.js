import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
const b64 = value => Buffer.from(value).toString('base64url');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('base64url')}:${Buffer.from(derived).toString('base64url')}`;
}
export async function verifyPassword(password, stored) {
  const [scheme, saltText, hashText] = String(stored).split(':');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function signToken(claims, secret, ttlSeconds = 3600) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}
export function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(unsigned).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'HS256' || !claims.sub || !claims.tenantId || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('Expired or invalid token');
  return claims;
}
