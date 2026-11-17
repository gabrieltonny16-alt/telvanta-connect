import rateLimit from 'express-rate-limit';
import { signToken } from './security.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function supabaseConfig(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

async function supabaseAuth(config, path, body) {
  const response = await fetch(config.url + '/auth/v1/' + path, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Supabase Auth request failed');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function registerOtpRoutes(app, { pool, env }) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  });

  app.post('/v1/auth/otp/request', limiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const mode = String(req.body?.mode || '');
    if (!emailPattern.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (!['login', 'register'].includes(mode)) {
      return res.status(400).json({ error: 'Choose sign in or create account' });
    }
    if (mode === 'register') {
      const existing = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
      if (existing.rowCount) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    }
    const config = supabaseConfig(env);
    if (!config) return res.status(503).json({ error: 'Email verification is not configured on the API yet' });
    try {
      await supabaseAuth(config, 'otp', { email, create_user: true });
      return res.json({ message: 'If this address can be used, a six-digit verification code has been sent.' });
    } catch {
      return res.status(502).json({ error: 'Could not send the verification code. Check email delivery configuration and try again.' });
    }
  });

  app.post('/v1/auth/otp/verify', limiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const mode = String(req.body?.mode || '');
    const displayName = String(req.body?.displayName || '').trim();
    const tenantName = String(req.body?.tenantName || '').trim();
    if (!emailPattern.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit code' });
    if (!['login', 'register'].includes(mode)) return res.status(400).json({ error: 'Choose sign in or create account' });
    if (mode === 'register' && (displayName.length < 2 || displayName.length > 80 || tenantName.length < 2 || tenantName.length > 120)) {
      return res.status(400).json({ error: 'Enter your name and business name' });
    }
    const config = supabaseConfig(env);
    if (!config) return res.status(503).json({ error: 'Email verification is not configured on the API yet' });

    let verified;
    try {
      verified = await supabaseAuth(config, 'verify', { email, token: code, type: 'email' });
    } catch {
      return res.status(401).json({ error: 'The code is incorrect or expired. Request a new code and try again.' });
    }
    const authUser = verified?.user;
    const authUserId = String(authUser?.id || '');
    const verifiedEmail = String(authUser?.email || '').trim().toLowerCase();
    if (!authUserId || verifiedEmail !== email) return res.status(401).json({ error: 'Email verification could not be confirmed' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let found = await client.query(
        'SELECT id,tenant_id,display_name,email,role,auth_user_id FROM users WHERE lower(email)=lower($1) FOR UPDATE',
        [email]
      );
      let user;
      let tenantNameForResponse;
      if (found.rowCount) {
        user = found.rows[0];
        if (user.auth_user_id && user.auth_user_id !== authUserId) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'This email is already linked to another sign-in identity. Contact support.' });
        }
        await client.query(
          'UPDATE users SET auth_user_id=$1,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$2',
          [authUserId, user.id]
        );
        const tenant = await client.query('SELECT name FROM tenants WHERE id=$1', [user.tenant_id]);
        tenantNameForResponse = tenant.rows[0]?.name || '';
      } else {
        if (mode !== 'register') {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'No BingwaPulse account was found for this email. Create an account first.' });
        }
        const tenant = await client.query('INSERT INTO tenants(name) VALUES($1) RETURNING id,name', [tenantName]);
        const created = await client.query(
          'INSERT INTO users(tenant_id,display_name,email,password_hash,auth_user_id,email_verified_at) VALUES($1,$2,$3,NULL,$4,now()) RETURNING id,tenant_id,display_name,email,role,auth_user_id',
          [tenant.rows[0].id, displayName, email, authUserId]
        );
        user = created.rows[0];
        tenantNameForResponse = tenant.rows[0].name;
      }
      await client.query('COMMIT');
      const token = signToken({ sub: user.id, tenantId: user.tenant_id, role: user.role }, env.JWT_SECRET);
      return res.json({
        token,
        user: { id: user.id, tenantId: user.tenant_id, displayName: user.display_name, email: user.email, role: user.role },
        tenant: { id: user.tenant_id, name: tenantNameForResponse },
        expiresIn: 3600
      });
    } catch {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Could not complete sign in. Your existing business records were not changed.' });
    } finally {
      client.release();
    }
  });
}
