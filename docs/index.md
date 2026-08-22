# WorkPanelConnecter Documentation

[English](index.md) · [简体中文](index.zh-CN.md)

WorkPanelConnecter connects WorkPet, WorkPanel, users, and Runners to a site Connecter, with cross-site directory and message relay through Connecter Host.

## Choose a document type

| Type | Best for | Entry point |
|---|---|---|
| Tutorials | First-time installation and operation | [Quickstart](tutorials/quickstart.md) |
| How-to | Completing one concrete task | [How-to guides](how-to/README.md) |
| Explanation | Understanding boundaries, design choices, and roadmap | [Explanation](explanation/README.md) |
| Reference | Looking up commands, configuration, or APIs | [Reference](reference/README.md) |

## Language policy

The public entry documents use Markdown language pairs. English is the default file; the matching `.zh-CN.md` file is the Simplified Chinese translation. Each pair links to the other language at the top.

## Detailed documents

- [Current architecture](architecture.md)
- [Relay API](api-relay.md)
- [Relay configuration](relay-config.md)
- [Runner protocol](protocol/runners.md)
- [Directory v2](protocol/directory-v2.md)
- [Federation v1](protocol/federation-v1.md)
- [Local federation lab](runbooks/federation-local-lab.md)
- [Implementation status and evidence boundaries](P0-P3-IMPLEMENTATION-STATUS.md)
- [Security review](security-review.md)
- [Documentation audit](DOCUMENTATION-AUDIT.md)

## Source-of-truth order

Use this order when sources disagree: running code and schemas → automated tests → current reference documents → current operations documents → design records → historical snapshots.

`docs/superpowers/`, `canary-*`, `releases/`, and old plans or handoffs preserve historical context. Do not use them alone to determine current feature status.
