# BingwaPulse Integration Contract — v1

This document defines boundaries between Android, Web and Connect. It is a design contract, not evidence that remote synchronization or production security is already implemented.

## Product ownership
- Android owns the offline-first mobile business workflow and its local SQLite store.
- Web owns the browser workspace. Browser-local records are isolated from Android until an authenticated backend exists.
- Connect owns device pairing, trust, transport and synchronization orchestration. It does not own payment or fulfilment truth.
- A future backend must be the authority for account identity, tenant permissions, synchronization receipts and provider-confirmed payment/fulfilment events.

## Shared record envelope
Every synchronized operation must eventually carry:
- `schema_version`: integer, currently proposed as 1.
- `operation_id`: globally unique UUID generated once on the originating device.
- `tenant_id` and `actor_id`: server-issued identities, never inferred from a display name.
- `device_id`: enrolled device identity.
- `entity_type`, `entity_id`, `operation`.
- `created_at`: UTC timestamp from the originating device, treated as advisory.
- `payload`: versioned entity fields.
- `integrity`: authenticated transport/signature metadata, not a client-supplied trust claim.

## Conflict and replay rules
1. Deduplicate by tenant + operation_id.
2. Never use last-write-wins for payment, transaction, order fulfilment or ledger facts.
3. Conflicting financial/status changes are quarantined for review.
4. Device timestamps are not sufficient evidence of payment or delivery.
5. A timeout after a request may have reached a provider becomes UNKNOWN; reconcile before retry.
6. Revoke device credentials server-side and reject subsequent sync requests.

## Status vocabulary
- Payment: UNMATCHED, PENDING, VERIFIED, REVERSED, DISPUTED, UNKNOWN.
- Fulfilment: NOT_STARTED, QUEUED, CLAIMED, IN_PROGRESS, DELIVERED, FAILED, UNKNOWN.
- Local-only manual records must remain explicitly UNVERIFIED.

## Security boundaries
- Never store M-PESA PINs, API secrets or long-lived bearer tokens in local records or source control.
- Pairing must be mutually authenticated, encrypted, short-lived and explicitly approved on both devices.
- Tenant and role authorization must be enforced server-side on every request.
- No live provider operation is permitted in prototype or test mode.
- All production sync requires threat modelling, key rotation, audit logging and security review.

## Compatibility
Changes to field meaning or status values require a schema version change and migration notes. Unknown enum values must fail closed and be surfaced for review.
