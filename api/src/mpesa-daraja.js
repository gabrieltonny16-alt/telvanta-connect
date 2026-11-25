import { Buffer } from 'node:buffer';

const KENYAN_MSISDN = /^(?:\\+?254|0)?([17]\\d{8})$/;

export function normalizeKenyanPhone(value) {
  const compact = String(value ?? '').replace(/[\s()-]/g, '');
  const match = compact.match(KENYAN_MSISDN);
  if (!match) throw new Error('Enter a valid Kenyan mobile number');
  return '254' + match[1];
}

export function darajaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + values.month + values.day + values.hour + values.minute + values.second;
}

export function buildStkPassword(shortCode, passkey, timestamp) {
  if (!shortCode || !passkey || !/^\d{14}$/.test(String(timestamp))) {
    throw new Error('M-PESA shortcode, passkey and timestamp are required');
  }
  return Buffer.from(String(shortCode) + String(passkey) + String(timestamp)).toString('base64');
}

function required(env, key) {
  const value = String(env[key] ?? '').trim();
  if (!value) throw new Error('Missing M-PESA configuration: ' + key);
  return value;
}

export function createDarajaClient({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const environment = String(env.MPESA_ENV || 'sandbox').toLowerCase();
  if (!['sandbox', 'production'].includes(environment)) throw new Error('MPESA_ENV must be sandbox or production');
  if (environment === 'production' && env.MPESA_LIVE_ENABLED !== 'true') {
    throw new Error('Live M-PESA is locked. Set MPESA_LIVE_ENABLED=true only after an approved live test');
  }
  const baseUrl = environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  let cachedToken;
  let tokenExpiresAt = 0;

  async function accessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
    const key = required(env, 'MPESA_CONSUMER_KEY');
    const secret = required(env, 'MPESA_CONSUMER_SECRET');
    const response = await fetchImpl(baseUrl + '/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'), Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new Error('Could not obtain M-PESA access token');
    cachedToken = String(payload.access_token);
    tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000;
    return cachedToken;
  }

  async function stkPush({ phone, amountKes, accountReference, description, callbackUrl }) {
    const msisdn = normalizeKenyanPhone(phone);
    const amount = Number(amountKes);
    const maxAmount = Number(env.MPESA_MAX_AMOUNT_KES || 1000);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > maxAmount) {
      throw new Error('Amount must be a whole KES amount between 1 and ' + maxAmount);
    }
    let callback;
    try { callback = new URL(String(callbackUrl || '')); } catch {}
    if (callback?.protocol !== 'https:') throw new Error('A public HTTPS callback URL is required');
    const shortCode = required(env, 'MPESA_SHORTCODE');
    const tillNumber = required(env, 'MPESA_TILL_NUMBER');
    const passkey = required(env, 'MPESA_PASSKEY');
    const timestamp = darajaTimestamp(now());
    const token = await accessToken();
    const body = {
      BusinessShortCode: shortCode,
      Password: buildStkPassword(shortCode, passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
      Amount: amount,
      PartyA: msisdn,
      PartyB: tillNumber,
      PhoneNumber: msisdn,
      CallBackURL: callback.toString(),
      AccountReference: String(accountReference || 'BINGWAPULSE').slice(0, 12),
      TransactionDesc: String(description || 'BingwaPulse order').slice(0, 13)
    };
    const response = await fetchImpl(baseUrl + '/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.CheckoutRequestID) {
      const error = new Error('M-PESA did not accept the STK Push request');
      error.providerResponseCode = payload.errorCode || payload.ResponseCode || null;
      throw error;
    }
    return {
      merchantRequestId: payload.MerchantRequestID || null,
      checkoutRequestId: payload.CheckoutRequestID,
      customerMessage: payload.CustomerMessage || 'Payment prompt sent',
      status: 'PENDING'
    };
  }

  return { environment, accessToken, stkPush };
}

export function parseStkCallback(body) {
  const callback = body?.Body?.stkCallback;
  if (!callback || typeof callback !== 'object' || !callback.CheckoutRequestID) {
    throw new Error('Invalid M-PESA STK callback');
  }
  const items = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
  const metadata = Object.fromEntries(items.map(item => [String(item.Name), item.Value]));
  const success = Number(callback.ResultCode) === 0;
  return {
    checkoutRequestId: String(callback.CheckoutRequestID),
    merchantRequestId: callback.MerchantRequestID ? String(callback.MerchantRequestID) : null,
    resultCode: Number(callback.ResultCode),
    resultDescription: String(callback.ResultDesc || ''),
    status: success ? 'PAID' : 'FAILED',
    receiptNumber: success && metadata.MpesaReceiptNumber ? String(metadata.MpesaReceiptNumber) : null,
    amountKes: success && metadata.Amount != null ? Number(metadata.Amount) : null,
    phone: success && metadata.PhoneNumber != null ? String(metadata.PhoneNumber) : null,
    transactionDate: success && metadata.TransactionDate != null ? String(metadata.TransactionDate) : null
  };
}
