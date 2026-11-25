const AT_ENDPOINT = 'https://api.africastalking.com/version1/messaging';

export function normalizeSmsRecipient(value) {
  const compact = String(value ?? '').replace(/[\s()-]/g, '');
  if (/^0[17]\d{8}$/.test(compact)) return '+254' + compact.slice(1);
  if (/^254[17]\d{8}$/.test(compact)) return '+' + compact;
  if (/^\+254[17]\d{8}$/.test(compact)) return compact;
  throw new Error('Enter a valid Kenyan mobile number');
}

export function createSmsClient({ env = process.env, fetchImpl = fetch } = {}) {
  const mode = String(env.SMS_MODE || 'disabled').toLowerCase();
  if (!['disabled', 'test', 'live'].includes(mode)) throw new Error('SMS_MODE must be disabled, test or live');
  const allowlist = new Set(String(env.SMS_TEST_ALLOWLIST || '').split(',').map(x => x.trim()).filter(Boolean));

  async function send({ to, message }) {
    const recipient = normalizeSmsRecipient(to);
    const text = String(message ?? '').trim();
    if (!text || text.length > 480) throw new Error('SMS message must contain 1 to 480 characters');
    if (mode === 'disabled') throw new Error('SMS sending is disabled');
    if (mode === 'test') return { mode, accepted: false, simulated: true, recipient };
    if (!allowlist.has(recipient)) throw new Error('Recipient is not on the approved live SMS test allowlist');

    const username = String(env.AT_USERNAME || '').trim();
    const apiKey = String(env.AT_API_KEY || '').trim();
    if (!username || !apiKey) throw new Error('Africa\\'s Talking credentials are not configured');
    const form = new URLSearchParams({ username, to: recipient, message: text });
    if (env.AT_SENDER_ID) form.set('from', String(env.AT_SENDER_ID));
    const response = await fetchImpl(AT_ENDPOINT, {
      method: 'POST',
      headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    const recipients = payload.SMSMessageData?.Recipients;
    if (!response.ok || !Array.isArray(recipients) || recipients.length !== 1 || Number(recipients[0].statusCode) !== 101) {
      throw new Error('SMS provider did not accept the message');
    }
    return { mode, accepted: true, simulated: false, recipient, providerMessageId: recipients[0].messageId || null };
  }

  return { mode, send };
}
