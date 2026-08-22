# 滚动升级运行手册

[English](rolling-upgrade.md) · [简体中文](rolling-upgrade.zh-CN.md)

1. 备份每个 Site 和 Host 的数据库，并运行兼容性矩阵；
2. Host 可先升级或后升级；Federation v1 允许额外未知字段，但会拒绝未知协议主版本；
3. 升级一个 Site，验证站内聊天、Host 链路、Directory 广播、一次跨站命令和结果返回；
4. 逐个继续升级。不要回滚数据库 schema；只有在上一版本声明的兼容窗口包含当前可空 schema 时，才使用上一版本二进制；
5. 使用 `federation.enabled=false` 或删除 Site/群组 allowlist 条目回滚流量。站内流量必须保持可用。
