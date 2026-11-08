# BingwaPulse Connect

BingwaPulse Connect provides device trust, pairing and the shared synchronization API for the Android and Web workspaces.

## Implemented
- Consent-first Kotlin pairing state machine with short expiry, scoped approval, rejection, revocation and tests.
- Shared Node.js API with PostgreSQL persistence.
- Tenant-isolated account registration and login.
- Salted scrypt password hashing and short-lived signed bearer sessions.
- Revision-checked, idempotent sync operations and tenant-scoped pull cursors.
- API-side rejection of client claims that a payment is verified or a bundle is delivered.

## Run the API locally
Requirements: Node.js 22+ and Docker Compose.

1. Copy `.env.example` to `.env` and set a unique random `JWT_SECRET` of at least 32 bytes.
2. Start PostgreSQL: `docker compose up -d db`.
3. Install dependencies: `cd api && npm install`.
4. Start: `npm run dev`.

The API listens on port 8080. See [API request and deployment guide](api/README.md).

## Client integration
Android and Web now include API account and synchronization adapters. Configure both to use the same deployed HTTPS API and account/tenant. End-to-end device testing against a deployed database is still required.

## Security boundary
The pairing state machine is not a cryptographic transport and does not establish a nearby connection yet. Production deployment still requires HTTPS, managed secrets, backups, monitoring, email verification, password reset, refresh-token rotation, audit retention and threat modelling. No live payment or fulfilment provider is connected.
