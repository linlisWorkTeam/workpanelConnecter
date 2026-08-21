# Rolling upgrade runbook

1. Back up every Site database and the Host database and run the compatibility matrix.
2. Upgrade the Host first or last; federation v1 tolerates additional unknown fields but rejects an unknown protocol major.
3. Upgrade one Site, verify local chat, Host link, Directory advertisement, a cross-site command, and result return.
4. Continue site by site. Do not roll database schema backward; use the previous binary only while its declared compatibility window includes the current nullable schema.
5. Roll back traffic with `federation.enabled=false` or remove the Site/group allowlist entry. Local Site traffic must remain available.
