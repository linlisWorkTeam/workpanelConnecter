# WorkPanelConnecter 文档

[English](index.md) · [简体中文](index.zh-CN.md)

WorkPanelConnecter 将 WorkPet、WorkPanel、用户和 Runner 连接到本站 Connecter，并通过 Connecter Host 提供跨站目录与消息中继。

## 选择文档类型

| 类型 | 适合阅读者 | 入口 |
|---|---|---|
| Tutorials | 第一次安装和运行项目的使用者 | [入门教程](tutorials/quickstart.zh-CN.md) |
| How-to | 想完成一个具体操作的使用者 | [操作指南](how-to/README.zh-CN.md) |
| Explanation | 想理解边界、设计取舍和路线的使用者 | [概念解释](explanation/README.zh-CN.md) |
| Reference | 需要查命令、配置或 API 的使用者 | [参考手册](reference/README.zh-CN.md) |

## 语言规范

公开入口文档使用 Markdown 语言对照文件。英文是默认文件，匹配的 `.zh-CN.md` 文件是简体中文翻译；每组文件顶部都互相链接。

## 当前详细资料

- [当前架构](architecture.md)
- [Relay API](api-relay.md)
- [Relay 配置](relay-config.md)
- [Runner 协议](protocol/runners.md)
- [Directory v2](protocol/directory-v2.md)
- [Federation v1](protocol/federation-v1.md)
- [联邦本地实验室](runbooks/federation-local-lab.md)
- [当前实现状态与证据边界](P0-P3-IMPLEMENTATION-STATUS.md)
- [安全审查](security-review.md)
- [文档审查](DOCUMENTATION-AUDIT.md)

## 文档事实源

当资料不一致时，优先级为：运行代码与 schema → 自动化测试 → 当前参考文档 → 当前运维文档 → 设计记录 → 历史快照。

`docs/superpowers/`、`canary-*`、`releases/` 和旧版计划/交接文档保留历史语境，不应单独用于判断当前功能状态。
