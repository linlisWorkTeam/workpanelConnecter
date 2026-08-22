# Agent notes

开工前先读 `docs/epitaph/` 里 **active**、日期最新的墓志铭（交接与坑）。索引：`docs/epitaph/README.md`。

命名：WorkPet（UI）绑定 **Connecter**（每站一台）；**Connecter Host** 全网一台。见 `docs/superpowers/specs/2026-08-19-connecter-host-naming-design.md`。

## Documentation rules

- 文档改造只修改 Markdown 和其他文档相关文件，不修改业务代码、逻辑或运行配置。
- 遵循 Diátaxis 最小子集：`docs/tutorials/`、`docs/how-to/`、`docs/explanation/`、`docs/reference/` 分别承载教程、操作指南、概念解释和参考资料。
- 根 `README.md` 只做项目门面和快速上手；详细内容放入 `docs/`。
- `CHANGELOG.md` 遵循 Keep a Changelog；`docs/explanation/roadmap.md` 使用预估季度，并区分正式计划与 Backlog。
- 文档面向项目使用者，示例必须基于当前代码能力；不确定内容使用 `<!-- TODO: 根据项目实际补充 -->`。
- 文档和代码一起提交；提交前检查 Markdown 链接、命令和编码。不要提交 token、密码、证书或 SQLite 运行数据。
