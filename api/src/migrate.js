import pg from 'pg';
import { readFile } from 'node:fs/promises';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined });
try {
  const migration = await readFile(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  process.stdout.write('BingwaPulse database migration complete\n');
} finally { await pool.end(); }
