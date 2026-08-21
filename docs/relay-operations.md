# Connecter 运维与数据库升级

## 数据库 migration

- `src/relay/schema.sql` 是新库的最新快照。
- `src/relay/migrations/` 是旧库的顺序升级记录；已经发布的 migration 不得修改。
- `schema_migrations` 保存版本、文件名和 SHA-256 checksum。源码 checksum 与数据库不一致时拒绝启动。
- 有 pending migration 的现有数据库会先执行 WAL checkpoint，并用 SQLite `VACUUM INTO` 创建 `connector.db.backup-<timestamp>`。
- migration 在 `BEGIN IMMEDIATE` 中执行，失败 rollback；上线前仍应另做运维级异机备份。

门禁：`npm run test:migrations`。

## Runner task 恢复

启动时 Connecter 会回收已过期 task lease：

- attempt 未达上限：回到 `queued`；
- attempt 达上限：进入 `dead`；
- 每次回收、人工重投、取消都写 `runner_task_audit`。

运维 API（ops bearer）：

- `GET /v1/ops/tasks?status=&runnerId=&limit=`
- `POST /v1/ops/tasks/:id/requeue { "reason": "..." }`
- `POST /v1/ops/tasks/:id/cancel { "reason": "..." }`

不要直接修改 task 行。人工 requeue 会清除旧 lease，使旧执行者结果被 fencing 拒绝。

门禁：`npm run test:runner-lease`、`npm run test:runner-recovery`、`npm run test:runner-ops`。
