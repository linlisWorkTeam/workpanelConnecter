# API reference

[English](api.md) · [简体中文](api.zh-CN.md)

This page is a map of the implemented API groups. Use the detailed protocol documents for request and response contracts.

| Area | Main endpoints | Authentication |
|---|---|---|
| Health and session | `/v1/health`, `/v1/auth/login`, `/v1/session/revoke` | Health is public; session endpoints use configured credentials |
| WorkPanel relay | `/v1/envs`, `/v1/groups`, `/v1/chat`, `/v1/messages`, `/v1/runs/` | WorkPet or operations token |
| WorkPanel provider dispatch | `POST /v2/dispatches`, `GET /v2/dispatches/:id`, `POST /v2/dispatches/:id/cancel` | Dedicated `workpanelServices[]` bearer with `dispatch:*` scopes |
| Runner | `/v1/agents/register`, `/v1/agents/heartbeat`, `/v1/agents/tasks*` | Runner token or enrollment credential |
| Directory and enrollment | `/v2/enrollments`, `/v2/directory/*`, `/v2/routes/explain` | Operations or site identity |
| Federation | `/v1/host/*`, `/v1/federation/*` | Site/Host peer identity, TLS, and policy |
| Operations | `/v1/ops/*` | Operations token |

Detailed contracts: [`api-relay.md`](../api-relay.md), [`runners.md`](../protocol/runners.md), [`directory-v2.md`](../protocol/directory-v2.md), and [`federation-v1.md`](../protocol/federation-v1.md).

Provider dispatch creation requires `Idempotency-Key`, `groupRef`, `targetSubjectId`, `env`, and `prompt` (or `content`). It always uses `writeBack: false`; results are returned as `result: { content, phase, resultId }`. The service credential may additionally restrict allowed `groupRefs` and `targetSubjectIds`.

<!-- TODO: Add versioned request/response examples after the public API compatibility policy is confirmed. -->
