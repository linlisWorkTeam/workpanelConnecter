# Federation recovery runbook

Non-terminal Host acceptance is reconciled periodically from the origin Site outbox. This permits a Site to reconstruct a Host message after Host database loss while `(originSite,messageId)` and target inbox uniqueness prevent duplicate effective processing.

Ops-only APIs:

- `GET /v1/ops/federation/outbox?status=&limit=` lists durable Site outbox state without payloads.
- `POST /v1/ops/federation/outbox/:id/requeue` requeues a dead or failed entry and writes append-only audit.

Before requeue, verify the original envelope has not exceeded its business validity window. Requeueing does not change its signed `expiresAt`; an expired envelope cannot be requeued and requires a new authorized command with a new message ID.
