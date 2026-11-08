export const ENTITY_TYPES = new Set(['offer','customer','order','transaction_note']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateRegistration(body = {}) {
  const displayName = String(body.displayName || '').trim();
  const tenantName = String(body.tenantName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (displayName.length < 2 || displayName.length > 80) throw new Error('Display name must be 2–80 characters');
  if (tenantName.length < 2 || tenantName.length > 120) throw new Error('Business name must be 2–120 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address');
  if (password.length < 12 || password.length > 200) throw new Error('Password must be at least 12 characters');
  return { displayName, tenantName, email, password };
}
export function validateOperation(input = {}) {
  const operationId = input.operationId;
  if (!UUID.test(operationId || '') || !UUID.test(input.entityId || '')) throw new Error('Operation and entity IDs must be UUIDs');
  if (!ENTITY_TYPES.has(input.entityType)) throw new Error('Unsupported entity type');
  if (!['upsert','delete'].includes(input.action)) throw new Error('Unsupported operation');
  if (input.entityType === 'transaction_note' && input.action !== 'upsert') throw new Error('Transaction notes are immutable');
  const payload = input.payload ?? {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 32_000) throw new Error('Payload must be a JSON object under 32KB');
  const status = String(payload.status || '').toUpperCase();
  if (['VERIFIED','DELIVERED','PAYMENT_VERIFIED','FULFILMENT_CONFIRMED'].includes(status)) throw new Error('Client devices cannot assert verified payment or delivery');
  const expectedRevision = input.expectedRevision ?? null;
  if (expectedRevision !== null && (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 1)) throw new Error('Invalid expected revision');
  return { operationId, entityType: input.entityType, entityId: input.entityId, action: input.action, payload, expectedRevision };
}
