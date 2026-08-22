# 备份与恢复运行手册

[English](backup-restore.md) · [简体中文](backup-restore.zh-CN.md)

在 WAL checkpoint 后使用 SQLite `VACUUM INTO` 或平台在线备份 API。将数据库、去除密钥的配置、协议版本和迁移校验和一起保存。加密备份并定期测试恢复。

恢复时写入新路径，运行 `npm run test:migrations`，让一个进程使用恢复副本启动，并在切换流量前比较行数和队列终态。绝不要覆盖唯一的生产数据库。Host 丢失不会停止站内 Site 流量；应使用 `(originSite,messageId)` 幂等键，将每个 Site 的 outbox 与恢复后的 Host 重新对账。
