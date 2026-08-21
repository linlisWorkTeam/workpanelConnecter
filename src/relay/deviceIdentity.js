import { findCredentialByToken } from './credentialStore.js';

export function requireDeviceScope(token, scope) {
  const credential = findCredentialByToken(token);
  if (!credential) return { allowed: false, reason: 'CREDENTIAL_INVALID' };
  const scopes = credential.scopes || {};
  const granted = [...(scopes.operations || []), ...(scopes.capabilities || [])];
  return granted.includes(scope) || granted.includes('*')
    ? { allowed: true, credentialId: credential.id, keyId: credential.key_id }
    : { allowed: false, reason: 'SCOPE_DENIED' };
}

export function assertPrivateKeyStorage(config) {
  const inline = config?.deviceIdentity?.privateKey || config?.federation?.privateKey;
  if (inline) throw new Error('private keys must use an OS secret store or restricted external file');
  return true;
}
