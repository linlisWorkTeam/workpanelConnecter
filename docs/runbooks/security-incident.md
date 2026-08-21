# Credential incident runbook

1. Disable the affected peer/device and revoke its active credential or signing key.
2. Add and deploy the `next` key, switch it to active, then revoke the old key after all peers accept it.
3. Search append-only audit events by site, subject, key ID, trace, and message; enumerate accepted deliveries during the exposure window.
   Use `GET /v1/ops/security/deliveries?siteId=&keyId=&since=&until=&status=`; it returns identifiers and state without payloads.
4. Requeue only verified non-terminal commands. Never reuse a message ID with different content.
5. Rotate bearer/bootstrap secrets, review Site/group ACLs, and preserve an encrypted database snapshot for investigation.
