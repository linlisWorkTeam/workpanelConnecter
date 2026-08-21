# Backup and restore runbook

Use SQLite `VACUUM INTO` (or the platform online-backup API) after a WAL checkpoint. Store database, config without secrets, protocol version, and migration checksums together. Encrypt backups and test restoration regularly.

Restore into a new path, run `npm run test:migrations`, start one process against the restored copy, and compare row counts plus queue terminal states before switching traffic. Never overwrite the only production database. Host loss does not stop local Site traffic; reconcile each Site outbox against the restored Host using `(originSite,messageId)` idempotency keys.
