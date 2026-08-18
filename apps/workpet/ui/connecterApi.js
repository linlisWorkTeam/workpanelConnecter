/* WorkPet → Connecter 客户端 SDK
 * 纯 JS、无依赖、浏览器/Tauri/Node 三端通用（UMD）。
 * 契约见 docs/workconnector-system-design.md §3 与 src/relay/handlers.js。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.ConnecterClient = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createConnecterClient(cfg) {
    const base = String(cfg.connecterBaseUrl || cfg.baseUrl || '').replace(/\/+$/, '');
    const token = cfg.token || '';
    const defaults = {
      env: cfg.env || 'canary',
      group: cfg.group || '',
      agent: cfg.agent || '',
      petName: cfg.petName || '',
    };
    if (!base) throw new Error('connecterBaseUrl required');
    if (!token) throw new Error('token required');

    async function request(path, opts = {}) {
      const headers = Object.assign(
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        opts.headers || {}
      );
      let res;
      try {
        res = await fetch(base + path, Object.assign({}, opts, { headers }));
      } catch (e) {
        const err = new Error('network: ' + e.message);
        err.kind = 'network';
        throw err;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(body.error || 'HTTP ' + res.status);
        err.status = res.status;
        err.body = body;
        err.kind = 'http';
        throw err;
      }
      return body;
    }

    function buildChatBody(prompt, o = {}) {
      return {
        id: o.id,
        prompt,
        env: o.env || defaults.env,
        group: o.group || defaults.group,
        agent: o.agent || defaults.agent,
        petName: o.petName || defaults.petName,
      };
    }

    return {
      buildChatBody,
      /** GET /v1/health */
      health: () => request('/v1/health'),
      /** GET /v1/envs */
      envs: () => request('/v1/envs'),
      /** GET /v1/instances (pet token) */
      instances: () => request('/v1/instances'),
      /** GET /v1/groups */
      groups: (o = {}) => {
        const q = new URLSearchParams({ env: o.env || defaults.env });
        return request('/v1/groups?' + q.toString());
      },
      /** GET /v1/groups/{id} */
      group: (id, o = {}) => {
        const q = new URLSearchParams({ env: o.env || defaults.env });
        return request('/v1/groups/' + encodeURIComponent(id) + '?' + q.toString());
      },
      /** GET /v1/groups/{id}/messages */
      groupMessages: (id, o = {}) => {
        const q = new URLSearchParams({
          env: o.env || defaults.env,
          limit: String(o.limit || 50),
        });
        return request('/v1/groups/' + encodeURIComponent(id) + '/messages?' + q.toString());
      },
      /**
       * POST /v1/chat
       * @param {string} prompt
       * @param {{id?:string, group?:string, agent?:string, env?:string, petName?:string}} [o]
       */
      chat: (prompt, o = {}) =>
        request('/v1/chat', {
          method: 'POST',
          body: JSON.stringify(buildChatBody(prompt, o)),
        }),
      /**
       * GET /v1/messages?since=… （轮询回显，N2）
       * @param {number} since
       */
      messages: (since = 0, o = {}) => {
        const q = new URLSearchParams({
          since: String(since),
          env: o.env || defaults.env,
          group: o.group || defaults.group,
          agent: o.agent || defaults.agent,
        });
        return request('/v1/messages?' + q.toString());
      },
      /** GET /v1/runs/{id} */
      runs: (id) => request('/v1/runs/' + encodeURIComponent(id)),
      /** POST /v1/session/revoke */
      revoke: () => request('/v1/session/revoke', { method: 'POST' }),
    };
  }

  return { createConnecterClient };
});
