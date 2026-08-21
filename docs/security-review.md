# Connecter federation security review

Date: 2026-08-22

Scope: Relay HTTP authentication, Runner enrollment, Directory routing, Site/Host federation, SQLite persistence, operations endpoints, logs and configuration.

## Controls and evidence

- Authentication: WorkPet sessions, ops bearer, Runner credentials and Host peers are separate principals. Dynamic Runner credentials carry site/group/capability/operation scopes, expiry, key ID and revocation state. Host peer credentials support audited runtime revoke/rotate; after bootstrap the durable Host record is authoritative, so an old config token cannot silently re-register.
- CSRF/CORS: mutation APIs do not authenticate with ambient cookies; callers must send an explicit bearer token. Browser origins are configurable through `cors.origins`; production must not use `*` for a browser-exposed Connecter.
- Authorization: federation is default-deny. Rules bind origin Site, target Site, GroupRef, Subject, operation, direction, capability and data classification. Every requested capability must be authorized; database and configured denies override allows. Directory advertisements are filtered per caller and reject cross-Site Subject ID collisions.
- Replay and integrity: envelopes are signed over IDs, origin/target, timestamps, payload and key ID. `(originSite,messageId)` is unique at Host and Site; Runner results use `(taskId,resultId)`. Active/next/revoked key states are tested.
- Secret storage: production can require a signing key separate from the bearer and reject inline secrets. Use `secretEnv` or a restricted `secretFile`; private signing material is not stored in SQLite. Site-to-Host mTLS client material is loaded from `host.tls.caFile`, `certFile` and `keyFile`; certificate validation cannot be disabled.
- SSRF: peer public URLs are descriptive and are never fetched by Host. WorkPanel backend registration is ops-only. Production egress should additionally restrict Connecter to approved WorkPanel and Host destinations.
- Injection: database values use prepared parameters. Migration and backup paths are quoted by dedicated helpers. HTTP bodies have a 256 KiB transport limit and protocol-specific tighter limits.
- Logging and privacy: Relay runtime logs are JSON records. Audit/telemetry redact token/password/secret/authorization-named fields and omit message payloads from health and security-delivery listings.
- Availability: per-Site rate, concurrent pull, inflight, bytes and dead-letter limits return backpressure; disk pressure rejects only new federation messages. Local WorkPet/WorkPanel/Runner paths remain independent.

## Evidence boundary

Local automated gates cover invalid signature, key rotation/revocation, default deny, policy dimensions, scope escalation, target non-disclosure, quota isolation, append-only audit, Host/Site/Runner crash recovery, and an ephemeral-CA mTLS handshake that rejects a client without a certificate before the application handler. Production ingress termination, real Site certificate identity binding/rotation, network egress policy, OS secret-store permissions and external penetration testing require the deployment environment and remain release gates.
