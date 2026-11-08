import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { hashPassword, verifyPassword, signToken, verifyToken } from './security.js';
import { validateRegistration, validateOperation } from './validation.js';

export function createApp({ pool, env = process.env }) {
  const app = express();
  const origins = String(env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin(origin, cb) { if (!origin || origins.includes(origin)) return cb(null, true); cb(new Error('Origin not allowed')); }, allowedHeaders: ['Content-Type','Authorization'], methods: ['GET','POST','OPTIONS'] }));
  app.use(express.json({ limit: '256kb', strict: true }));

  const auth = async (req, res, next) => {
    try {
      const [kind, token] = String(req.headers.authorization || '').split(' ');
      if (kind !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });
      req.auth = verifyToken(token, env.JWT_SECRET);
      const user = await pool.query('SELECT id,tenant_id,display_name,email,role FROM users WHERE id=$1 AND tenant_id=$2', [req.auth.sub, req.auth.tenantId]);
      if (!user.rowCount) return res.status(401).json({ error: 'Account no longer exists' });
      req.user = user.rows[0];
      next();
    } catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
  };

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'bingwapulse-api', database: 'connected' }); }
    catch { res.status(503).json({ status: 'unavailable', service: 'bingwapulse-api' }); }
  });

  app.post('/v1/auth/register', authLimiter, async (req, res) => {
    let input;
    try { input = validateRegistration(req.body); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await client.query('INSERT INTO tenants(name) VALUES($1) RETURNING id,name', [input.tenantName]);
      const passwordHash = await hashPassword(input.password);
      const user = await client.query('INSERT INTO users(tenant_id,display_name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,tenant_id,display_name,email,role', [tenant.rows[0].id,input.displayName,input.email,passwordHash]);
      await client.query('COMMIT');
      const u = user.rows[0];
      const token = signToken({ sub: u.id, tenantId: u.tenant_id, role: u.role }, env.JWT_SECRET);
      res.status(201).json({ token, user: { id:u.id,tenantId:u.tenant_id,displayName:u.display_name,email:u.email,role:u.role }, tenant: { id:tenant.rows[0].id,name:tenant.rows[0].name }, expiresIn:3600 });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
      res.status(500).json({ error: 'Could not create account' });
    } finally { client.release(); }
  });

  app.post('/v1/auth/login', authLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const result = await pool.query('SELECT u.id,u.tenant_id,u.display_name,u.email,u.role,u.password_hash,t.name AS tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=$1', [email]);
    const u = result.rows[0];
    if (!u || !(await verifyPassword(password,u.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect' });
    const token = signToken({ sub:u.id,tenantId:u.tenant_id,role:u.role }, env.JWT_SECRET);
    res.json({ token,user:{id:u.id,tenantId:u.tenant_id,displayName:u.display_name,email:u.email,role:u.role},tenant:{id:u.tenant_id,name:u.tenant_name},expiresIn:3600 });
  });

  app.get('/v1/me', auth, (req,res) => res.json({ user:req.user }));

  app.post('/v1/sync/push', auth, async (req,res) => {
    const operations = req.body?.operations;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) return res.status(400).json({ error: 'Send between 1 and 100 operations' });
    const normalized = [];
    try { for (const op of operations) normalized.push(validateOperation(op)); }
    catch (e) { return res.status(400).json({ error:e.message }); }
    const client = await pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');
      for (const op of normalized) {
        const prior = await client.query('SELECT outcome,server_revision FROM sync_operations WHERE tenant_id=$1 AND operation_id=$2', [req.user.tenant_id,op.operationId]);
        if (prior.rowCount) { results.push({ operationId:op.operationId,outcome:prior.rows[0].outcome,serverRevision:prior.rows[0].server_revision,replayed:true }); continue; }
        const current = await client.query('SELECT revision,payload,deleted FROM sync_records WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE', [req.user.tenant_id,op.entityType,op.entityId]);
        const row = current.rows[0];
        const expected = op.expectedRevision;
        const isConflict = row ? expected !== Number(row.revision) : expected !== null;
        if (isConflict) {
          await client.query('INSERT INTO sync_operations(tenant_id,operation_id,entity_type,entity_id,outcome,server_revision) VALUES($1,$2,$3,$4,$5,$6)', [req.user.tenant_id,op.operationId,op.entityType,op.entityId,'CONFLICT',row.revision]);
          results.push({ operationId:op.operationId,outcome:'CONFLICT',serverRevision:row ? Number(row.revision) : null });
          continue;
        }
        const revision = row ? Number(row.revision)+1 : 1;
        const deleted = op.action === 'delete';
        const payload = deleted ? (row?.payload || {}) : op.payload;
        await client.query(`INSERT INTO sync_records(tenant_id,entity_type,entity_id,payload,revision,deleted,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,deleted=EXCLUDED.deleted,updated_at=now(),updated_by=EXCLUDED.updated_by`,
          [req.user.tenant_id,op.entityType,op.entityId,payload,revision,deleted,req.user.id]);
        await client.query('INSERT INTO sync_events(tenant_id,entity_type,entity_id,payload,revision,deleted,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [req.user.tenant_id,op.entityType,op.entityId,payload,revision,deleted,req.user.id]);
        await client.query('INSERT INTO sync_operations(tenant_id,operation_id,entity_type,entity_id,outcome,server_revision) VALUES($1,$2,$3,$4,$5,$6)', [req.user.tenant_id,op.operationId,op.entityType,op.entityId,'APPLIED',revision]);
        results.push({ operationId:op.operationId,outcome:'APPLIED',serverRevision:revision });
      }
      await client.query('COMMIT');
      res.json({ results });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error:'Synchronization failed; retry using the same operation IDs' });
    } finally { client.release(); }
  });

  app.get('/v1/sync/pull', auth, async (req,res) => {
    const after = Number(req.query.after || 0);
    const limit = Math.min(500,Math.max(1,Number(req.query.limit || 100)));
    if (!Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error:'Invalid cursor' });
    const result = await pool.query('SELECT sequence,entity_type,entity_id,payload,revision,deleted,created_at FROM sync_events WHERE tenant_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3', [req.user.tenant_id,after,limit]);
    const events = result.rows.map(r=>({ cursor:Number(r.sequence),entityType:r.entity_type,entityId:r.entity_id,payload:r.payload,revision:Number(r.revision),deleted:r.deleted,createdAt:r.created_at }));
    res.json({ events, nextCursor:events.length ? events[events.length-1].cursor : after, hasMore:events.length===limit });
  });

  app.use((err,_req,res,_next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error:'Invalid JSON body' });
    if (err?.message === 'Origin not allowed') return res.status(403).json({ error:'Origin not allowed' });
    res.status(500).json({ error:'Unexpected server error' });
  });
  return app;
}
