# Connecter 稳定标识符

> 状态：P0–P3 当前契约；更新于 2026-08-22。

## 规则

- 显示名不是身份；`agentName`、`groupName` 和用户名仅用于展示与兼容查找。
- 跨站主体必须先映射到稳定 `subjectId`，不同站点的同名主体不会相撞。
- `siteId` 使用小写 DNS-label 风格：`[a-z0-9][a-z0-9-]{0,62}`。
- `subjectId` 由 `(siteId, kind, local stable id)` 确定性派生为 UUID；`kind` 为 `user|agent|workpet|service`。
- WorkPanel 群使用 `groupRef = wp:<authority-site>:<url-encoded-group-id>`。
- 每条业务链路使用 UUID `traceId`、`correlationId`；派生事件另带 `causationId`。

## 当前兼容行为

现有 `/v1/*` 外部 ID 保持不变。Directory v2 会为旧 Runner、WorkPanel member 和 WorkPet 派生稳定主体；federation envelope 只接受稳定 ID，不允许以显示名跨站寻址。迁移顺序与开关见 [`directory-v2.md`](./directory-v2.md)。
