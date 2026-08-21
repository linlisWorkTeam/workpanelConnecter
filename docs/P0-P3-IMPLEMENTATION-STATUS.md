# Connecter P0-P3 implementation status

Date: 2026-08-22
Baseline: `main@e5b51eb`
Working branch: `codex/connecter-p0-p3`

P0 through P3 code is implemented as a local release candidate. The current topology is:

```text
WorkPet A -> Site Connecter A -> Connecter Host -> Site Connecter B -> Runner B
                         local traffic never enters Host
Runner B result -> Site Connecter B -> Connecter Host -> Site Connecter A -> WorkPet A
```

Implemented boundaries:

- Host accepts only provisioned Site peers and federation/directory traffic. It has no WorkPet, WorkPanel, or Runner execution path. Peer credentials have audited runtime revoke/rotate operations, and revoked or superseded bootstrap tokens cannot re-register.
- Each Site owns local WorkPet/WorkPanel/Runner integration, durable inbox/outbox, Directory projection, policy and result materialization.
- Cross-site dispatch uses stable Subject IDs and canonical GroupRefs, explicit default-deny ACLs, signed envelopes, TTL/hop limits and idempotency keys.
- ACL rules bind origin Site, target Site, GroupRef, Subject, operation, direction, capability and data classification; every requested capability must be authorized and explicit denies override allows.
- Runner and federation delivery both use durable leases and fencing. Site outboxes reconcile non-terminal Host acceptance, including Host database loss.
- Production mode can reject static Runner bearer credentials, inline signing secrets and non-TLS Host URLs. Direct Site-to-Host mTLS client certificate files are supported with mandatory certificate verification.

Repeatable evidence is exposed through the `test:migrations`, `test:runner-*`, `test:directory-*`, `test:federation-*`, `test:p3-security`, `test:device-identity`, `test:tls-config`, `test:mtls-handshake`, `test:policy-*`, `test:quota`, `test:trace-e2e`, `test:compat`, `test:backup-restore`, and `test:soak` scripts. `npm run test:release-local` passed all 49 local release gates fail-fast, including a real ephemeral-CA mutual TLS handshake and the short soak. Two separate repeated three-process federation soaks also passed: 600,000 ms (wall time 602.4 s) and 480,000 ms (wall time 482.6 s), both ending with `FEDERATION_SOAK_OK`.

## Requirement audit

| Plan area | Current evidence | Status |
|---|---|---|
| P0 migrations and rollback | Migrations 001-012, production DB copy, checksum drift, pre-failure backup and rollback gates | Local complete |
| P0 Runner lease/fencing/recovery | Concurrent claim, ack/renew, v1/v2 isolation, pre-ack and running crash, requeue generation and stale result rejection | Local complete |
| P0 service boundaries and IDs | Transport handlers, application services, stable Subject/Group/message/trace identifiers | Local complete |
| P1 Directory/enrollment/routing | v1/v2 coexistence, TTL presence, same-name ambiguity, capability scope, credential rotation/revocation and ops-only projection | Local complete |
| P2 Host/Site federation | Durable queues, lost ack, local retry, TTL, first-terminal-wins, Host DB loss and backlog reconciliation | Local complete |
| P2 topology and result return | Site A -> Host -> Site B -> Runner -> Site A, origin run/message projection and WorkPanel write-back | Local complete |
| P2 independent failures | Site A, Site B, Host, Runner and WorkPanel each have independent restart/outage gates; both Sites retain local paths while Host is down | Local complete |
| P3 identity/policy | External signing keys, active/next/revoked verification, optional device-credential-only Runner mode, real local mTLS handshake/rejection, full policy dimensions and audited policy lifecycle | Local complete |
| P3 operations | Structured logs, trace/audit archive, accurate affected-delivery filters, quotas, disk pressure, metrics, backup/restore and runbooks | Local complete |
| Real WorkPanel canary | Live `127.0.0.1:8082` health, membership, no-@ admin routing and explicit `@Codex` dispatch passed (`E2_AT_MENTION_OK`); the historical `:8081` fixture is offline | Passed on current canary |
| Real multi-server TLS/mTLS | Local ephemeral-CA mutual handshake passes; two Site servers, a separate Host and real network/certificate operations remain | Pending environment |
| 72-hour soak and alert integration | Release short soak plus separate 10-minute and 8-minute repeated three-process soaks pass; production-duration evidence and external alert receiver are unavailable | Pending environment |

Evidence boundary: local three-process, origin WorkPanel result write-back, process-restart and destructive temporary-Host-database tests pass. A live WorkPanel canary at `127.0.0.1:8082` passed membership and message routing; this does not substitute for a real multi-server federation deployment. Neither the 72-hour soak nor a real multi-server TLS/mTLS deployment has been run. Do not label this production-ready until those external release gates pass.
