# BingwaPulse API v1

Base URL: `https://your-api-host`.

## Register
`POST /v1/auth/register`
```json
{"displayName":"Gabriel","tenantName":"Gabriel's Network Services","email":"owner@example.com","password":"use-a-long-unique-password"}
```
Returns a one-hour bearer token and tenant/user identities. Registration creates an isolated tenant.

## Login
`POST /v1/auth/login`
```json
{"email":"owner@example.com","password":"use-the-account-password"}
```

## Push local changes
`POST /v1/sync/push` with `Authorization: Bearer <token>`.
```json
{"operations":[{"operationId":"123e4567-e89b-42d3-a456-426614174001","entityType":"offer","entityId":"123e4567-e89b-42d3-a456-426614174000","action":"upsert","expectedRevision":null,"payload":{"name":"1GB · 24 hours","category":"Data","priceKes":101}}]}
```
A first write uses `expectedRevision: null`; an update must send the last server revision. Replays of the same operation ID are idempotent. Conflicting revisions return `CONFLICT`; the client must retain both versions for review.

## Pull changes
`GET /v1/sync/pull?after=0&limit=100` with the bearer token. Persist `nextCursor` only after applying every event in the response.

## Entity rules
Allowed entity types: `offer`, `customer`, `order`, `transaction_note`. Transaction notes are immutable. A client cannot assert verified payment or delivered fulfilment. Payment and fulfilment confirmation must come from an authorized provider integration in a later phase.

## Provider adapter groundwork

The provider adapters are deliberately not wired to public routes yet. They are unit-testable modules with safe defaults:

- M-PESA defaults to Daraja sandbox. Production is blocked unless `MPESA_ENV=production` and `MPESA_LIVE_ENABLED=true` are both explicitly set. STK acceptance is always `PENDING`; only a validated, persisted callback may confirm payment.
- SMS defaults to `SMS_MODE=disabled`. `test` mode simulates without network access. `live` mode requires Africa's Talking credentials and an exact `SMS_TEST_ALLOWLIST` recipient match.
- Do not add secrets to source control. Configure provider credentials only in the hosting environment's secret store.
- These adapters do not yet create OTP records, persist payment intents, process callbacks, or fulfil orders. Those steps require the database migration and route layer, which must be reviewed and applied separately.

## Tenant isolation
Tenant identity is taken only from the signed session, never from a request body. All reads and writes are scoped by that tenant. Client-provided tenant IDs are ignored.
