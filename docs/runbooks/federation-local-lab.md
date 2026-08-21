# Federation local lab

Date: 2026-08-22

This lab verifies the production topology locally with independent processes and SQLite databases:

```text
WorkPanel mock <- Site A Connecter -> Connecter Host <- Site B Connecter <- Runner B
```

## Automated acceptance

Run the complete local release gate from the repository root:

```powershell
npm run test:release-local
```

The federation-specific gates can also be run independently:

```powershell
npm run test:federation
npm run test:federation-chaos
npm run test:federation-host-loss
npm run test:federation-origin-restart
npm run test:federation-target-restart
npm run test:federation-host-restart
npm run test:federation-inbox-retry
npm run test:federation-workpanel-outage
npm run test:trace-e2e
npm run test:soak-smoke
```

These tests use temporary configuration, databases and ports. They verify Site A command acceptance, Host transit, Site B Runner execution, result return to Site A, origin WorkPanel write-back, idempotent terminal projection, backlog drain and trace/audit visibility.

## Fault coverage

| Gate | Fault or invariant |
|---|---|
| `test:federation` | Normal command/result round trip, WorkPanel write-back, late conflicting terminal |
| `test:federation-chaos` | Host and Site B stop and recover; local Site A traffic remains available |
| `test:federation-host-loss` | Host database is destroyed after acceptance; Site outbox reconstructs unfinished transit |
| `test:federation-origin-restart` | Site A restarts while the remote command is in flight |
| `test:federation-inbox-retry` | Lost ack response, retained target body, local retry and later Runner recovery |
| `test:federation-target-restart` | Site B alone restarts while the Host retains the queued command |
| `test:federation-host-restart` | Host alone restarts while both Sites stay online and reconcile transit |
| `test:federation-workpanel-outage` | Origin WorkPanel outage/restart; remote terminal remains committed and failure is independently observable |
| `test:trace-e2e` | End-to-end trace, audit and operational projections |
| `test:soak-smoke` | Repeated fresh three-process round trips and clean backlog termination |

## Production-equivalent acceptance

The local lab is not evidence for network TLS/mTLS, firewall/NAT behavior, a real WorkPanel deployment or long-duration capacity. Before production promotion, repeat the topology on at least two Site servers plus a separate Host, use externally stored signing keys and HTTPS/mTLS at the ingress, run the real WorkPanel canary, and retain evidence from the 72-hour soak.
