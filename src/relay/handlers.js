import { resolveBackend, listEnvs } from './router.js';
import { dispatchWorkPanel } from '../workpanelClient.js';
import {
  resolveAgentInstance,
  listAgentInstancesForPet,
  revokePetSessions,
} from './registry.js';
import { acceptUpMessage, pollMessages } from './messaging.js';
import { deliverWithRetry } from './delivery.js';
import { db, getRun, getMessageById } from './db.js';

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
          agent: body.agent || body.agentName,
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

        const accepted = await acceptUpMessage({
          messageId: body.id,
          agentInstance: instance,
          petId: auth.petId,
          content: String(prompt),
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
  };
}
