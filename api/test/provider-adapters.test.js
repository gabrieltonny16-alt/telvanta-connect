import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKenyanPhone, darajaTimestamp, buildStkPassword, createDarajaClient, parseStkCallback } from '../src/mpesa-daraja.js';
import { normalizeSmsRecipient, createSmsClient } from '../src/sms.js';

test('normalizes Kenyan mobile numbers', () => {
  assert.equal(normalizeKenyanPhone('0712345678'), '254712345678');
  assert.equal(normalizeKenyanPhone('+254 712 345 678'), '254712345678');
  assert.equal(normalizeSmsRecipient('0712345678'), '+254712345678');
  assert.throws(() => normalizeKenyanPhone('12345'));
});

test('builds deterministic Daraja timestamp and password', () => {
  assert.equal(darajaTimestamp(new Date('2026-11-25T12:34:56Z')), '20261125123456');
  assert.equal(buildStkPassword('174379', 'pass', '20261125123456'), Buffer.from('174379pass20261125123456').toString('base64'));
});

test('production M-PESA is locked by default', () => {
  assert.throws(() => createDarajaClient({ env: { MPESA_ENV: 'production' } }), /locked/);
});

test('STK acknowledgement is pending, not proof of payment', async () => {
  const fakeFetch = async url => url.includes('/oauth/')
    ? { ok: true, json: async () => ({ access_token: 'token', expires_in: '3600' }) }
    : { ok: true, json: async () => ({ CheckoutRequestID: 'checkout-1' }) };
  const client = createDarajaClient({ env: {
    MPESA_ENV: 'sandbox', MPESA_CONSUMER_KEY: 'key', MPESA_CONSUMER_SECRET: 'secret',
    MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'pass', MPESA_MAX_AMOUNT_KES: '100'
  }, fetchImpl: fakeFetch });
  const result = await client.stkPush({ phone: '0712345678', amountKes: 10, callbackUrl: 'https://example.test/callback' });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.checkoutRequestId, 'checkout-1');
  await assert.rejects(() => client.stkPush({ phone: '0712345678', amountKes: 101, callbackUrl: 'https://example.test/callback' }), /Amount/);
});

test('parses only structured STK callbacks', () => {
  const result = parseStkCallback({ Body: { stkCallback: {
    CheckoutRequestID: 'checkout-1', ResultCode: 0, CallbackMetadata: { Item: [
      { Name: 'Amount', Value: 10 }, { Name: 'MpesaReceiptNumber', Value: 'QAB123' }
    ] }
  } } });
  assert.equal(result.status, 'PAID');
  assert.equal(result.receiptNumber, 'QAB123');
  assert.throws(() => parseStkCallback({}));
});

test('SMS test mode never makes a network request and live mode enforces allowlist', async () => {
  let calls = 0;
  const testClient = createSmsClient({ env: { SMS_MODE: 'test' }, fetchImpl: async () => { calls++; } });
  assert.equal((await testClient.send({ to: '0712345678', message: 'test' })).simulated, true);
  assert.equal(calls, 0);
  const liveClient = createSmsClient({ env: {
    SMS_MODE: 'live', SMS_TEST_ALLOWLIST: '+254712345678', AT_USERNAME: 'sandbox', AT_API_KEY: 'secret'
  }, fetchImpl: async () => ({ ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }) }) });
  assert.equal((await liveClient.send({ to: '0712345678', message: 'approved' })).accepted, true);
  await assert.rejects(() => liveClient.send({ to: '0722222222', message: 'blocked' }), /allowlist/);
});
