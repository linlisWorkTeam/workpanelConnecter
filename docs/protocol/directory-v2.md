# Connecter Directory / Runner Protocol v2

> 状态：已实现的本地契约；更新于 2026-08-22。

Directory v2 把跨站寻址稳定在 Subject、Endpoint、Capability、Membership 和 Presence 上。显示名不能充当跨站身份，规则见 [`identifiers.md`](./identifiers.md)。

## Runner v2

Runner 在原有 register/heartbeat 基础上声明 `protocolVersion: 2`、`capabilities`、`maxConcurrency`、`labels` 和 `load`：

```json
{
  "agentId": "runner-a",
  "token": "...",
  "protocolVersion": 2,
  "maxConcurrency": 2,
  "load": 0.25,
  "labels": { "region": "hk" },
  "capabilities": [
    { "name": "code.review", "version": "1", "labels": {}, "limits": { "maxFiles": 100 } }
  ]
}
```

能力名最长 96 字符，最多 64 项；`maxConcurrency` 为 1–50，`load` 为 0–1。未知能力可进入目录，但权限只能由 enrollment 审批和 Policy 授予，不能由 Runner 自报。

## 已实现接口

| 接口 | 权限 | 用途 |
|---|---|---|
| `POST /v2/enrollments` | 一次性 enrollment code | 创建设备接入申请 |
| `GET /v2/ops/enrollments/`、审批/拒绝子路径 | ops | 审查接入申请并签发设备凭证 |
| `POST /v2/credentials/rotate` | device | 轮换自身凭证 |
| `POST /v2/ops/credentials/` 子路径 | ops | 吊销/运维设备凭证 |
| `GET /v2/directory/subjects` | ops | 查询稳定主体投影 |
| `GET /v2/directory/endpoints` | ops | 查询 endpoint、presence 与 capability |
| `POST /v2/routes/explain` | ops | 解释路由候选和拒绝原因，不执行投递 |

完整 Runner task 接口仍在 `/v1/agents/*`，见 [`runners.md`](./runners.md)。v2 是身份、目录和凭证演进，不是对 lease/fencing 协议的重复实现。

## 迁移与安全

先启用 `directoryV2Shadow` 对比新旧路由，再开启 `directoryV2RoutingEnabled`。生产环境可通过 `enrollment.requireDeviceCredentials=true` 拒绝 bootstrap 后继续使用长效静态 Runner token。凭证轮换和吊销会留下审计记录；接入码、设备凭证和 token 均不得提交仓库。
