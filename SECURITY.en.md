# Security policy

[English](SECURITY.en.md) · [简体中文](SECURITY.md)

## Reporting a vulnerability

Do not disclose an unfixed security issue in a public Issue, discussion, or commit message.

<!-- TODO: Add a security email or GitHub Private Vulnerability Reporting link. -->

Reports should include at least:

- affected version, commit, or release package;
- reproducible steps and a minimal example;
- impact, required permissions, and possible exploit conditions;
- whether the issue has already been disclosed publicly and the preferred contact channel.

## Handling secrets

- Never commit tokens, passwords, private keys, certificates, signing secrets, or a real `config/relay.json`;
- Use `config/relay.example.json`, environment variables, or restricted external files to describe configuration shape;
- If a secret is committed, revoke or rotate it immediately and describe the exposure scope in the security report.

## Supported versions

The supported-version policy has not been formally published.

<!-- TODO: Add supported versions, remediation timelines, and the public disclosure process. -->
