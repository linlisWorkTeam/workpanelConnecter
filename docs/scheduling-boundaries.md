# WorkPanelConnecter 调度边界

> 状态：当前规范，适用于 v0.2.3；更新于 2026-08-22。

## In scope

| 能力 | 归属 |
|---|---|
| WorkPet/User、WorkPanel、Runner 的站内连接 | Site Connecter |
| Runner 注册、心跳、TTL、lease、ack/renew/result 与 fencing | Site Connecter |
| 稳定 Subject/GroupRef、Directory 投影和歧义路由 | Site Connecter + Host 目录交换 |
| 跨站 durable inbox/outbox、重试、终态回传 | Site Connecter + Connecter Host |
| Site peer 注册、心跳、吊销、轮换 | Connecter Host |
| 默认拒绝 ACL、签名、mTLS、配额、审计、trace | Connecter/Host |
| 群与会话正文权威 | WorkPanel |
| 任务实际执行 | Runner/Agent |
| 桌面交互和本地外观 | WorkPet |

## Out of scope

- Connecter 内嵌业务 Agent、人格、提示词或领域工具；
- Host 直接接 WorkPet、WorkPanel 或 Runner；
- 站内消息绕行 Host；
- Connecter 替代 WorkPanel 的群聊、成员管理或消息权威；
- 默认访问 prod 或由 Connecter promote/freeze WorkPanel；
- 用 Raft 复制群聊正文；
- 把 `/obs`、`/restart-server` 的 reserved CLI 占位描述成已实现能力。

## 调度不变量

1. WorkPet 只连接本站 Connecter；Runner 只向本站 Connecter 出站。
2. 同一 Runner task 只有当前 lease generation/token 可以 ack、renew 或提交终态。
3. 本地可解析目标不进入 Host；只有跨站路由使用 Host。
4. Host 只转发已认证 Site 的、通过策略判定且签名/TTL 合法的信封。
5. WorkPanel 保留群消息 source of truth；Connecter 只持久化传输、调度和投影所需数据。
6. dsh、Clowder 或其他执行框架均是适配器，不成为 Connecter 产品边界。

## 变更规则

修改角色、协议或权威边界时，必须同步更新 `architecture.md`、对应 `protocol/` 文档、配置 schema、门禁与 `DOCUMENTATION-AUDIT.md`。历史 plans/specs 只作为决策快照，不覆盖当前规范。
