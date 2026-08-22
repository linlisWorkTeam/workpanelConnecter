# Connecter 演进方向

> 更新：2026-08-22；当前实现已越过早期 E1–E3 设计阶段。

## 已完成的演进

1. 从站内 WorkPet relay 演进为通用 Site Connecter；
2. 从静态 Runner 绑定演进为注册、心跳/TTL、Directory v2 和 device credential；
3. 从简单任务队列演进为 lease、ack/renew、generation fencing 和恢复；
4. 从 Host peer 会合骨架演进为 durable `Connecter A → Host → Connecter B` 双向联邦；
5. 从共享 bearer 演进为默认拒绝 ACL、签名轮换、TLS/mTLS、审计、配额和 trace；
6. 从源码发布演进为 Windows 可执行安装/便携包。

## Raft 取舍

Connecter 已采用 Raft 思想中的成员视图、心跳、租约和 fencing，但没有复制群聊正文，也没有为了形式引入完整 Raft。WorkPanel 保留会话权威；Connecter 只保证调度与投递。只有当单 Host 成为真实可用性瓶颈时，才评估 Raft/etcd 或外置数据库。

## 下一阶段

- **部署可信度**：真实三机 mTLS、外部告警和 72 小时 soak；
- **供应链**：Windows Authenticode、依赖与 SBOM、自动更新；
- **适配器生态**：统一 WorkPanel、dsh、Clowder 和其他 A2A/ACP runtime 的 adapter contract；
- **规模化**：在观测数据证明需要后，再做 Host HA 和外置存储。

## 不变量

WorkPet 只连本站 Connecter；Runner 只向本站 Connecter 出站；Host 不执行 Agent；站内不绕 Host；群消息 source of truth 留在 WorkPanel；任何外部框架都是适配器而不是 Connecter 核心。

执行优先级见 [`ROADMAP.md`](./ROADMAP.md)。早期 E1–E4 讨论保存在 `docs/superpowers/`，仅作为历史决策记录。
