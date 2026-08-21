import { acceptUpMessage, pollMessages } from '../messaging.js';

export function acceptMessage(command) {
  return acceptUpMessage(command);
}

export function pollMessageFeed(agentInstanceId, since, limit) {
  return pollMessages(agentInstanceId, since, limit);
}
