# E2 可插拔 Runner Implementation Plan

> **For agentic workers:** implement in this repo; do not wait on WP P0/P1.

**Goal:** Generic outbound runner slot, serial+TTL, two-phase `/v1/messages`, live canary WP acceptance (no echo mock).

**Architecture:** Keep `/v1/agents/*`. First plug-in `scripts/wp-runner.js` pulls tasks and really `POST`s canary WP, then polls group messages for `parentRunId`. Connecter does not run models or ACP.

**Tech Stack:** Node ≥18, `node:sqlite`, existing `workpanelClient`.

## Global Constraints

- No nginx / firewall / :8080/:8081 listen changes
- No DSH / full ACP in Connecter
- Canary only for live gate; refuse prod 8080
- WP code changes are optional (`docs/WP-E2-COLLAB.md`)
