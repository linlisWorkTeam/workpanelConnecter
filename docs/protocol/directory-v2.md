# Connecter Directory / Runner Protocol v2

Runner v2 在原 register 基础上增加 `protocolVersion:2`、`capabilities`、`maxConcurrency`、`labels` 与 `load`。未知 capability 会进入目录，但不会自动获得权限。

Directory 的稳定实体为 Subject、Endpoint、Capability、Membership 和 Presence。显示名不能作为跨站身份，规则见 [`identifiers.md`](./identifiers.md)。

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

能力名最长 96 字符；最多 64 项；`maxConcurrency` 为 1–50；`load` 为 0–1。权限只能由 enrollment 审批/Policy 授予，不能由 Runner 自报。
