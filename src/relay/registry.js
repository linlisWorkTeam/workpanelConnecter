import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { db, writeTx } from './db.js';

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Bootstrap pets + agent_instances + sessions from relay.json (N1 config registration).
 */
export async function syncConfigPets(config) {
  const pets = config.pets || [];
  return writeTx((database) => {
    const out = [];
    for (const pet of pets) {
      if (!pet?.id || !pet?.token) {
        throw new Error('pets[] requires id and token');
      }
      database
        .prepare(
          `INSERT INTO pets (id, owner_user_id, name, status, last_seen_at)
           VALUES (?, ?, ?, 'online', datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             status = 'online',
             last_seen_at = datetime('now')`
        )
        .run(pet.id, pet.ownerUserId || null, pet.name || pet.id);

      const groups = pet.groups || [];
      for (const g of groups) {
        const env = g.env || config.defaults?.env || 'canary';
        const groupId = g.groupId || g.group || g.id;
        const groupName = g.groupName || g.name || groupId;
        const agentName =
          g.agentName || config.defaults?.coordinatorAgentName || 'Cursor Agent';
        if (!groupId) throw new Error(`pet ${pet.id} group missing groupId`);

        const instanceId = `${pet.id}:${env}:${groupId}:${agentName}`;
        database
          .prepare(
            `INSERT INTO agent_instances
              (id, pet_id, agent_type, env, group_id, group_name, agent_name, status)
             VALUES (?, ?, 'pet', ?, ?, ?, ?, 'active')
             ON CONFLICT(pet_id, env, group_id, agent_name) DO UPDATE SET
               group_name = excluded.group_name,
               status = 'active'`
          )
          .run(instanceId, pet.id, env, groupId, groupName, agentName);

        const row = database
          .prepare(
            `SELECT id FROM agent_instances
             WHERE pet_id = ? AND env = ? AND group_id = ? AND agent_name = ?`
          )
          .get(pet.id, env, groupId, agentName);

        out.push(row);
      }

      // One pet-level session for config token (covers all instances)
      const tokenHash = hashToken(pet.token);
      const existing = database
        .prepare(`SELECT id, status FROM sessions WHERE token_hash = ?`)
        .get(tokenHash);
      if (!existing) {
        database
          .prepare(
            `INSERT INTO sessions (id, pet_id, agent_instance_id, token_hash, status)
             VALUES (?, ?, NULL, ?, 'active')`
          )
          .run(`sess_${randomUUID()}`, pet.id, tokenHash);
      } else if (existing.status === 'revoked') {
        // keep revoked until explicit new token / re-bootstrap with new token
      } else {
        database
          .prepare(
            `UPDATE sessions SET status = 'active' WHERE token_hash = ? AND status != 'revoked'`
          )
          .run(tokenHash);
      }
    }
    return out;
  });
}

export function findSessionByToken(token) {
  const tokenHash = hashToken(token);
  return db()
    .prepare(
      `SELECT s.*, p.name AS pet_name
       FROM sessions s
       JOIN pets p ON p.id = s.pet_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash);
}

export function touchPet(petId) {
  db()
    .prepare(
      `UPDATE pets SET last_seen_at = datetime('now'), status = 'online' WHERE id = ?`
    )
    .run(petId);
}

export function revokePetSessions(petId) {
  return writeTx((database) => {
    database
      .prepare(`UPDATE sessions SET status = 'revoked' WHERE pet_id = ?`)
      .run(petId);
    return { ok: true, petId };
  });
}

export function listAgentInstancesForPet(petId) {
  return db()
    .prepare(
      `SELECT * FROM agent_instances WHERE pet_id = ? AND status = 'active' ORDER BY env, group_id`
    )
    .all(petId);
}

export function resolveAgentInstance(petId, { env, group, agent }) {
  const instances = listAgentInstancesForPet(petId);
  if (!instances.length) return null;

  let candidates = instances;
  if (env) candidates = candidates.filter((i) => i.env === env);
  if (group) {
    candidates = candidates.filter(
      (i) => i.group_id === group || i.group_name === group
    );
  }
  if (agent) candidates = candidates.filter((i) => i.agent_name === agent);

  if (candidates.length === 1) return candidates[0];
  if (!env && !group && !agent && candidates.length >= 1) {
    return candidates[0];
  }
  return candidates[0] || null;
}

/** Simple sliding-window rate limit: max N per minute per pet. */
const buckets = new Map();

export function checkRateLimit(petId, limitPerMin = 60, bucket = 'chat') {
  const now = Date.now();
  const windowMs = 60_000;
  const key = `${petId}:${bucket}`;
  let arr = buckets.get(key) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= limitPerMin) {
    buckets.set(key, arr);
    return { ok: false, error: 'rate limit exceeded' };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true };
}
