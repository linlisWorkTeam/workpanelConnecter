/* WorkPet 猫猫球 UI 逻辑（Tauri 2 webview / 纯浏览器 dev 双模式） */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ball = $('ball');
  const panel = $('panel');
  const msgList = $('msgList');
  const input = $('input');
  const sendBtn = $('sendBtn');
  const titleEl = $('panelTitle');

  const BALL_SIZE = { w: 120, h: 120 };
  const PANEL_SIZE = { w: 360, h: 520 };

  let client = null;
  let cfg = {};
  let cursor = 0; // 轮询游标（N2）
  let pollTimer = null;
  let panelOpen = false;
  let sending = false;
  let runPolls = {};

  const tauriWindow = () =>
    window.__TAURI__ && window.__TAURI__.window
      ? window.__TAURI__.window.getCurrentWindow()
      : null;

  function setBallState(state) {
    ball.classList.remove('idle', 'thinking', 'error');
    ball.classList.add(state);
  }

  function addMsg(text, kind, meta) {
    const el = document.createElement('div');
    el.className = 'msg ' + (kind || 'theirs');
    el.textContent = text;
    if (meta) {
      const m = document.createElement('span');
      m.className = 'meta';
      m.textContent = meta;
      el.appendChild(m);
    }
    msgList.appendChild(el);
    msgList.scrollTop = msgList.scrollHeight;
    return el;
  }

  async function loadConfig() {
    // 1) Tauri 命令（读 ~/.workpet/config.json）
    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        const raw = await window.__TAURI__.core.invoke('get_config');
        if (raw) return JSON.parse(raw);
      } catch (e) {
        addMsg('未找到配置：请复制 config.example.json 到 ~/.workpet/config.json', 'err');
      }
    }
    // 2) dev 模式：同目录 config.json（vite/静态服务器）
    try {
      const res = await fetch('config.json');
      if (res.ok) return await res.json();
    } catch (e) { /* ignore */ }
    // 3) 注入兜底
    if (window.__WORKPET_CONFIG__) return window.__WORKPET_CONFIG__;
    throw new Error('no config');
  }

  function applyConfig(c) {
    cfg = c;
    client = window.ConnecterClient.createConnecterClient(c);
    titleEl.textContent = 'WorkPet · ' + (c.group || c.env || '');
    cursor = 0;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sending || !client) return;
    sending = true;
    sendBtn.disabled = true;
    setBallState('thinking');
    addMsg(text, 'mine', '发送中…');

    const id = 'msg_pet_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    try {
      const res = await client.chat(text, { id });
      addMsg(
        '已受理 ✓',
        'sys',
        'messageId ' + (res.messageId || '') + (res.runIds && res.runIds.length ? ' · runId ' + res.runIds[0] : '')
      );
      cursor = 0; // 重拉回显
      (res.runIds || []).forEach(pollRun);
      setBallState('idle');
    } catch (e) {
      addMsg('发送失败：' + e.message, 'err');
      setBallState('error');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.value = '';
    }
  }

  async function pollRun(runId) {
    if (!client || runPolls[runId]) return;
    runPolls[runId] = 1;
    let n = 0;
    const max = cfg.maxRunPolls || 30;
    while (n < max) {
      await new Promise((r) => setTimeout(r, cfg.pollIntervalMs || 2000));
      n++;
      try {
        const row = await client.runs(runId);
        if (row && row.status && !['queued', 'running', 'starting'].includes(row.status)) {
          addMsg('run ' + runId.slice(0, 8) + ' → ' + row.status, 'sys');
          break;
        }
      } catch (e) { /* transient */ }
    }
    delete runPolls[runId];
  }

  async function pollMessages() {
    if (!client || !panelOpen) return;
    try {
      const res = await client.messages(cursor);
      const items = res.messages || [];
      for (const m of items) {
        if (m.id && m.id.startsWith('msg_pet_')) continue; // 自己的上行不回显
        const content = m.payload && m.payload.content ? m.payload.content : JSON.stringify(m.payload || {});
        addMsg(content, 'theirs', 'seq ' + m.seq + ' · ' + (m.direction || ''));
      }
      cursor = res.nextCursor || cursor;
    } catch (e) { /* transient，下轮再试 */ }
  }

  async function expand() {
    panelOpen = true;
    panel.classList.remove('hidden');
    const w = tauriWindow();
    if (w) {
      await w.setSize({ width: PANEL_SIZE.w, height: PANEL_SIZE.h });
      await w.setFocus();
    }
    cursor = 0;
    pollTimer = setInterval(pollMessages, cfg.pollIntervalMs || 2000);
    input.focus();
  }

  async function collapse() {
    panelOpen = false;
    panel.classList.add('hidden');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const w = tauriWindow();
    if (w) await w.setSize({ width: BALL_SIZE.w, height: BALL_SIZE.h });
  }

  async function init() {
    try {
      applyConfig(await loadConfig());
      setBallState('idle');
      addMsg('已连接 ' + cfg.connecterBaseUrl, 'sys');
      const h = await client.health();
      addMsg('中继健康 ✓（' + (h.service || 'connecter-relay') + '）', 'sys');
    } catch (e) {
      setBallState('error');
      addMsg('初始化失败：' + e.message, 'err');
    }

    ball.addEventListener('click', expand);
    $('collapseBtn').addEventListener('click', collapse);
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
