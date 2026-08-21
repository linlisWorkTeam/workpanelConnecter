# Connecter on-call and rollback thresholds

## Alert thresholds

- Site control link down for 2 heartbeat TTLs: page the Site owner.
- Federation data link down or outbox backlog non-zero for 5 minutes: warn; 15 minutes: page.
- Any dead letter, signature denial burst, disk-pressure rejection, or terminal conflict: page immediately.
- Runner online count unexpectedly drops, lease expiries exceed 1% of tasks in 15 minutes, or maximum federation delivery latency exceeds 60 seconds: warn and investigate.
- WorkPanel write-back failures do not roll back remote execution, but page when five occur in ten minutes.

Use `GET /v1/ops/health/detail`, `GET /v1/ops/traces/:traceId`, `GET /v1/ops/federation/outbox`, and `GET /v1/ops/security/deliveries` for diagnosis. Never inspect or edit SQLite rows manually during an incident.

For a suspected Site peer credential compromise, call `POST /v1/ops/host/peers/:siteId/revoke` first. Generate a new high-entropy token outside logs, rotate it with `POST /v1/ops/host/peers/:siteId/rotate`, update the Site secret, then verify heartbeat and one scoped canary. The old bootstrap token remains invalid even if it is still present in an unchanged Host config file.

## Rollback

1. Disable the affected rule with `POST /v1/ops/federation/policies/:id/disable` or set `federation.enabled=false` at Sites; local traffic remains enabled. Do not delete policy history.
2. Drain or preserve Site outboxes. Do not downgrade the database schema.
3. Roll the previous protocol-compatible binary and verify control link, Directory TTL, local chat and one cross-Site canary.
4. Re-enable by one Site/group at a time when backlog is zero, no dead letters remain, and delivery latency is below 30 seconds for 15 minutes.
