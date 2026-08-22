# 联邦本地实验室

[English](federation-local-lab.md) · [简体中文](federation-local-lab.zh-CN.md)

日期：2026-08-22

本实验室使用相互独立的进程和 SQLite 数据库，在本地验证生产形态拓扑：

```text
WorkPanel mock <- Site A Connecter -> Connecter Host <- Site B Connecter <- Runner B
```

## 自动验收

在仓库根目录运行完整本地发布门禁：

```powershell
npm run test:release-local
```

也可以单独运行联邦门禁：

```powershell
npm run test:federation
npm run test:federation-chaos
npm run test:federation-host-loss
npm run test:federation-origin-restart
npm run test:federation-target-restart
npm run test:federation-host-restart
npm run test:federation-inbox-retry
npm run test:federation-workpanel-outage
npm run test:mtls-handshake
npm run test:trace-e2e
npm run test:soak-smoke
```

这些测试使用临时配置、数据库和端口，验证 Site A 接受命令、Host 中转、Site B Runner 执行、结果返回 Site A、源 WorkPanel 回写、终态幂等投影、积压清空以及 trace/audit 可见性。

## 故障覆盖

| 门禁 | 故障或不变量 |
|---|---|
| `test:federation` | 正常命令/结果往返、WorkPanel 回写、迟到的冲突终态 |
| `test:federation-chaos` | Host 和 Site B 停止并恢复；Site A 站内流量保持可用 |
| `test:federation-host-loss` | 接受后销毁 Host 数据库；Site outbox 重建未完成的中转 |
| `test:federation-origin-restart` | 远程命令进行中重启 Site A |
| `test:federation-inbox-retry` | ack 响应丢失、目标消息体保留、本地重试和 Runner 恢复 |
| `test:federation-target-restart` | Host 保留排队命令时单独重启 Site B |
| `test:federation-host-restart` | 两个 Site 保持在线时单独重启 Host，并重新对账中转 |
| `test:federation-workpanel-outage` | 源 WorkPanel 中断/恢复；远程终态仍提交且失败可独立观测 |
| `test:mtls-handshake` | 临时 CA/服务端/客户端证书、授权请求和无客户端证书时的 handler 前拒绝 |
| `test:trace-e2e` | 端到端 trace、审计和运维投影 |
| `test:soak-smoke` | 重复的三进程往返和干净的积压终止 |

## 生产等价验收

本地实验室不能证明网络 TLS/mTLS、防火墙/NAT、真实 WorkPanel 部署或长时间容量。在生产推广前，至少应在两个 Site 服务器和独立 Host 上重复拓扑，使用外部存储的签名密钥和入口 HTTPS/mTLS，运行真实 WorkPanel canary，并保留 72 小时 soak 证据。
