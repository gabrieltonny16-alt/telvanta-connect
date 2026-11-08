CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','manager','staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_records (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('offer','customer','order','transaction_note')),
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL REFERENCES users(id),
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_operations (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('APPLIED','CONFLICT','REJECTED')),
  server_revision BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation_id)
);

CREATE TABLE IF NOT EXISTS sync_events (
  sequence BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL,
  revision BIGINT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  actor_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_events_tenant_sequence ON sync_events(tenant_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sync_records_tenant_updated ON sync_records(tenant_id, updated_at DESC);
