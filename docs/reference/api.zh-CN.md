# API 参考

[English](api.md) · [简体中文](api.zh-CN.md)

本页只列出已实现的 API 分组；请求和响应契约请以详细协议文档为准。

| 区域 | 主要接口 | 鉴权 |
|---|---|---|
| 健康与会话 | `/v1/health`、`/v1/auth/login`、`/v1/session/revoke` | 健康检查公开；会话接口使用配置的凭证 |
| WorkPanel 中继 | `/v1/envs`、`/v1/groups`、`/v1/chat`、`/v1/messages`、`/v1/runs/` | WorkPet 或运维 token |
| WorkPanel provider 调度 | `POST /v2/dispatches`、`GET /v2/dispatches/:id`、`POST /v2/dispatches/:id/cancel` | `workpanelServices[]` 独立 bearer 及 `dispatch:*` scope |
| Runner | `/v1/agents/register`、`/v1/agents/heartbeat`、`/v1/agents/tasks*` | Runner token 或 enrollment 凭证 |
| Directory 与 enrollment | `/v2/enrollments`、`/v2/directory/*`、`/v2/routes/explain` | 运维身份或站点身份 |
| Federation | `/v1/host/*`、`/v1/federation/*` | Site/Host peer 身份、TLS 和策略 |
| 运维 | `/v1/ops/*` | 运维 token |

详细契约见 [`api-relay.md`](../api-relay.md)、[`runners.md`](../protocol/runners.md)、[`directory-v2.md`](../protocol/directory-v2.md) 和 [`federation-v1.md`](../protocol/federation-v1.md)。

创建 provider dispatch 必须传 `Idempotency-Key`、`groupRef`、`targetSubjectId`、`env` 以及 `prompt`（或 `content`）。该接口固定使用 `writeBack: false`；结果统一返回为 `result: { content, phase, resultId }`。service 凭证还可以通过 `groupRefs` 与 `targetSubjectIds` 限制可调度范围。

<!-- TODO: 根据项目实际确认公开 API 兼容策略后，补充版本化请求/响应示例。 -->
