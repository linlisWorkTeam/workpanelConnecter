# Connecter observability

Date: 2026-08-21

Every cross-site command keeps `traceId`, `correlationId`, `messageId`, site and subject IDs through routing, Host acceptance, target task, and result return. Sensitive fields whose names contain token, password, secret, or authorization are redacted before persistence.

Ops-only endpoints:

- `GET /v1/ops/health/detail`: online sites/runners, local and federation queue depth, lease expiry, retry, dead-letter, ACL deny, and WorkPanel failure counters.
- `GET /v1/ops/traces/:traceId`: routing, append-only security audit, and telemetry timeline.
- `GET /v1/ops/security/deliveries`: payload-free affected-delivery inventory filtered by Site, signing key, state and time.
- `GET|POST /v1/ops/federation/policies` and `POST /v1/ops/federation/policies/:id/disable`: audited policy lifecycle.

Alert on sustained queue growth, any dead letter, repeated ACL/signature denial, disk pressure, or a linked Site becoming stale. Payload contents are intentionally excluded from metrics and audit records.

Terminal federation rows, telemetry, and the live audit working set have bounded startup retention. Old audit events move transactionally into an append-only archive table; trace queries span both live and archived records. Individual audit records cannot be edited or deleted through application paths.
