# BingwaPulse Connect

BingwaPulse Connect is the companion connectivity component for the Android and Web workspaces. It is responsible for authenticated nearby pairing, device trust, connection health and controlled synchronization—not for payments or bundle fulfilment.

## Current status
This repository now defines the first implementation contract. A production transport is **not yet enabled**. No device discovery, pairing, background sync or remote access should be represented as working until implemented and security-tested.

## Pairing requirements
1. Both devices explicitly enter pairing mode.
2. Pairing uses a short-lived, single-use challenge and user confirmation on both sides.
3. Establish a mutually authenticated encrypted session; never trust a device based on its name or proximity alone.
4. Grant narrow scopes and show exactly what data can be synchronized.
5. Support revoke, disconnect, expiry, replay protection and audit events.
6. Queue local changes offline; deduplicate by stable operation ID on reconciliation.
7. Surface conflicts for review rather than silently overwriting financial records.

## Non-goals
- No M-PESA PIN or payment credential handling.
- No automatic USSD, SMS or bundle purchases.
- No invisible device access or silent pairing.
- Nearby transport is not a substitute for internet connectivity between distant devices.

See [the integration contract](docs/INTEGRATION_CONTRACT.md).
