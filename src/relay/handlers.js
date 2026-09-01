import { resolveBackend, listEnvs } from './router.js';
import {
  annotateAlive,
  upsertWpSlot,
  touchWpSlot,
} from './wpSlots.js';
import {
  dispatchWorkPanel,
  wpListGroups,
  wpGetGroup,
  wpGetPresence,
  wpListGroupMessages,
  wpPresenceHeartbeat,
  wpSession,
  pickSender,
  serverForPet,
  selfInGroup,
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
  issueLoginPet,
} from './registry.js';
import { acceptMessage, pollMessageFeed } from './services/messageService.js';
import { pickAdminAgent } from './mentions.js';
import { deliverWithRetry } from './delivery.js';
import { db, getRun, getMessageById, upsertRun } from './db.js';
import { formatPetStamp } from './petStamp.js';
import {
  registerRunner,
  heartbeatRunner,
  pollRunnerTasks,
  acknowledgeRunnerTask,
  renewRunnerTask,
  asAgentTasksResult,
  submitRunnerTaskResult,
  postRunnerResultToGroup,
} from './runners.js';
import { hostRole, registerHostPeer, heartbeatHostPeer, listHostPeers, revokeHostPeer, rotateHostPeerToken } from './hostPeers.js';
import { hostJoinState } from './hostJoin.js';
import { setSessionWpAuth } from './sessionWpAuth.js';
import { listTasks, requeueTask, cancelTask } from './services/taskQueueService.js';
import { dispatchToRunnerIfBound } from './services/dispatchService.js';
import { listRunnerDirectory } from './services/directoryService.js';
import { projectWpGroupMembers } from './directory.js';
import {
  approveEnrollment,
  createEnrollment,
  listEnrollments,
  rejectEnrollment,
  rotateCredential,
} from './enrollment.js';
import { revokeCredential } from './credentialStore.js';
import { enqueueFederationRunEvent, federationBacklogState, flushFederationOutboxOnce, listFederationOutbox, requeueFederationOutbox } from './services/federationService.js';
import { appendAudit } from './auditLog.js';
import { listSecurityDeliveries, operationalHealthDetail, traceTimeline } from './telemetry.js';
import { createFederationPolicy, disableFederationPolicy, listFederationPolicies } from './handlers/policyHandlers.js';
import { directoryEndpointsHandler, directorySubjectsHandler, routeExplainHandler } from './handlers/directoryHandlers.js';
import {
  cancelWorkpanelDispatch,
  createWorkpanelDispatch,
  getWorkpanelDispatch,
} from './services/workpanelDispatchService.js';
import {
  federationAcceptHandler, federationAckHandler, federationAdvertiseHandler,
  federationCompleteHandler, federationDirectoryHandler, federationPullHandler,
} from './handlers/federationHostHandlers.js';

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
      return { resolved, server: serverForPet(resolved.backend, config, auth.petId) };
    } catch (err) {
      const status = err.code === 'PROD_FORBIDDEN' ? 403 : 400;
      return { error: { status, body: { error: err.message, code: err.code } } };
    }
  }

  async function denyIfNotMember(server, got) {
    let session = { userId: null };
    try {
      session = await wpSession(server, { timeoutMs: 4000 });
    } catch {
      session = { userId: null };
    }
    if (!selfInGroup(got.group, got.members, { userId: session.userId })) {
      return {
        denied: {
          status: 403,
          body: { error: 'not a member of this group', code: 'NOT_IN_GROUP' },
        },
        session,
      };
    }
    return { denied: null, session };
  }

  return {
    health() {
      const join = hostJoinState();
      return {
        status: 200,
        body: {
          ok: true,
          service: 'connecter-relay',
          host: {
            role: hostRole(config),
            linked: join.linked,
            controlLinked: join.controlLinked,
            siteId: join.siteId,
            lastError: join.lastError,
            federation: { ...join.federation, ...federationBacklogState() },
          },
        },
      };
    },

    async login(body = {}) {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) {
        return { status: 400, body: { error: 'username and password required' } };
      }
      try {
        const resolved = resolveBackend(config, body.env, { client: 'pet' });
        const server = {
          kind: 'workpanel',
          baseUrl: resolved.backend.baseUrl,
          auth: { username, password },
        };
        const session = await wpSession(server, { force: true });
        const issued = await issueLoginPet(config, { username });
        setSessionWpAuth(issued.petId, {
          username,
          password,
          wpUserId: session.userId,
        });
        return {
          status: 200,
          body: {
            token: issued.token,
            petId: issued.petId,
            username,
            userId: session.userId,
            env: resolved.env,
          },
        };
      } catch (err) {
        if (err.code === 'PROD_FORBIDDEN') {
          return { status: 403, body: { error: err.message, code: err.code } };
        }
        const msg = String(err.message || err);
        if (msg.includes('wp login failed')) {
          return { status: 401, body: { error: 'invalid credentials', code: 'LOGIN_FAILED' } };
        }
        return { status: 502, body: { error: msg } };
      }
    },

    async envs() {
      const envs = await annotateAlive(listEnvs(config));
      return {
        status: 200,
        body: { envs, defaults: config.defaults || {} },
      };
    },

    async backendRegister(auth, body = {}) {
      if (auth.kind !== 'ops') {
        return { status: 403, body: { error: 'ops token required' } };
      }
      try {
        const slot = await upsertWpSlot({
          name: body.name || body.env,
          baseUrl: body.baseUrl,
          kind: body.kind,
          auth: body.auth,
        });
        return { status: 200, body: { ok: true, slot } };
      } catch (err) {
        const status = err.code === 'PROD_FORBIDDEN' ? 403 : 400;
        return { status, body: { error: err.message, code: err.code } };
      }
    },

    async backendHeartbeat(auth, body = {}) {
      if (auth.kind !== 'ops') {
        return { status: 403, body: { error: 'ops token required' } };
      }
      try {
        return { status: 200, body: await touchWpSlot(body.name || body.env) };
      } catch (err) {
        const status = err.code === 'UNKNOWN_SLOT' ? 404 : 400;
        return { status, body: { error: err.message, code: err.code } };
      }
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
      let session = { userId: null };
      try {
        session = await wpSession(gate.server, { timeoutMs: 4000 });
      } catch {
        session = { userId: null };
      }
      const visible = [];
      for (const row of listed.groups || []) {
        const got = await wpGetGroup(gate.server, row.id);
        if (!got.ok) continue;
        if (selfInGroup(got.group, got.members, { userId: session.userId })) {
          visible.push(row);
        }
      }
      return {
        status: 200,
        body: {
          env: gate.resolved.env,
          groups: visible.map(toGroupListItem),
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
      const gateMember = await denyIfNotMember(gate.server, got);
      if (gateMember.denied) return gateMember.denied;
      await wpPresenceHeartbeat(gate.server, { timeoutMs: 3000 });
      const session = gateMember.session;
      const presence = await wpGetPresence(gate.server);
      const onlineUserIds = presence.ok ? presence.onlineUserIds : [];
      const members = got.members || [];
      try {
        await projectWpGroupMembers(config, got.group?.id || id, members, onlineUserIds);
      } catch {
        // Direct handler unit use may not bootstrap SQLite; group proxy remains available.
      }
      const me = pickSender(got.group, members, { userId: session.userId });
      const admin = pickAdminAgent(got.group, members);
      return {
        status: 200,
        body: {
          env: gate.resolved.env,
          group: { id: got.group?.id, name: got.group?.name },
          adminAgent: admin ? { id: admin.id, displayName: admin.displayName } : null,
          selfMemberId: me?.id || null,
          members: members.map((m) => {
            const dto = toGroupMember(m, onlineUserIds);
            const self = me ? m.id === me.id : false;
            return { ...dto, self, online: dto.online || self };
          }),
          coordinatorAgent: admin?.displayName || coordinatorAgentName(members, gate.resolved.defaults),
        },
      };
    },

    async groupMessages(auth, id, query = {}) {
      const gate = petBackend(auth, query.env);
      if (gate.error) return gate.error;
      const got = await wpGetGroup(gate.server, id);
      if (!got.ok) {
        if (got.status === 404) {
          return { status: 404, body: { error: got.error || 'group not found' } };
        }
        return {
          status: 502,
          body: { error: got.error || 'wp messages failed', code: 'WP_GROUPS_FAILED' },
        };
      }
      const gateMember = await denyIfNotMember(gate.server, got);
      if (gateMember.denied) return gateMember.denied;
      const listed = await wpListGroupMessages(gate.server, id, { limit: query.limit });
      if (!listed.ok) {
        if (listed.status === 404) {
          return { status: 404, body: { error: listed.error || 'group not found' } };
        }
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

        const chatMember = await denyIfNotMember(server, got);
        if (chatMember.denied) return chatMember.denied;

        await wpPresenceHeartbeat(server, { timeoutMs: 3000 });

        const target = resolveChatTarget({
          prompt: String(prompt),
          members: got.members || [],
          group: got.group,
        });
        if (!target.ok) {
          return {
            status: 400,
            body: { error: target.error, code: target.code, mention: target.mention },
          };
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
        const mentionedAgent = target.mentioned ? target.agent.displayName : null;
        const coordinatorAgent = target.agent.displayName;

        const accepted = await acceptMessage({
          messageId: body.id,
          agentInstance: instance,
          petId: auth.petId,
          content: formatted,
          toAgentName: target.agent.displayName,
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
              coordinatorAgent,
              mentionedAgent,
            },
          };
        }

          // E2: runner-bound target -> enqueue (must have fresh heartbeat)
          const runnerDispatch = await dispatchToRunnerIfBound(config, {
            instance,
            targetAgentName: target.agent.displayName,
            upMessage: accepted.message,
            content: target.rest,
            context: { source: 'pet-chat' },
          });
          if (runnerDispatch.matched) {
            if (!runnerDispatch.ok) {
              return {
                status: 503,
                body: {
                  error: 'runner_offline',
                  runner: {
                    agentId: runnerDispatch.binding.runner_id,
                    channelId: runnerDispatch.binding.channel_id,
                  },
                },
              };
            }
            if (runnerDispatch.remote) {
              upsertRun(db(), {
                id: runnerDispatch.task.id,
                message_id: accepted.message.id,
                agent_instance_id: accepted.message.agent_instance_id,
                status: 'queued',
                detail_json: JSON.stringify({ traceId: runnerDispatch.routeDecision?.traceId, targetSite: runnerDispatch.binding.target_site }),
              });
            }
            return {
              status: 200,
              body: {
                status: 'accepted',
                env: instance.env,
                messageId: accepted.envelope.id,
                seq: accepted.message.seq,
                runIds: [runnerDispatch.task.id],
                group: instance.group_id,
                coordinatorAgent,
                mentionedAgent,
                runner: {
                  agentId: runnerDispatch.binding.runner_id,
                  channelId: runnerDispatch.binding.channel_id,
                },
                traceId: runnerDispatch.routeDecision?.traceId || null,
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
              coordinatorAgent,
              mentionedAgent,
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
            coordinatorAgent,
            mentionedAgent,
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
      const gate = petBackend(auth, env);
      if (gate.error) return gate.error;
      const groupKey = group || gate.resolved.defaults?.group;
      if (!groupKey) {
        return { status: 400, body: { error: 'group required' } };
      }
      let got = await wpGetGroup(gate.server, groupKey);
      if (!got.ok) {
        const listed = await wpListGroups(gate.server);
        const hit =
          listed.ok &&
          (listed.groups || []).find((g) => g.id === groupKey || g.name === groupKey);
        if (hit) got = await wpGetGroup(gate.server, hit.id);
      }
      if (!got.ok) {
        return {
          status: got.status === 404 ? 404 : 502,
          body: { error: got.error || 'wp group failed' },
        };
      }
      const gateMember = await denyIfNotMember(gate.server, got);
      if (gateMember.denied) return gateMember.denied;
      await wpPresenceHeartbeat(gate.server, { timeoutMs: 3000 });
      const session = gateMember.session;
      const presence = await wpGetPresence(gate.server);
      const onlineUserIds = presence.ok ? presence.onlineUserIds : [];
      const members = got.members || [];
      const me = pickSender(got.group, members, { userId: session.userId });
      const admin = pickAdminAgent(got.group, members);
      return {
        status: 200,
        body: {
          env: gate.resolved.env,
          groupId: got.group?.id,
          groupName: got.group?.name,
          adminAgent: admin ? { id: admin.id, displayName: admin.displayName } : null,
          selfMemberId: me?.id || null,
          members: members.map((m) => {
            const dto = toGroupMember(m, onlineUserIds);
            const self = me ? m.id === me.id : false;
            return { ...dto, self, online: dto.online || self };
          }),
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
      const items = pollMessageFeed(instance.id, since, limit);
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

      agentHeartbeat(auth, body = {}) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        return { status: 200, body: heartbeatRunner(config, auth.runner, body) };
      },

      async agentTasks(auth, { limit }) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        const pulled = await pollRunnerTasks(config, auth.runner, { limit });
        return asAgentTasksResult(pulled);
      },

      enrollmentCreate(body) {
        return createEnrollment(config, body);
      },

      enrollmentList(auth, query) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return { status: 200, body: { enrollments: listEnrollments(query) } };
      },

      enrollmentApprove(auth, enrollmentId, body) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return approveEnrollment(config, enrollmentId, body, 'ops').then((result) => {
          appendAudit({ eventType: 'enrollment.approve', outcome: result.status === 200 ? 'allow' : 'deny', actor: 'ops', detail: { enrollmentId } });
          return result;
        });
      },

      enrollmentReject(auth, enrollmentId) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        const result = rejectEnrollment(enrollmentId, 'ops');
        appendAudit({ eventType: 'enrollment.reject', outcome: result.status === 200 ? 'allow' : 'deny', actor: 'ops', detail: { enrollmentId } });
        return result;
      },

      credentialRotate(auth) {
        if (auth.kind !== 'runner' || !auth.credential) {
          return { status: 403, body: { error: 'device credential required' } };
        }
        return rotateCredential(config, auth.credential).then((result) => {
          appendAudit({ eventType: 'credential.rotate', outcome: result.status === 200 ? 'allow' : 'deny',
            actor: auth.credential.subject_id, subjectId: auth.credential.subject_id,
            detail: { credentialId: auth.credential.id } });
          return result;
        });
      },

      credentialRevoke(auth, credentialId) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        const revoked = revokeCredential(credentialId);
        appendAudit({ eventType: 'credential.revoke', outcome: revoked ? 'allow' : 'deny', actor: 'ops', detail: { credentialId } });
        return revoked
          ? { status: 200, body: { ok: true, credentialId, status: 'revoked' } }
          : { status: 404, body: { error: 'active credential not found' } };
      },

      async agentTaskAck(auth, body) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        return acknowledgeRunnerTask(config, auth.runner, body);
      },

      async agentTaskRenew(auth, body) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        return renewRunnerTask(config, auth.runner, body);
      },

      async agentTaskResult(auth, body) {
        if (auth.kind !== 'runner') {
          return { status: 403, body: { error: 'runner token required' } };
        }
        const r = await submitRunnerTaskResult(config, auth.runner, body);
        const task = r?.status === 200
          ? db().prepare(`SELECT * FROM runner_tasks WHERE id=?`).get(body.taskId)
          : null;
        if (r?.status === 200 && !r?.body?.duplicate && r?.body?.federation && ['completed', 'failed', 'cancelled'].includes(r.body.status)) {
          await enqueueFederationRunEvent(config, task, body);
          await flushFederationOutboxOnce(config).catch(() => {});
        }
        // E2: best-effort write-back into the WP group thread (as the agent)
        let taskContext = {};
        try { taskContext = task?.context_json ? JSON.parse(task.context_json) : {}; } catch {}
        if (r?.status === 200 && !r?.body?.duplicate && r?.body?.status === 'completed' && body.writeBack !== false && taskContext.writeBack !== false) {
          postRunnerResultToGroup(config, auth.runner, body).catch(() => {});
        }
        return r;
      },

      agentList(auth, { env, group }) {
        if (auth.kind !== 'ops') {
          return { status: 403, body: { error: 'ops token required' } };
        }
        return { status: 200, body: { agents: listRunnerDirectory({ env, group }) } };
      },

      opsTasks(auth, query) {
        if (auth.kind !== 'ops') {
          return { status: 403, body: { error: 'ops token required' } };
        }
        return { status: 200, body: { tasks: listTasks(query) } };
      },

      directorySubjects(auth, query) {
        return directorySubjectsHandler(auth, query);
      },

      directoryEndpoints(auth, query) {
        return directoryEndpointsHandler(auth, query);
      },

      routeExplain(auth, query) {
        return routeExplainHandler(auth, query);
      },

      workpanelDispatchCreate(auth, body, options) {
        return createWorkpanelDispatch(config, auth, body, options);
      },

      workpanelDispatchGet(auth, dispatchId) {
        return getWorkpanelDispatch(config, auth, dispatchId);
      },

      workpanelDispatchCancel(auth, dispatchId, body) {
        return cancelWorkpanelDispatch(config, auth, dispatchId, body);
      },

      opsTaskRequeue(auth, taskId, body) {
        if (auth.kind !== 'ops') {
          return { status: 403, body: { error: 'ops token required' } };
        }
        const result = requeueTask(taskId, { actor: 'ops', reason: body?.reason });
        appendAudit({ eventType: 'task.manual_requeue', outcome: 'allow', actor: 'ops', taskId, detail: { reason: body?.reason } });
        return result;
      },

      opsTaskCancel(auth, taskId, body) {
        if (auth.kind !== 'ops') {
          return { status: 403, body: { error: 'ops token required' } };
        }
        const result = cancelTask(taskId, { actor: 'ops', reason: body?.reason });
        appendAudit({ eventType: 'task.manual_cancel', outcome: 'allow', actor: 'ops', taskId, detail: { reason: body?.reason } });
        return result;
      },

      hostPeerRegister(body) {
        return registerHostPeer(config, body);
      },

      hostPeerHeartbeat(auth) {
        if (auth.kind !== 'peer') {
          return { status: 403, body: { error: 'peer token required' } };
        }
        return heartbeatHostPeer(auth.peer);
      },

      hostPeerList(auth) {
        if (auth.kind !== 'ops') {
          return { status: 403, body: { error: 'ops token required' } };
        }
        return { status: 200, body: { peers: listHostPeers(config) } };
      },

      hostPeerRevoke(auth, siteId) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        const result = revokeHostPeer(siteId);
        appendAudit({ eventType: 'host.peer_revoke', outcome: result.status === 200 ? 'allow' : 'deny', actor: 'ops', siteId });
        return result;
      },

      hostPeerRotate(auth, siteId, body) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        const result = rotateHostPeerToken(config, siteId, body?.token);
        appendAudit({ eventType: 'host.peer_rotate', outcome: result.status === 200 ? 'allow' : 'deny', actor: 'ops', siteId });
        return result;
      },

      federationAccept(auth, body) {
        return federationAcceptHandler(config, auth, body);
      },

      federationPull(auth, body) {
        return federationPullHandler(config, auth, body);
      },

      federationAck(auth, body) {
        return federationAckHandler(config, auth, body);
      },

      federationComplete(auth, body) {
        return federationCompleteHandler(config, auth, body);
      },

      federationAdvertise(auth, body) {
        return federationAdvertiseHandler(config, auth, body);
      },

      federationDirectory(auth, query) {
        return federationDirectoryHandler(config, auth, query);
      },

      opsHealthDetail(auth) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return { status: 200, body: { ok: true, metrics: operationalHealthDetail(), host: hostJoinState() } };
      },

      opsTrace(auth, traceId) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return { status: 200, body: traceTimeline(traceId) };
      },

      opsPolicyList(auth, query) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return { status: 200, body: { policies: listFederationPolicies(query) } };
      },

      opsPolicyCreate(auth, body) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return createFederationPolicy(body, { actor: 'ops' });
      },

      opsPolicyDisable(auth, id) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return disableFederationPolicy(id, { actor: 'ops' });
      },

      opsFederationOutbox(auth, query) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return { status: 200, body: { entries: listFederationOutbox(query) } };
      },

      async opsFederationOutboxRequeue(auth, id) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        const result = await requeueFederationOutbox(id);
        appendAudit({ eventType: 'federation.outbox_requeue', outcome: result.status === 200 ? 'allow' : 'deny', actor: 'ops', detail: { id } });
        return result;
      },

      opsSecurityDeliveries(auth, query) {
        if (auth.kind !== 'ops') return { status: 403, body: { error: 'ops token required' } };
        return { status: 200, body: { deliveries: listSecurityDeliveries(query) } };
      },
  };
}
