# Contributing

感谢贡献 WorkPanelConnecter。请保持改动小、可验证，并遵守项目的 Connecter/Connecter Host 命名和文档分类约定。

## Local setup

1. 安装 Node.js 18+；运行 Relay、SQLite 和完整门禁建议 Node.js 22.5+。
2. 克隆仓库并安装依赖：

   ```bash
   git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
   cd workpanelConnecter
   npm install
   ```

3. 运行最小检查：

   ```bash
   npm test
   npm run test:docs
   ```

WorkPet 额外需要 Rust、Tauri 2 和操作系统桌面依赖。真实 WorkPanel、凭证、token、证书和 SQLite 数据只能使用本地未提交配置。

## Pull request flow

1. 从最新 `main` 创建 `codex/<topic>` 分支。
2. 只提交与目标相关的源码或 Markdown；不要提交 secret、构建产物、数据库和缓存。
3. 修改文档时检查相对链接、命令、版本号和证据边界。
4. 至少运行与改动相关的测试；跨模块变更建议运行 `npm run test:release-local`。
5. 提交 Pull Request，说明目的、测试命令、证据边界和未完成事项。

## Commit messages

推荐使用简短的 Conventional Commits 风格：

```text
docs: clarify WorkPet quickstart
fix: reject stale runner lease
feat: add directory capability filter
test: cover federation retry
```

<!-- TODO: 根据项目实际补充审查人、分支保护、CI 必需检查和发布审批规则。 -->
