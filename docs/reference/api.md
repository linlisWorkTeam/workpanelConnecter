# API reference

当前完整 Relay HTTP 契约见 [`../api-relay.md`](../api-relay.md)。主要接口组：

- 健康与环境：`GET /v1/health`、`GET /v1/envs`；
- WorkPet 群和消息：`/v1/auth/login`、`/v1/groups*`、`POST /v1/chat`、`GET /v1/messages`、`GET /v1/runs/:id`；
- Runner：`/v1/agents/*`；
- Directory/enrollment：`/v2/*`；
- Federation：`/v1/federation/*`；
- 运维：`/v1/ops/*`。

所有非 health/login 请求的鉴权、状态码、幂等规则和请求体请以详细契约与当前代码为准。

<!-- TODO: 根据项目实际补充 OpenAPI 之外的稳定响应示例和错误码索引。 -->
