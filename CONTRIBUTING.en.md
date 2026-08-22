# Contributing

[English](CONTRIBUTING.en.md) · [简体中文](CONTRIBUTING.md)

Thank you for contributing to WorkPanelConnecter. Keep changes focused, verifiable, and consistent with the Connecter/Connecter Host naming and documentation categories.

## Local setup

1. Install Node.js 18 or newer; Node.js 22.5 or newer is recommended for Relay, SQLite, and the full gate suite.
2. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
   cd workpanelConnecter
   npm install
   ```

3. Run the minimum checks:

   ```bash
   npm test
   npm run test:docs
   ```

WorkPet additionally requires Rust, Tauri 2, and desktop dependencies for the target operating system. Real WorkPanel services, credentials, tokens, certificates, and SQLite data must stay in local uncommitted configuration.

## Pull request flow

1. Create a `codex/<topic>` branch from the latest `main`;
2. Submit only source or Markdown related to the goal; do not submit secrets, build artifacts, databases, or caches;
3. For documentation changes, check relative links, commands, version numbers, and evidence boundaries;
4. Run tests relevant to the change; for cross-module changes, also run `npm run test:release-local`;
5. Open a Pull Request describing the goal, test commands, evidence boundaries, and unfinished items.

## Commit messages

Short Conventional Commits are recommended:

```text
docs: clarify WorkPet quickstart
fix: reject stale runner lease
feat: add directory capability filter
test: cover federation retry
```

<!-- TODO: Confirm reviewers, branch protection, required CI checks, and release approval rules. -->
