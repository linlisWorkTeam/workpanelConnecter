# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- <!-- TODO: 发布新版本前填写新增功能。 -->

### Changed

- <!-- TODO: 发布新版本前填写行为或文档变化。 -->

### Fixed

- Relay dispatch now gives WorkPanel login up to 15 seconds, preventing healthy canary requests from failing when authentication takes slightly longer than the 5-second health-probe budget.
- Documentation consistency checks now ignore local `.linlis` runtime memory, so ignored machine state cannot break repository gates.
- Migration checksums are now stable across LF/CRLF checkouts while accepting legacy raw checksums; the migration copy gate now covers migration 013 and rolls back an intentional 014 failure.

## [0.2.3] - 2026-08-22

### Added

- 文档权威索引、文档一致性门禁和 Windows 发布产物。
- Site Connecter、Connecter Host、Directory v2、enrollment、durable federation、签名和 mTLS 的当前实现文档。

### Changed

- 继续保持 WorkPet 只连接本站 Connecter，站内流量不绕行 Connecter Host。

### Security

- 文档明确生产证书运维、外部告警、72 小时 soak 和 Authenticode 仍属于部署门禁。

[Unreleased]: https://github.com/linlisWorkTeam/workpanelConnecter/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/linlisWorkTeam/workpanelConnecter/releases/tag/v0.2.3
