# Connect pairing implementation plan

## Phase 1 — trust model
- Use a QR code or numeric out-of-band comparison to exchange a short-lived pairing challenge.
- Both devices show the peer identity and requested scopes; both users approve.
- Bind the resulting session to device public keys, tenant, expiry and a revocable device record.
- Require fresh authentication after expiry or revocation.

## Phase 2 — secure transport
- Prefer TLS 1.3 over a local Wi-Fi network with certificate/public-key pinning to an enrolled device key.
- Bluetooth may be used for discovery/bootstrap only; do not transmit sensitive records over unauthenticated advertisements.
- Encrypt payloads end-to-end when a trusted relay is introduced.
- Keep network interfaces disabled until the transport has been implemented and reviewed.

## Phase 3 — synchronization
- Persist an outbound operation queue with stable UUIDs.
- Server deduplicates operations and returns per-operation acknowledgements.
- Pull changes using a monotonic server cursor.
- Financial conflicts go to a review queue; never overwrite or retry silently.
- Show last successful sync, pending count, failure reason and disconnect/revoke controls.

## Acceptance gates
- Pairing requires confirmation on both devices.
- Expired, replayed, revoked and wrong-tenant challenges are rejected.
- Packet capture shows no sensitive plaintext.
- Duplicate delivery of the same operation is idempotent.
- Disconnect and revoke terminate future synchronization.
- Offline edits remain intact after app restart and reconnect.
