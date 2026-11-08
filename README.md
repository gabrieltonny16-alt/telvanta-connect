# BingwaPulse

**Your Bundles. Your Business. Automated.**

This project is delivered through three coordinated repositories:

- **Android** — native, offline-first business operations.
- **Connect** — device trust, pairing and synchronization services.
- **Web** — browser workspace.

The Connect repository hosts the shared API service used by the clients.

## Current implementation status
- Android local business workflows and SQLite persistence.
- Web local-first workspace.
- Connect consent-state core with automated tests.
- Shared API with tenant-scoped accounts, short-lived sessions, revision-checked sync, idempotency and pull cursors.
- No live payment collection, SMS, USSD or automatic bundle fulfilment.

## Start the shared API
See [API setup](api/README.md). Local development uses PostgreSQL via Docker Compose.

## Client integration status
The shared API is now available as a service contract. Android and Web still require authenticated client adapters and account/sync UI before records can move between devices. The Kotlin pairing core does not itself establish a cryptographic nearby connection.

## Safety
Client-created transaction records are unverified notes. Clients cannot claim payment or fulfilment verification. Never store M-PESA PINs or API secrets in app data or source control.
