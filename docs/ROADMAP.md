# WorkPanelConnecter Roadmap

> 当前版本：v0.2.3；更新：2026-08-22。
> 已完成状态以 [`P0-P3-IMPLEMENTATION-STATUS.md`](./P0-P3-IMPLEMENTATION-STATUS.md) 和测试为准。

## 已完成

| 阶段 | 内容 | 状态 |
|---|---|---|
| 基础中继 | WorkPet → Connecter → WorkPanel、SQLite、幂等、重试、恢复 | ✅ |
| Runner E1/E2 | 注册、心跳/TTL、poll/ack/renew/result、lease/fencing、全文结果投影 | ✅ 本地代码与 canary |
| P0 | 迁移、稳定 ID、服务边界、Runner 恢复和运维操作 | ✅ 本地门禁 |
| P1 | Directory v2、enrollment/device credential、路由歧义与轮换吊销 | ✅ 本地门禁 |
| P2 | Connecter A → Host → Connecter B 联邦、目录同步、结果回传、独立故障恢复 | ✅ 本地三进程门禁 |
| P3 | 默认拒绝策略、签名/mTLS、配额、审计、trace、备份恢复 | ✅ 本地门禁 |
| Windows 交付 | WorkPet NSIS、Connecter SEA 便携包、SHA-256、tag 自动发布 | ✅ v0.2.2 起 |

## 当前发布门禁

- `npm run test:release-local`：51 项（含文档一致性门禁）；
- Windows workflow：干净 Windows Runner 构建、Connecter health smoke、Release 上传；
- WorkPet：38 项 UI 测试、6 项 Rust 测试、NSIS 安装/启动冒烟；
- 本地 federation：短 soak、10 分钟和 8 分钟重复 soak；
- 真实 canary：当前端口 `127.0.0.1:8082` 已通过成员和 @Agent 路由。

## P4：部署环境验收（最高优先级）

1. 在两台 Site 服务器和一台独立 Host 上部署真实 TLS/mTLS；
2. 接入生产证书签发、轮换、吊销与外部 secret 管理；
3. 接入真实告警接收器并验证磁盘、队列、失败率和证书告警；
4. 完成 72 小时 soak、Host/Site 网络分区和恢复演练；
5. 为 Windows 二进制配置 Authenticode 签名。

## P5：生态适配与体验

1. 建立通用 adapter contract，避免 dsh、Clowder 等框架逻辑进入中继核心；
2. 优先评估 A2A Server façade，使 Clowder 可把 Connecter 当远端 Agent 服务；
3. 按需求增加 WS/SSE，同时保留 `since` 轮询兼容；
4. 改进 WorkPet 首次配置、自动更新和安装签名体验。

## P6：按规模触发的 HA

只有当单 Host 可用性或容量成为实际瓶颈时，才评估双 Host、外置数据库/队列或 Raft/etcd 成员共识。群消息正文继续由 WorkPanel 负责，不进入 Connecter 共识日志。

## 非目标

Connecter 不成为业务网页、业务 Agent 或 WorkPanel 替代品；不默认访问 prod；不让 Host 执行 Agent；不为技术炫耀提前引入完整 Raft。
