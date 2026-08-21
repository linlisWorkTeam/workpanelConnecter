# Connecter Federation Protocol v1

Date: 2026-08-21

Each site runs one Connecter. A single Connecter Host is a durable relay and directory exchange; it never accepts WorkPet, WorkPanel, or Runner execution traffic. Local traffic stays inside the site.

## Envelope

`protocol` is `workpanel.connecter.federation/v1`. Required fields are UUID `messageId`, `correlationId`, `traceId`; `originSite`, `targetSite`, canonical `groupRef`; UUID `fromSubject`, `toSubject`; `kind`; object `payload`; ISO `createdAt`, `expiresAt`; and `hop`. The maximum TTL is 24 hours, maximum hop is 4, and the default payload limit is 128 KiB.

Kinds:

- `chat.command`: origin WorkPet command delivered to a target-site Runner.
- `run.event`: terminal Runner result returned to the origin site.
- `delivery.receipt`: reserved for explicit delivery reporting.

## Durable delivery

1. Origin writes the envelope to its SQLite outbox before sending.
2. Host writes message and target delivery transactionally; `(originSite,messageId)` is the idempotency key.
3. Target pulls with a fencing lease, writes its inbox, then acknowledges.
4. Target processes the inbox and reports delivered/failed. An acknowledged lease is reclaimed after timeout if the target crashes.
5. A `chat.command` is complete at the Host after the target task is durable. Its later `run.event` is a separate durable message.

Duplicate envelope bodies return the existing state; reuse of a message ID with different content returns `409`. Expired messages are never dispatched. Only provisioned peer bearer credentials may call federation endpoints.

## Endpoints

- `POST /v1/federation/messages`
- `POST /v1/federation/pull`
- `POST /v1/federation/ack`
- `POST /v1/federation/result`
- `POST /v1/federation/directory/advertise`
- `GET /v1/federation/directory`

All are Host-only and peer-authenticated. Site Connecters initiate every network connection, so no inbound Site port is required.

## Security and policy

Production mode should set `requireTls`, `requireSignatures`, `requireSeparateSigningKey`, and `requireExternalSigningKey`. Envelope HMAC covers the IDs, origin/target, timestamps, payload and key ID. `active` and `next` keys may overlap during rotation; revoked keys fail verification. Load signing material through `secretEnv` or a restricted `secretFile`, separate from the peer bearer credential. Direct mTLS clients load CA, certificate and key from `host.tls.caFile`, `host.tls.certFile`, and `host.tls.keyFile`; certificate verification cannot be disabled.

Cross-site authorization is default-deny. Each rule binds origin Site, target Site, GroupRef, optional Subject, operation, direction, capability and data classification. Every requested capability must be authorized. Database or configured denies override allows. The legacy Site/Group arrays have no effect unless `legacyAllowlistEnabled` is explicitly set.

Ops may list, create and disable durable rules through `/v1/ops/federation/policies`. Policies are disabled rather than deleted, and changes create append-only audit events.
