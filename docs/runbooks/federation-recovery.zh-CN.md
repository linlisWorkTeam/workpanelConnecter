# 联邦恢复运行手册

[English](federation-recovery.md) · [简体中文](federation-recovery.zh-CN.md)

Host 尚未终态的接受记录会定期根据源 Site outbox 对账。这样即使 Host 数据库丢失，Site 也可以重建 Host 消息；`(originSite,messageId)` 和目标 inbox 唯一性可以避免重复生效处理。

仅运维 API：

- `GET /v1/ops/federation/outbox?status=&limit=`：不含消息体地列出持久化 Site outbox 状态；
- `POST /v1/ops/federation/outbox/:id/requeue`：重新排队 dead 或 failed 条目，并写入 append-only 审计。

重新排队前，确认原始 envelope 没有超过业务有效期。重新排队不会修改签名的 `expiresAt`；过期 envelope 不能重新排队，必须使用新的 message ID 创建新的授权命令。
