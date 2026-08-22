# Connecter 值班与回滚阈值

[English](on-call.md) · [简体中文](on-call.zh-CN.md)

## 告警阈值

- Site 控制链路连续 2 个 heartbeat TTL 断开：通知 Site 负责人；
- Federation 数据链路断开或 outbox 非空持续 5 分钟：告警；15 分钟：升级通知；
- 任意死信、签名拒绝突增、磁盘压力拒绝或终态冲突：立即升级通知；
- Runner 在线数量异常下降、15 分钟内 lease 过期超过任务的 1%，或 Federation 最大投递延迟超过 60 秒：告警并调查；
- WorkPanel 回写失败不会回滚远程执行，但 10 分钟内出现 5 次时应升级通知。

使用 `GET /v1/ops/health/detail`、`GET /v1/ops/traces/:traceId`、`GET /v1/ops/federation/outbox` 和 `GET /v1/ops/security/deliveries` 诊断。事故期间不要手动查看或编辑 SQLite 行。

怀疑 Site peer 凭证泄露时，先调用 `POST /v1/ops/host/peers/:siteId/revoke`。在日志之外生成新的高熵 token，通过 `POST /v1/ops/host/peers/:siteId/rotate` 轮换，更新 Site 密钥，然后验证 heartbeat 和一个受限 canary。即使 Host 配置文件未变化，旧 bootstrap token 仍然无效。

## 回滚

1. 使用 `POST /v1/ops/federation/policies/:id/disable` 禁用受影响规则，或在 Site 设置 `federation.enabled=false`；站内流量仍保持启用。不要删除策略历史；
2. 排空或保留 Site outbox。不要降级数据库 schema；
3. 回滚到兼容协议的上一版本二进制，验证控制链路、Directory TTL、站内聊天和一次跨 Site canary；
4. 当积压为零、没有死信且投递延迟连续 15 分钟低于 30 秒时，按 Site/群组逐步恢复。
