# 下一步开发路径

> 更新：2026-08-22；基线：v0.2.3。P0–P3 已在本地证据边界内完成，不再把 E1/E2/E3 写成待开发项。

## 1. 当前基线

- 每站一台 Connecter，全网一台 Connecter Host；
- WorkPet/WorkPanel/Runner 只连接本站 Connecter；
- Runner 与跨站 federation 均具备 durable queue、lease/fencing、幂等和恢复；
- Directory v2、enrollment、credential rotation/revocation、默认拒绝 ACL、签名和 mTLS 客户端均已实现；
- v0.2.3 提供 WorkPet 安装 EXE 与 Connecter 自包含 Windows 包；
- 51 项本地发布门禁通过。

## 2. 下一程：先完成真实部署验收

| 优先级 | 工作 | 完成证据 |
|---|---|---|
| P4.0 | 双 Site + 独立 Host 实机部署 | 三台机器独立进程、真实 DNS/网络 |
| P4.1 | 生产 CA/mTLS 与 secret 管理 | 签发、轮换、吊销、错误证书负向测试 |
| P4.2 | 外部告警 | 告警接收器收到队列、失败率、磁盘、证书事件 |
| P4.3 | 72 小时 soak | 持续报告、0 数据丢失、恢复时间记录 |
| P4.4 | Windows 签名 | Authenticode 有效，SmartScreen 发布者明确 |

## 3. 之后的产品演进

- 通用 adapter contract；
- WorkPanel 与 Clowder 双连接原型，首选 A2A Server façade；
- WorkPet 首次配置向导与自动更新；
- 可选 WS/SSE；
- 达到明确规模阈值后再评估 Host HA。

## 4. 明确不做

- Connecter 内执行 Agent；
- Host 接收 WorkPet/WorkPanel/Runner 业务接口；
- 默认 prod 或修改 WorkPanel 发布槽；
- 用窄测试宣称真实多服务器或生产就绪。

详细顺序见 [`ROADMAP.md`](./ROADMAP.md)，当前证据边界见 [`P0-P3-IMPLEMENTATION-STATUS.md`](./P0-P3-IMPLEMENTATION-STATUS.md)。
