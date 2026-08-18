import { resolveBackend, listEnvs } from './router.js';
import {
  dispatchWorkPanel,
  wpListGroups,
  wpGetGroup,
  wpGetPresence,
  wpListGroupMessages,
} from '../workpanelClient.js';
import {
  toGroupListItem,
  toGroupMember,
  coordinatorAgentName,
  mapWpMessage,
  resolveChatTarget,
} from './groupConsole.js';
import {
  resolveAgentInstance,
  listAgentInstancesForPet,
  revokePetSessions,
  ensureAgentInstance,
} from './registry.js';
import { acceptUpMessage, pollMessages } from './messaging.js';
import { deliverWithRetry } from './delivery.js';
import { db, getRun, getMessageById } from './db.js';
import { formatPetStamp } from './petStamp.js';
import {
  registerRunner,
  heartbeatRunner,
  pollRunnerTasks,
  submitRunnerTaskResult,
  listRunnerBindings,
  findRunnerBinding,
  enqueueRunnerTask,
  postRunnerResultToGroup,
} from './runners.js';

function backendAsServer(backend) {
  return {
    kind: 'workpanel',
    baseUrl: backend.baseUrl,
    auth: backend.auth || {},
  };
}

export function createHandlers({ config }) {
  function petBackend(auth, env) {
    if (auth.kind !== 'pet') {
      return { error: { status: 403, body: { error: 'pet token required' } } };
    }
    try {
      const resolved = resolveBackend(config, env, { client: 'pet' });
      return { resolved, server: backendAsServer(resolved.backend) };
    } catch (err) {
      const status = err.code === 'PROD_FORBIDDEN' ? 403 : 400;
      return { error: { status, body: { error: err.message, code: err.code } } };
    }
  }

  return {
    health() {
      return {
        status: 200,
        body: { ok: true, service: 'connecter-relay' },
      };
    },

    envs() {
      return {
        status: 200,
        body: { envs: listEnvs(config), defaults: config.defaults || {} },
      };
    },

    instances(auth) {
      if (auth.kind !== 'pet') {
        return { status: 403, body: { error: 'pet token required' } };
      }
      return {
        status: 200,
        body: { instances: listAgentInstancesForPet(auth.petId) },
      };
    },

    async groups(auth, query = {}) {
      const gate = petBackend(auth, query.env);
      if (gate.error) return gate.error;
      const listed = await wpListGroups(gate.server);
      if (!listed.ok) {
        return {
          status: 502,
          body: { error: listed.error || 'wp groups failed', code: 'WP_GROUPS_FAILED' },
        };
      }
      return {
        status: 200,
        body: {
          env: gate.resolved.env,
          groups: listed.groups.map(toGroupListItem),
        },
      };
    },

    async group(auth, id, query = {}) {
      const gate = petBackend(auth, query.env);
      if (gate.error) return gate.error;
      const got = await wpGetGroup(gate.server, id);
      if (!got.ok) {
        if (got.status === 404) {
          return { status: 404, body: { error: got.error || 'group not found' } };
        }
        return {
          status: 502,
          body: { error: got.error || 'wp group failed', code: 'WP_GROUPS_FAILED' },
        };
      }
      const presence = await wpGetPresence(gate.server);
      const onlineUserIds = presence.ok ? presence.onlineUserIds : [];
      const members = got.members || [];
      return {
        status: 200,
        body: {
          env: gate.resolved.env,
          group: { id: got.group?.id, name: got.group?.name },
          members: members.map((m) => toGroupMember(m, onlineUserIds)),
          coordinatorAgent: coordinatorAgentName(members, gate.resolved.defaults),
        },
      };
    },

    async groupMessages(auth, id, query = {}) {
      const gate = petBackend(auth, query.env);
      if (gate.error) return gate.error;
      const listed = await wpListGroupMessages(gate.server, id, { limit: query.limit });
      if (!listed.ok) {
        return {
          status: 502,
          body: { error: listed.error || 'wp messages failed', code: 'WP_GROUPS_FAILED' },
        };
      }
      return {
        status: 200,
        body: {
          messages: listed.messages.map(mapWpMessage),
        },
      };
    },

    async chat(body, auth) {
      const prompt = body?.prompt ?? body?.content;
      if (!prompt || !String(prompt).trim()) {
        return { status: 400, body: { error: 'prompt required' } };
      }

      // --- Pet path (Phase 1.5) ---
      if (auth.kind === 'pet') {
        const gate = petBackend(auth, body.env);
        if (gate.error) return gate.error;
        const { resolved, server } = gate;
        const groupKey = body.group || body.groupId || resolved.defaults?.group;
        if (!groupKey) {
          return { status: 400, body: { error: 'group required' } };
        }

        let got = await wpGetGroup(server, groupKey);
        if (!got.ok) {
          const listed = await wpListGroups(server);
          const hit =
            listed.ok &&
            (listed.groups || []).find((g) => g.id === groupKey || g.name === groupKey);
          if (hit) got = await wpGetGroup(server, hit.id);
        }
        if (!got.ok) {
          if (got.status === 404) {
            return { status: 404, body: { error: got.error || 'group not found' } };
          }
          return {
            status: 502,
            body: { error: got.error || 'wp group failed', code: 'WP_GROUPS_FAILED' },
          };
        }

        const target = resolveChatTarget({
          prompt: String(prompt),
          members: got.members || [],
          requestedAgent: body.agent || body.agentName,
          defaults: resolved.defaults || {},
        });
        if (!target.ok) {
          return { status: 400, body: { error: target.error, code: target.code } };
        }

        const instance = await ensureAgentInstance({
          petId: auth.petId,
          env: resolved.env,
          groupId: got.group.id,
          groupName: got.group.name,
          agentName: target.agent.displayName,
        });
        if (instance.env === 'prod' && config.allowProdFromPet === false) {
          return {
            status: 403,
            body: { error: 'prod env forbidden for pet', code: 'PROD_FORBIDDEN' },
          };
        }

        const petName = body.petName;
        const formatted = `@${target.agent.displayName}\n${formatPetStamp(petName)}\n${target.rest}`.trim();
        const accepted = await acceptUpMessage({
          messageId: body.id,
          agentInstance: instance,
          petId: auth.petId,
          content: formatted,
          payload: {
            content: formatted,
            formatted: true,
            mentionAgentName: target.agent.displayName,
            petName,
          },
        });

        // Idempotent replay
        if (!accepted.inserted) {
          const existing = accepted.message;
          const runs = db()
            .prepare(`SELECT * FROM runs WHERE message_id = ?`)
            .all(existing.id);
          return {
            status: 200,
            body: {
              status: existing.status === 'delivered' ? 'accepted' : existing.status,
              idempotent: true,
              env: instance.env,
              messageId: existing.id,
              seq: existing.seq,
              runIds: runs.map((r) => r.id),
              group: instance.group_id,
              coordinatorAgent: instance.agent_name,
              mentionedAgent: target.agent.displayName,
            },
          };
        }

          // E1: dsh-bound target -> enqueue outbound runner task instead of WP dispatch
          const runnerBinding = findRunnerBinding(instance);
          if (runnerBinding) {
            const task = await enqueueRunnerTask({
              runnerId: runnerBinding.runner_id,
              channelId: runnerBinding.channel_id,
              env: instance.env,
              groupId: instance.group_id,
              groupName: instance.group_name,
              agentName: instance.agent_name,
              upMessage: accepted.message,
              content: String(prompt),
              context: { source: 'pet-chat' },
            });
            return {
              status: 200,
              body: {
                status: 'accepted',
                env: instance.env,
                messageId: accepted.envelope.id,
                seq: accepted.message.seq,
                runIds: [task.id],
                group: instance.group_id,
                coordinatorAgent: instance.agent_name,
                mentionedAgent: target.agent.displayName,
                runner: { agentId: runnerBinding.runner_id, channelId: runnerBinding.channel_id },
              },
            };
          }

        const delivered = await deliverWithRetry(config, accepted.message);
        if (!delivered.ok) {
          const msg = getMessageById(db(), accepted.envelope.id);
          return {
            status: msg?.status === 'failed' ? 502 : 202,
            body: {
              status: msg?.status || 'accepted',
              env: instance.env,
              messageId: accepted.envelope.id,
              seq: accepted.message.seq,
              error: delivered.error,
              group: instance.group_id,
              coordinatorAgent: instance.agent_name,
              mentionedAgent: target.agent.displayName,
            },
          };
        }

        return {
          status: 200,
          body: {
            status: 'accepted',
            env: instance.env,
            messageId: accepted.envelope.id,
            seq: accepted.message.seq,
            runIds: delivered.runIds || [],
            wpMessageId: delivered.wpMessageId,
            group: instance.group_id,
            coordinatorAgent: instance.agent_name,
            mentionedAgent: target.agent.displayName,
          },
        };
      }

      // --- Ops path (legacy Phase 1, no pet registration) ---
      let resolved;
      try {
        resolved = resolveBackend(config, body.env, { client: 'ops' });
      } catch (err) {
        const status = err.code === 'PROD_FORBIDDEN' ? 403 : 400;
        return { status, body: { error: err.message, code: err.code } };
      }

      const { env, backend, defaults } = resolved;
      if (env === 'prod' && config.allowProdFromPet === false && body.client === 'pet') {
        return {
          status: 403,
          body: { error: 'prod env forbidden for pet', code: 'PROD_FORBIDDEN' },
        };
      }

      const group = body.group || defaults.group;
      const agent = body.agent || defaults.coordinatorAgentName;
      if (!group) {
        return { status: 400, body: { error: 'group required' } };
      }

      const result = await dispatchWorkPanel(
        backendAsServer(backend),
        {
          id: group,
          name: group,
          coordinatorAgentName: agent,
        },
        String(prompt)
      );

      if (!result.ok) {
        return {
          status: 502,
          body: { status: 'failed', env, error: result.error },
        };
      }

      return {
        status: 200,
        body: {
          status: 'accepted',
          env,
          messageId: result.body?.messageId || result.taskId,
          runIds: result.body?.runIds || [],
          group,
          coordinatorAgent: result.body?.coordinatorAgent || agent,
        },
      };
    },

    messages(auth, { since, group, env, agent, limit }) {
      if (auth.kind !== 'pet') {
        return { status: 403, body: { error: 'pet token required' } };
      }
      const instance = resolveAgentInstance(auth.petId, { env, group, agent });
      if (!instance) {
        return { status: 400, body: { error: 'no matching agent_instance' } };
      }
      const items = pollMessages(instance.id, since, limit);
      const nextCursor = items.length ? items[items.length - 1].seq : Number(since) || 0;
      return {
        status: 200,
        body: {
          agentInstanceId: instance.id,
          since: Number(since) || 0,
          nextCursor,
          messages: items,
        },
      };
    },

    runs(id) {
      const row = getRun(db(), id);
      if (row) {
        return { status: 200, body: row };
      }
      // fallback message id
      const msg = getMessageById(db(), id);
      if (msg) {
        return { status: 200, body: msg };
      }
      return { status: 404, body: { error: 'not found' } };
    },

    logs(limit) {
      const n = Number(limit);
      const rows = db()
        .prepare(
          `SELECT * FROM messages ORDER BY seq DESC LIMIT ?`
        )
        .all(Number.isFinite(n) && n > 0 ? n : 10);
      return { status: 200, body: { logs: rows } };
    },

    async revoke(auth) {
      if (auth.kind !== 'pet') {
        return { status: 403, body: { error: 'pet token required' } };
      }
      await revokePetSessions(auth.petId);
      return { status: 200, body: { ok: true, petId: auth.petId, status: 'revoked' } };
    },

      agentRegister(body) {
        return registerRunner(config, body);
      },

      agentHeartbeat(auth) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        return { status: 200, body: heartbeatRunner(auth.runner) };
      },

      agentTasks(auth, { limit }) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        return pollRunnerTasks(auth.runner, { limit });
      },

      async agentTaskResult(auth, body) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        const r = await submitRunnerTaskResult(config, auth.runner, body);
        // E2: best-effort write-back into the WP group thread (as the agent)
        if (r?.status === 200 && r?.body?.status === 'completed') {
          postRunnerResultToGroup(config, auth.runner, body).catch(() => {});
        }
        return r;
      },

      agentList(auth, { env, group }) {
        if (auth.kind !== 'ops') {
          return { status: 403, body: { error: 'ops token required' } };
        }
        return { status: 200, body: { agents: listRunnerBindings({ env, group }) } };
      },
  };
}
