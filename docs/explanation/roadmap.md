# Roadmap

[English](roadmap.md) · [简体中文](roadmap.zh-CN.md)

This roadmap uses estimated quarters, not fixed delivery dates. A formal plan is not a promise; move an item to Backlog when evidence, capacity, or dependencies change.

## Shipped baseline

- v0.2.x: Site Connecter, Runner lease and fencing, Directory v2, enrollment, durable federation, signing and mTLS client support are implemented within the local evidence boundary;
- v0.2.3: WorkPet NSIS installer, Connecter portable Windows package, checksums, and the documentation/release gate are available.

## Formal plan

### v0.3.x — estimated 2026 Q3

- Prove a real two-site deployment with an independent Connecter Host;
- Complete production CA/mTLS operations, key rotation, external alerting, and long-duration soak evidence;
- Complete Windows Authenticode signing for release artifacts.

### v0.4.x — estimated 2026 Q4

- Define a stable adapter contract for additional WorkPanel-compatible backends;
- Improve WorkPet onboarding and update guidance based on real user validation.

## Backlog — needs evaluation

- Host high availability, external database/queue, or Raft-based coordination if the single-Host boundary becomes a measured bottleneck;
- WebSocket or SSE delivery when polling is no longer sufficient;
- Additional A2A/ACP adapter integrations after their contracts and security boundaries are reviewed.

## Maintenance rules

- Use estimated quarters only; do not write an exact date as a commitment;
- Keep Formal plan and Backlog separate;
- Link each shipped item to code, tests, or release evidence;
- Move completed items to the shipped baseline and record deferred items with a reason;
- Confirm roadmap changes with maintainers before changing the quarter.

<!-- TODO: Confirm the owner and quarter for each formal-plan item. -->
