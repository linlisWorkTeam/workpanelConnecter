# Security policy

[English](SECURITY.en.md) · [简体中文](SECURITY.md)

## Reporting a vulnerability

请不要在公开 Issue、讨论区或提交信息中披露未修复的安全问题。

<!-- TODO: 根据项目实际补充安全邮箱或 GitHub Private Vulnerability Reporting 链接。 -->

报告至少应包含：

- 受影响的版本、commit 或发布包；
- 可复现步骤和最小示例；
- 影响范围、所需权限和可能的利用条件；
- 你是否已经公开披露，以及希望的联系渠道。

## Handling secrets

- 不要提交 token、密码、私钥、证书、签名 secret 或真实 `config/relay.json`。
- 使用 `config/relay.example.json`、环境变量或受限外部文件表达配置形状。
- 发现 secret 被提交时，应立即吊销/轮换，并在安全报告中说明暴露范围。

## Supported versions

当前支持策略尚未正式公布。

<!-- TODO: 根据项目实际补充支持版本、修复时限和公开披露流程。 -->
