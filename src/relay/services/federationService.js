// Application-service boundary for durable Site federation orchestration.
// Transport details live in federationClient.js; HTTP adapters consume this module.
export {
  enqueueFederationEnvelope,
  enqueueFederationRunEvent,
  federationBacklogState,
  flushFederationOutboxOnce,
  listFederationOutbox,
  pullFederationInboxOnce,
  reconcileFederationAcknowledgementsOnce,
  reconcileFederationInboxOnce,
  requeueFederationOutbox,
  syncFederationDirectoryOnce,
} from '../federationSite.js';
