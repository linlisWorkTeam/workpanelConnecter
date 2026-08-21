import {
  acceptFederationMessage,
  ackFederationMessage,
  advertiseFederationRoutes,
  completeFederationMessage,
  listFederationRoutes,
  pullFederationMessages,
} from '../federationHost.js';

function requirePeer(auth) {
  return auth?.kind === 'peer' ? null : { status: 403, body: { error: 'peer token required' } };
}

export function federationAcceptHandler(config, auth, body) {
  return requirePeer(auth) || acceptFederationMessage(config, auth.peer, body);
}
export function federationPullHandler(config, auth, body) {
  return requirePeer(auth) || pullFederationMessages(config, auth.peer, body);
}
export function federationAckHandler(config, auth, body) {
  return requirePeer(auth) || ackFederationMessage(config, auth.peer, body);
}
export function federationCompleteHandler(config, auth, body) {
  return requirePeer(auth) || completeFederationMessage(config, auth.peer, body);
}
export function federationAdvertiseHandler(config, auth, body) {
  return requirePeer(auth) || advertiseFederationRoutes(config, auth.peer, body);
}
export function federationDirectoryHandler(config, auth, query) {
  return requirePeer(auth) || listFederationRoutes(config, auth.peer, query);
}
