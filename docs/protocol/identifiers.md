# Connecter 稳定标识符

> 日期：2026-08-21 · P0 基础契约

## 原则

- 显示名不是身份。`agentName`、`groupName`、用户名只用于展示和兼容查找。
- 所有跨站主体必须先落到稳定 `subjectId`；同名主体在不同站点不会相撞。
- `siteId` 使用小写 DNS-label 风格：`[a-z0-9][a-z0-9-]{0,62}`。
- `subjectId` 是由 `(siteId, kind, local stable id)` 确定性派生的 UUID；kind 只能是 `user|agent|workpet|service`。
- WorkPanel 群用 `groupRef = wp:<authority-site>:<url-encoded-group-id>`。
- 每条业务链路使用 UUID `traceId`、`correlationId`，派生事件另带 `causationId`。

## 兼容规则

P0 不改变现有 `/v1/*` 的外部 ID。P1 建立 Directory 投影时，为旧 `runners`、WP members 和 WorkPet 派生稳定 subjectId；P2 federation envelope 只接受稳定 ID，不允许以显示名跨站寻址。
