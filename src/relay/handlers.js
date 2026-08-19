import { resolveBackend, listEnvs } from './router.js';
import {
  dispatchWorkPanel,
  wpGroupContext,
  wpPresenceHeartbeat,
  wpGetPresence,
  wpSession,
  pickSender,
  serverForPet,
} from '../workpanelClient.js';
import {
  resolveAgentInstance,
  listAgentInstancesForPet,
  revokePetSessions,
} from './registry.js';
import { acceptUpMessage, pollMessages } from './messaging.js';
import { extractMentionTarget, pickAdminAgent } from './mentions.js';
import { deliverWithRetry } from './delivery.js';
import { db, getRun, getMessageById } from './db.js';
import {
  registerRunner,
  heartbeatRunner,
  pollRunnerTasks,
  submitRunnerTaskResult,
  listRunnerBindings,
  findRunnerBinding,
  enqueueRunnerTask,
  postRunnerResultToGroup,
  isRunnerHeartbeatFresh,
  runnerHeartbeatTtlSec,
} from './runners.js';

function backendAsServer(backend) {
  return {
    kind: 'workpanel',
    baseUrl: backend.baseUrl,
    auth: backend.auth || {},
  };
}

export function createHandlers({ config }) {
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

    async chat(body, auth) {
      const prompt = body?.prompt ?? body?.content;
      if (!prompt || !String(prompt).trim()) {
        return { status: 400, body: { error: 'prompt required' } };
      }

      // --- Pet path (Phase 1.5) ---
      if (auth.kind === 'pet') {
        if (
          (body.env || config.defaults?.env) === 'prod' &&
          config.allowProdFromPet === false
        ) {
          return {
            status: 403,
            body: { error: 'prod env forbidden for pet', code: 'PROD_FORBIDDEN' },
          };
        }
        const instance = resolveAgentInstance(auth.petId, {
          env: body.env,
          group: body.group || body.groupId,
        });
        if (!instance) {
          return { status: 400, body: { error: 'no matching agent_instance for pet' } };
        }
        if (instance.env === 'prod' && config.allowProdFromPet === false) {
          return {
            status: 403,
            body: { error: 'prod env forbidden for pet', code: 'PROD_FORBIDDEN' },
          };
        }

        const backend = config.backends?.[instance.env];
        if (!backend) {
          return { status: 400, body: { error: `unknown env ${instance.env}` } };
        }
        const wpServer = serverForPet(backend, config, auth.petId);
        let groupState;
        try {
          groupState = await wpGroupContext(wpServer, {
            id: instance.group_id,
            name: instance.group_name,
          });
        } catch (err) {
          return { status: 502, body: { error: String(err.message || err) } };
        }
        const { group: wpGroup, members } = groupState;
        const mention = extractMentionTarget(prompt, members);
        let target = null;
        if (mention.hasAt) {
          if (!mention.target || mention.target.kind !== 'agent') {
            return {
              status: 400,
              body: { error: 'UNKNOWN_MENTION', code: 'UNKNOWN_MENTION', mention: mention.raw },
            };
          }
          target = mention.target;
        } else {
          target = pickAdminAgent(wpGroup, members);
          if (!target) {
            return {
              status: 400,
              body: { error: 'NO_ADMIN', code: 'NO_ADMIN' },
            };
          }
        }

        const accepted = await acceptUpMessage({
          messageId: body.id,
          agentInstance: instance,
          petId: auth.petId,
          content: String(prompt),
          toAgentName: target.displayName,
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
              coordinatorAgent: target.displayName,
              mentionedAgent: mention.hasAt ? target.displayName : null,
            },
          };
        }

          // E2: runner-bound target -> enqueue (must have fresh heartbeat)
          const runnerBinding = findRunnerBinding({
            env: instance.env,
            group_id: instance.group_id,
            agent_name: target.displayName,
          });
          if (runnerBinding) {
            if (!isRunnerHeartbeatFresh(runnerBinding, runnerHeartbeatTtlSec(config))) {
              return {
                status: 503,
                body: {
                  error: 'runner_offline',
                  runner: { agentId: runnerBinding.runner_id, channelId: runnerBinding.channel_id },
                },
              };
            }
            const task = await enqueueRunnerTask({
              runnerId: runnerBinding.runner_id,
              channelId: runnerBinding.channel_id,
              env: instance.env,
              groupId: instance.group_id,
              groupName: instance.group_name,
              agentName: target.displayName,
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
                coordinatorAgent: target.displayName,
                mentionedAgent: target.displayName,
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
              coordinatorAgent: target.displayName,
              mentionedAgent: mention.hasAt ? target.displayName : null,
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
            coordinatorAgent: target.displayName,
            mentionedAgent: mention.hasAt ? target.displayName : null,
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

    async members(auth, { group, env }) {
      if (auth.kind !== 'pet') {
        return { status: 403, body: { error: 'pet token required' } };
      }
      const instance = resolveAgentInstance(auth.petId, { env, group });
      if (!instance) {
        return { status: 400, body: { error: 'no matching agent_instance for pet' } };
      }
      const backend = config.backends?.[instance.env];
      if (!backend) return { status: 400, body: { error: `unknown env ${instance.env}` } };
      const wpServer = serverForPet(backend, config, auth.petId);
      try {
        const { group: wpGroup, members } = await wpGroupContext(wpServer, {
          id: instance.group_id,
          name: instance.group_name,
        });
        let session = { userId: null };
        try {
          session = await wpSession(wpServer, { timeoutMs: 4000 });
        } catch {
          session = { userId: null };
        }
        await wpPresenceHeartbeat(wpServer, { timeoutMs: 3000 });
        const onlineIds = await wpGetPresence(wpServer, { timeoutMs: 3000 });
        const onlineSet = new Set(onlineIds);
        const me = pickSender(wpGroup, members, { userId: session.userId });
        const admin = pickAdminAgent(wpGroup, members);
        return {
          status: 200,
          body: {
            groupId: wpGroup.id,
            groupName: wpGroup.name,
            adminAgent: admin ? { id: admin.id, displayName: admin.displayName } : null,
            selfMemberId: me?.id || null,
            members: (members || []).map((m) => {
              const self = me ? m.id === me.id : false;
              const online =
                m.kind === 'agent' || m.kind === 'chatbot'
                  ? m.isActive !== false
                  : onlineSet.has(m.authUserId) || self;
              return {
                id: m.id,
                displayName: m.displayName,
                kind: m.kind,
                isActive: m.isActive !== false,
                self,
                online,
              };
            }),
          },
        };
      } catch (err) {
        return { status: 502, body: { error: String(err.message || err) } };
      }
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
        if (r?.status === 200 && r?.body?.status === 'completed' && body.writeBack !== false) {
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
