import {
  enqueueRunnerTask,
  findRunnerBinding,
  findRunnerBindingForRunner,
  isRunnerHeartbeatFresh,
  runnerHeartbeatTtlSec,
} from '../runners.js';
import { groupRef, newTraceContext } from './identityService.js';
import { resolveRoute } from '../routeResolver.js';
import { siteIdFor } from '../directory.js';
import { enqueueFederationEnvelope, flushFederationOutboxOnce } from '../federationSite.js';
import { stableSubjectId } from './identityService.js';

export async function dispatchToRunnerIfBound(
  config,
  { instance, targetAgentName, upMessage, content, context = null }
) {
  let binding = findRunnerBinding({ ...instance, agent_name: targetAgentName });
  let routeDecision = null;
  if (config?.directoryV2Shadow || config?.directoryV2RoutingEnabled) {
    const siteId = siteIdFor(config);
    routeDecision = resolveRoute({
      groupRef: groupRef({ authority: siteId, groupId: instance.group_id }),
      agentName: targetAgentName,
      requiredCapabilities: context?.requiredCapabilities || [],
      sourceSiteId: siteId,
      traceId: context?.traceId || newTraceContext().traceId,
    });
    if (config.directoryV2RoutingEnabled && routeDecision.target) {
      if (routeDecision.target.siteId === siteId) {
        binding = findRunnerBindingForRunner({
          runnerId: routeDecision.target.localId,
          env: instance.env,
          groupId: instance.group_id,
          agentName: targetAgentName,
        });
      } else {
        if (config?.federation?.enabled === false) return { matched: false, routeDecision, federationDisabled: true };
        const envelope = await enqueueFederationEnvelope(config, {
          targetSite: routeDecision.target.siteId,
          groupRef: routeDecision.groupRef,
          fromSubject: stableSubjectId({ siteId, kind: 'workpet', localId: instance.pet_id || 'relay' }),
          toSubject: routeDecision.target.subjectId,
          kind: 'chat.command',
          correlationId: context?.correlationId,
          causationId: context?.causationId,
          traceId: routeDecision.traceId,
          payload: {
            originalMessageId: upMessage?.id,
            env: instance.env,
            groupName: instance.group_name,
            agentName: targetAgentName,
            content,
            context,
          },
        });
        await flushFederationOutboxOnce(config).catch(() => {});
        return {
          matched: true, ok: true, status: 202, remote: true, routeDecision, envelope,
          binding: { runner_id: routeDecision.target.subjectId, channel_id: 'federation', target_site: routeDecision.target.siteId },
          task: { id: envelope.correlationId },
        };
      }
    }
    if (config.directoryV2RoutingEnabled && !routeDecision.target && (context?.requiredCapabilities || []).length) {
      return { matched: true, ok: false, status: 503, error: 'no_eligible_route', routeDecision };
    }
  }
  if (!binding) return { matched: false };
  if (!isRunnerHeartbeatFresh(binding, runnerHeartbeatTtlSec(config))) {
    return { matched: true, ok: false, status: 503, error: 'runner_offline', binding };
  }
  const task = await enqueueRunnerTask({
    config,
    runnerId: binding.runner_id,
    channelId: binding.channel_id,
    env: instance.env,
    groupId: instance.group_id,
    groupName: instance.group_name,
    agentName: targetAgentName,
    upMessage,
    content,
    context,
  });
  return { matched: true, ok: true, status: 200, binding, task, routeDecision };
}
