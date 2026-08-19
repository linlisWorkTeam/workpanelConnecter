import './connecterApi.js';
import { Live2DPet } from './live2dPet.js';
import {
  PET_SIZE_STEPS,
  LOCAL_CONNECTER_BASE_URL,
  nextPetScale,
  normalizePetAppearance,
  normalizePetScale,
  normalizePetState,
  petWindowSize,
  resolveConnecterBaseUrl,
} from './petConfig.js';
import {
  isStaleGroupFetch,
  isXiaoaiDoneStatus,
  matchesOptimisticBubble,
  renderMessageAuthor,
  shouldAnnounceRun,
  shouldStartConsolePolling,
  formatXiaoaiAnnounce,
  envOptionLabel,
  petSelectableEnvs,
  connectionBadgeText,
  connectionSysLine,
  groupVisibleMembers,
} from './petStamp.js';
import { postXiaoaiAnnounce, readXiaoaiEnabled } from './xiaoaiAnnounce.js';
import { SpritePet } from './spritePet.js';
import { buildAppearanceMenu } from './petAppearanceMenu.js';
import { SPRITE_CUSTOMIZE_PROMPT } from './spriteCustomizePrompt.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const panel = $('panel');
const msgList = $('msgList');
const input = $('input');
const sendBtn = $('sendBtn');
const groupSelect = $('groupSelect');
const envSelect = $('envSelect');
const memberStrip = $('memberStrip');
const agentMentions = $('agentMentions');
const connectionBadge = $('connectionBadge');
const speechBubble = $('speechBubble');
const loadingHint = $('loadingHint');

const PANEL_SIZE = { width: 440, height: 680 };
const PET_SCALE_STORAGE_KEY = 'workpet.petScale';
const GROUP_ID_STORAGE_KEY = 'workpet.groupId';
const XIAOAI_STORAGE_KEY = 'workpet.xiaoaiAnnounce';
const MEMBER_POLL_MS = 10000;

let client = null;
let cfg = {};
let msgPollTimer = null;
let memberPollTimer = null;
let bubbleTimer = null;
let panelOpen = false;
let sending = false;
let membersCache = [];
let loggedIn = false;

function hideMentions() {
  const menu = $('mentionMenu');
  if (!menu) return;
  menu.classList.add('is-hidden');
  menu.hidden = true;
  menu.innerHTML = '';
}

function showMentions(q) {
  const menu = $('mentionMenu');
  if (!menu) return;
  const agents = membersCache.filter((m) => m.kind === 'agent' && m.isActive !== false);
  const needle = String(q || '').toLowerCase();
  const hits = agents.filter((m) => String(m.displayName || '').toLowerCase().includes(needle));
  if (!hits.length) {
    hideMentions();
    return;
  }
  menu.innerHTML = hits
    .slice(0, 8)
    .map(
      (m, i) =>
        `<li data-name="${String(m.displayName).replace(/"/g, '&quot;')}" class="${i === 0 ? 'active' : ''}">${m.displayName}<span class="kind">agent</span></li>`
    )
    .join('');
  menu.classList.remove('is-hidden');
  menu.hidden = false;
}

function applyMention(name) {
  const cur = input.value;
  const at = cur.lastIndexOf('@');
  input.value = `${cur.slice(0, at + 1)}${name} `;
  hideMentions();
  input.focus();
}

async function loadMembers() {
  if (!loggedIn || !client) return;
  try {
    const row = await client.members({ group: currentGroupId || cfg.group });
    membersCache = row.members || [];
  } catch (_) {
    if (!membersCache.length) membersCache = agentMembers;
  }
}
let petScale = 1;
let currentGroupId = '';
let consolePaused = false;
let agentMembers = [];
const renderedMessageIds = new Set();
const pendingOptimistic = new Map();
const runPolls = {};
const runAnnounced = new Set();

const pet = new Live2DPet({
  canvas: $('live2dCanvas'),
  container: $('petStage'),
  onReady: () => {
    app.classList.add('live2d-ready');
    app.classList.remove('fallback-active', 'sprite-mode');
    loadingHint.classList.add('is-hidden');
  },
  onFallback: (error) => {
    app.classList.add('fallback-active');
    app.classList.remove('live2d-ready', 'sprite-mode');
    loadingHint.textContent = `Live2D 降级：${error.message}`;
    loadingHint.title = error.message;
  },
});
const spritePet = new SpritePet({ img: $('petSprite') });
let appearance = normalizePetAppearance();
let live2dCatalog = [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }];
let spriteCatalog = [{ id: 'default', label: '默认剪影', frames: {} }];

function tauriWindow() {
  return window.__TAURI__?.window?.getCurrentWindow?.() || null;
}

function logicalSize(size) {
  const LogicalSize = window.__TAURI__?.dpi?.LogicalSize;
  return LogicalSize ? new LogicalSize(size.width, size.height) : size;
}

function readSavedPetScale(config) {
  try {
    const saved = localStorage.getItem(PET_SCALE_STORAGE_KEY);
    if (saved !== null) return normalizePetScale(saved);
  } catch (_) { /* 无本地存储时读取配置 */ }
  return normalizePetScale(config?.ui?.petScale);
}

function groupStorageKey() {
  return `${GROUP_ID_STORAGE_KEY}.${cfg.env || 'canary'}`;
}

function readSavedGroupId() {
  try {
    return localStorage.getItem(groupStorageKey()) || localStorage.getItem(GROUP_ID_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

function persistGroupId(id) {
  try {
    if (id) localStorage.setItem(groupStorageKey(), id);
  } catch (_) { /* 仅本次有效 */ }
}

function updateSizeButtons() {
  $('sizeDownBtn').disabled = petScale <= PET_SIZE_STEPS[0];
  $('sizeUpBtn').disabled = petScale >= PET_SIZE_STEPS.at(-1);
}

async function setPetScale(next, announce = true) {
  petScale = normalizePetScale(next);
  try { localStorage.setItem(PET_SCALE_STORAGE_KEY, String(petScale)); } catch (_) { /* 仅本次有效 */ }
  updateSizeButtons();
  if (!panelOpen) {
    const win = tauriWindow();
    if (win) await win.setSize(logicalSize(petWindowSize(petScale)));
  }
  if (announce) showBubble(`桌宠大小：${Math.round(petScale * 100)}%`, 1800);
}

function resizePet(direction) {
  setPetScale(nextPetScale(petScale, direction));
}

function setPetState(state) {
  const next = normalizePetState(state);
  app.dataset.state = next;
  if (appearance.mode === 'sprite') spritePet.setState(next);
  else pet.setState(next);
}

function showBubble(text, duration = 3600) {
  if (!text) return;
  speechBubble.textContent = text.length > 72 ? `${text.slice(0, 72)}…` : text;
  speechBubble.classList.remove('is-hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => speechBubble.classList.add('is-hidden'), duration);
}

function addMsg(text, kind = 'theirs', meta = '') {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.textContent = text;
  if (meta) {
    const detail = document.createElement('span');
    detail.className = 'meta';
    detail.textContent = meta;
    el.appendChild(detail);
  }
  msgList.appendChild(el);
  msgList.scrollTop = msgList.scrollHeight;
  return el;
}

function clearConsoleTimers() {
  clearInterval(msgPollTimer);
  clearInterval(memberPollTimer);
  msgPollTimer = null;
  memberPollTimer = null;
}

function pauseConsolePolling(hint) {
  consolePaused = true;
  clearConsoleTimers();
  addMsg(hint || '请求过于频繁（429），已暂停本桌宠群控制台轮询', 'sys');
  showBubble('轮询已暂停（429）');
}

function isHttpCode(error, status, code) {
  return error?.kind === 'http' && error.status === status && error.body?.code === code;
}

function extractMentionName(text) {
  const match = String(text || '').match(/@([^\s@]+)/);
  return match ? match[1] : '某某';
}

function addGroupMsg(msg) {
  const author = renderMessageAuthor(msg, cfg.petName);
  const text = msg.contentDisplay != null ? String(msg.contentDisplay) : String(msg.content || '');
  const kind = msg.petDisplayName && msg.petDisplayName === cfg.petName ? 'mine' : 'theirs';
  return addMsg(text, kind, author);
}

function removeMatchingOptimistic(msg) {
  for (const [id, pending] of pendingOptimistic) {
    if (!matchesOptimisticBubble(pending.text, msg)) continue;
    if (msg.petDisplayName && msg.petDisplayName !== cfg.petName) continue;
    pending.el.remove();
    pendingOptimistic.delete(id);
    return true;
  }
  return false;
}

function ingestGroupMessage(msg, { speak = false } = {}) {
  if (!msg?.id) return;
  if (renderedMessageIds.has(msg.id)) return;
  removeMatchingOptimistic(msg);
  renderedMessageIds.add(msg.id);
  addGroupMsg(msg);
  if (speak && msg.contentDisplay) {
    showBubble(msg.contentDisplay);
    setPetState('speaking');
    setTimeout(() => setPetState('idle'), 1800);
  }
}

function refreshAgentDatalist() {
  if (!agentMentions) return;
  agentMentions.innerHTML = '';
  for (const member of agentMembers) {
    const option = document.createElement('option');
    option.value = `@${member.displayName}`;
    agentMentions.appendChild(option);
  }
}

function renderMembers(members) {
  memberStrip.innerHTML = '';
  const visible = groupVisibleMembers(members);
  agentMembers = visible.filter((m) => m && m.kind === 'agent' && m.displayName);
  if (members?.length) membersCache = members;
  refreshAgentDatalist();

  for (const member of visible) {
    if (!member?.displayName) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'member-chip';
    chip.dataset.kind = member.kind || '';
    chip.dataset.id = member.id || '';

    const dot = document.createElement('span');
    dot.className = `online-dot ${member.online ? 'is-online' : 'is-offline'}`;
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = member.displayName;

    chip.appendChild(dot);
    chip.appendChild(label);

    if (member.kind === 'agent') {
      chip.title = `插入 @${member.displayName}`;
      chip.addEventListener('click', () => {
        const insert = `@${member.displayName} `;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = `${input.value.slice(0, start)}${insert}${input.value.slice(end)}`;
        const caret = start + insert.length;
        input.focus();
        input.setSelectionRange(caret, caret);
        refreshAgentDatalist();
      });
    } else {
      chip.disabled = true;
      chip.title = member.kind || 'member';
    }

    memberStrip.appendChild(chip);
  }
}

function setMemberStripError(text) {
  memberStrip.innerHTML = '';
  const el = document.createElement('span');
  el.className = 'member-strip-error';
  el.textContent = text;
  memberStrip.appendChild(el);
}

function setEnvSelectError(text) {
  if (!envSelect) return;
  envSelect.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = text;
  option.disabled = true;
  option.selected = true;
  envSelect.appendChild(option);
}

function setGroupSelectError(text) {
  groupSelect.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = text;
  option.disabled = true;
  option.selected = true;
  groupSelect.appendChild(option);
}

async function loadConfig() {
  if (window.__TAURI__?.core) {
    try {
      const raw = await window.__TAURI__.core.invoke('get_config');
      if (raw) return JSON.parse(raw);
    } catch (_) {
      addMsg('未找到 ~/.workpet/config.json，聊天功能暂不可用。', 'err');
    }
  }
  try {
    const response = await fetch('config.json');
    if (response.ok) return await response.json();
  } catch (_) { /* 静态开发模式可没有配置 */ }
  if (window.__WORKPET_CONFIG__) return window.__WORKPET_CONFIG__;
  return {};
}

async function probeConnecterHealth(base, timeoutMs = 1500) {
  const url = String(base || '').replace(/\/+$/, '') + '/v1/health';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok !== false && body.service === 'connecter-relay';
  } catch {
    return false;
  }
}

async function bindThisEnvironmentConnecter(config) {
  const next = { ...(config || {}) };
  const localReachable = await probeConnecterHealth(LOCAL_CONNECTER_BASE_URL);
  const url = resolveConnecterBaseUrl(next, { localReachable });
  next.connecterBaseUrl = url;
  if (url !== String(config?.connecterBaseUrl || '').replace(/\/+$/, '') && window.__TAURI__?.core) {
    try {
      await window.__TAURI__.core.invoke('set_config', {
        patch: JSON.stringify({ connecterBaseUrl: url }),
      });
    } catch (_) { /* ignore */ }
  }
  return next;
}

function applyConfig(value) {
  cfg = value || {};
  $('petName').textContent = cfg.petName || 'WorkPet';
  const createClient = window.ConnecterClient?.createConnecterClient;
  if (loggedIn && cfg.connecterBaseUrl && cfg.token && createClient) {
    try {
      client = createClient(cfg);
    } catch (error) {
      addMsg(`中继客户端初始化失败：${error.message}`, 'err');
    }
  } else if (loggedIn && cfg.connecterBaseUrl && cfg.token) {
    addMsg('Connecter SDK 未加载，聊天暂不可用。', 'err');
  } else {
    client = null;
  }
  cfg.xiaoaiAnnounce = readXiaoaiEnabled(cfg, (key) => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  });
  syncXiaoaiToggleUi(cfg.xiaoaiAnnounce);
}

function syncXiaoaiToggleUi(on) {
  const pressed = on ? 'true' : 'false';
  for (const id of ['xiaoaiToggle', 'xiaoaiTogglePanel']) {
    const btn = $(id);
    if (!btn) continue;
    btn.setAttribute('aria-pressed', pressed);
    btn.classList.toggle('is-on', on);
  }
}

async function setXiaoaiEnabled(on) {
  cfg.xiaoaiAnnounce = Boolean(on);
  syncXiaoaiToggleUi(cfg.xiaoaiAnnounce);
  try {
    localStorage.setItem(XIAOAI_STORAGE_KEY, cfg.xiaoaiAnnounce ? '1' : '0');
  } catch (_) { /* ignore */ }
  if (window.__TAURI__?.core) {
    try {
      await window.__TAURI__.core.invoke('set_config', {
        patch: JSON.stringify({ xiaoaiAnnounce: cfg.xiaoaiAnnounce }),
      });
    } catch (error) {
      addMsg(`配置写入失败：${error.message || error}`, 'err');
    }
  }
  if (cfg.xiaoaiAnnounce) {
    const base = String(cfg.homepageBaseUrl || '').trim();
    const token = String(cfg.homepagePetToken || '').trim();
    if (!base || !token) {
      addMsg('请先配置 homepageBaseUrl 和 homepagePetToken。', 'err');
    }
  }
}

async function persistLogin(token, username) {
  cfg.token = token;
  cfg.wpUsername = username;
  applyConfig(cfg);
  if (window.__TAURI__?.core) {
    try {
      await window.__TAURI__.core.invoke('set_config', {
        patch: JSON.stringify({ token, wpUsername: username }),
      });
    } catch (error) {
      addMsg(`配置写入失败：${error.message || error}`, 'err');
    }
  }
}

function syncSpaceLock() {
  panel.classList.toggle('is-locked', !loggedIn);
}

async function submitLogin() {
  const errEl = $('loginErr');
  const username = String($('loginUser')?.value || '').trim();
  const password = String($('loginPass')?.value || '');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }
  if (!cfg.connecterBaseUrl) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = '未配置 Connecter 地址';
    }
    return;
  }
  if (!username || !password) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = '请输入用户名和密码';
    }
    return;
  }
  const login = window.ConnecterClient?.login;
  if (!login) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = 'Connecter SDK 未加载';
    }
    return;
  }
  try {
    const body = await login(cfg.connecterBaseUrl, {
      username,
      password,
      env: cfg.env || 'canary',
    });
    loggedIn = true;
    if ($('loginPass')) $('loginPass').value = '';
    await persistLogin(body.token, body.username || username);
    syncSpaceLock();
    await checkConnection();
    if (panelOpen) {
      await loadEnvs();
      await loadGroups();
      await loadMembers();
      if (shouldStartConsolePolling({ panelOpen, consolePaused, loggedIn })) {
        startConsolePolling();
      }
    }
  } catch (error) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = error.message || '登录失败';
    }
  }
}

async function persistEnv(name) {
  const env = String(name || '').trim();
  if (!env) return;
  cfg.env = env;
  applyConfig(cfg);
  if (window.__TAURI__?.core) {
    try {
      await window.__TAURI__.core.invoke('set_config', {
        patch: JSON.stringify({ env }),
      });
    } catch (error) {
      addMsg(`配置写入失败：${error.message || error}`, 'err');
    }
  }
}

async function loadEnvs() {
  if (!envSelect) return;
  if (!loggedIn) return;
  if (!client) {
    setEnvSelectError('未连接 Connecter');
    return;
  }
  try {
    const response = await client.envs();
    if (!panelOpen) return;
    const envs = petSelectableEnvs(response.envs || []);
    envSelect.innerHTML = '';
    if (!envs.length) {
      setEnvSelectError('暂无服务器');
      return;
    }
    const pick = envs.some((e) => e.name === cfg.env)
      ? cfg.env
      : (envs.find((e) => e.alive !== false) || envs[0]).name;
    for (const row of envs) {
      const option = document.createElement('option');
      option.value = row.name;
      option.textContent = envOptionLabel(row);
      option.disabled = row.alive === false && row.name !== pick;
      envSelect.appendChild(option);
    }
    envSelect.value = pick;
    if (pick !== cfg.env) await persistEnv(pick);
  } catch (error) {
    if (!panelOpen) return;
    setEnvSelectError(`服务器列表失败：${error.message}`);
  }
}

async function selectEnv(name) {
  if (!name) return;
  if (name === cfg.env) return;
  await persistEnv(name);
  currentGroupId = '';
  renderedMessageIds.clear();
  pendingOptimistic.clear();
  msgList.innerHTML = '';
  memberStrip.innerHTML = '';
  agentMembers = [];
  membersCache = [];
  await loadGroups();
  await loadMembers();
}

async function checkConnection() {
  if (!loggedIn) {
    connectionBadge.textContent = connectionBadgeText(null, { loggedIn: false });
    connectionBadge.classList.remove('online', 'linked');
    connectionBadge.title = '登录后才能看群';
    return;
  }
  if (!client) {
    connectionBadge.textContent = '仅桌宠模式';
    return;
  }
  try {
    const health = await client.health();
    connectionBadge.textContent = connectionBadgeText(health, { loggedIn: true });
    connectionBadge.classList.add('online');
    connectionBadge.classList.toggle('linked', health.host?.role === 'connecter' && health.host?.linked === true);
    connectionBadge.title = health.host?.linked
      ? '已会合；成员条只列出当前群的人'
      : '已连本站 Connecter';
    addMsg(connectionSysLine(health, { loggedIn: true }), 'sys');
  } catch (error) {
    connectionBadge.textContent = '连接失败';
    setPetState('error');
    addMsg(`中继连接失败：${error.message}`, 'err');
  }
}

async function loadGroupMembers({ showError = true } = {}) {
  if (!client || !currentGroupId || consolePaused || !panelOpen) return;
  const requestedId = currentGroupId;
  try {
    const response = await client.group(requestedId, {});
    if (isStaleGroupFetch(requestedId, currentGroupId, panelOpen)) return;
    renderMembers(response.members || []);
  } catch (error) {
    if (isStaleGroupFetch(requestedId, currentGroupId, panelOpen)) return;
    if (error?.status === 429) {
      pauseConsolePolling();
      return;
    }
    if (showError) setMemberStripError(`成员加载失败：${error.message}`);
  }
}

async function loadGroupMessages({ speakNew = false, showError = true } = {}) {
  if (!client || !currentGroupId || consolePaused || !panelOpen) return;
  const requestedId = currentGroupId;
  try {
    const response = await client.groupMessages(requestedId, { limit: 50 });
    if (isStaleGroupFetch(requestedId, currentGroupId, panelOpen)) return;
    const knownBefore = renderedMessageIds.size;
    for (const message of response.messages || []) {
      const isNew = !renderedMessageIds.has(message.id);
      ingestGroupMessage(message, { speak: speakNew && isNew && knownBefore > 0 });
    }
  } catch (error) {
    if (isStaleGroupFetch(requestedId, currentGroupId, panelOpen)) return;
    if (error?.status === 429) {
      pauseConsolePolling();
      return;
    }
    if (showError) addMsg(`消息加载失败：${error.message}`, 'err');
  }
}

async function selectGroup(id) {
  if (!id) return;
  if (!panelOpen) return;
  currentGroupId = id;
  persistGroupId(id);
  if (groupSelect.value !== id) groupSelect.value = id;
  renderedMessageIds.clear();
  pendingOptimistic.clear();
  msgList.innerHTML = '';
  memberStrip.innerHTML = '';
  agentMembers = [];
  refreshAgentDatalist();
  await Promise.all([loadGroupMembers(), loadGroupMessages({ speakNew: false })]);
  await loadMembers();
}

async function loadGroups() {
  if (!loggedIn) return;
  if (!client) {
    setGroupSelectError('未连接 Connecter');
    return;
  }
  try {
    const response = await client.groups({});
    if (!panelOpen) return;
    const groups = response.groups || [];
    groupSelect.innerHTML = '';
    if (!groups.length) {
      setGroupSelectError('暂无群聊');
      currentGroupId = '';
      return;
    }
    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.id;
      const unread = group.unreadCount ? ` · ${group.unreadCount}` : '';
      option.textContent = `${group.name || group.id}${unread}`;
      groupSelect.appendChild(option);
    }
    const saved = readSavedGroupId();
    const pick = groups.some((g) => g.id === saved) ? saved : groups[0].id;
    if (!panelOpen) return;
    await selectGroup(pick);
  } catch (error) {
    if (!panelOpen) return;
    if (error?.status === 429) {
      setGroupSelectError('加载群列表失败（429）');
      pauseConsolePolling();
      return;
    }
    setGroupSelectError(`群列表失败：${error.message}`);
  }
}

function startConsolePolling() {
  clearConsoleTimers();
  if (consolePaused || !client) return;
  const msgMs = cfg.pollIntervalMs || 2000;
  msgPollTimer = setInterval(() => {
    loadGroupMessages({ speakNew: true, showError: false });
  }, msgMs);
  memberPollTimer = setInterval(() => {
    loadGroupMembers({ showError: false });
  }, MEMBER_POLL_MS);
}

async function send() {
  const text = input.value.trim();
  if (!text || sending) return;
  if (!loggedIn || !client) {
    addMsg('请先登录。', 'err');
    showBubble('登录后才能看群、说话。');
    return;
  }
  if (!currentGroupId) {
    addMsg('请先选择群聊。', 'err');
    return;
  }

  sending = true;
  sendBtn.disabled = true;
  hideMentions();
  setPetState('thinking');
  input.value = '';

  const id = `msg_pet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const optimistic = addMsg(text, 'mine', cfg.petName || 'WorkPet');
  pendingOptimistic.set(id, { text, el: optimistic });

  try {
    const response = await client.chat(text, {
      group: currentGroupId,
      petName: cfg.petName,
      id,
    });
    addMsg('已受理', 'sys', [response.messageId, ...(response.runIds || [])].filter(Boolean).join(' · '));
    const agent = response.mentionedAgent || response.coordinatorAgent || '';
    (response.runIds || []).forEach((runId) => pollRun(runId, { agent }));
    setPetState('idle');
  } catch (error) {
    const pending = pendingOptimistic.get(id);
    if (pending) {
      pending.el.remove();
      pendingOptimistic.delete(id);
    }
    if (isHttpCode(error, 400, 'UNKNOWN_MENTION')) {
      const name = extractMentionName(text);
      const hint = `找不到 @${name}`;
      addMsg(hint, 'err');
      showBubble(hint);
      setPetState('idle');
    } else if (error?.status === 429) {
      addMsg(`发送失败：${error.message}`, 'err');
      pauseConsolePolling();
      setPetState('error');
    } else {
      addMsg(`发送失败：${error.message}`, 'err');
      showBubble('消息没有送达，再试一次吧。');
      setPetState('error');
    }
  } finally {
    sending = false;
    sendBtn.disabled = false;
  }
}

async function pollRun(runId, meta = {}) {
  if (!client || runPolls[runId]) return;
  runPolls[runId] = true;
  const max = cfg.maxRunPolls || 30;
  let prev = '';
  for (let count = 0; count < max; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs || 2000));
    try {
      const row = await client.runs(runId);
      const status = row?.status || '';
      if (status && status !== prev && !['queued', 'running', 'starting'].includes(status)) {
        addMsg(`run ${runId.slice(0, 8)} → ${status}`, 'sys');
      }
      if (shouldAnnounceRun(prev, status) && !runAnnounced.has(runId)) {
        runAnnounced.add(runId);
        await announceRunIfEnabled({ status, agent: meta.agent || row?.agentName || '' });
      }
      prev = status;
      if (isXiaoaiDoneStatus(status) || (status && !['queued', 'running', 'starting', 'accepted'].includes(status))) {
        break;
      }
    } catch (_) { /* 短暂失败留给下一轮 */ }
  }
  delete runPolls[runId];
}

async function announceRunIfEnabled({ status, agent }) {
  const enabled = readXiaoaiEnabled(cfg, (k) => {
    try { return localStorage.getItem(k); } catch { return null; }
  });
  let lastAgentText = '';
  try {
    if (client && currentGroupId && agent) {
      const listed = await client.groupMessages(currentGroupId, { limit: 20 });
      const rows = listed.messages || listed.body?.messages || [];
      const hit = [...rows].reverse().find(
        (m) => m.senderKind === 'agent' && m.senderDisplayName === agent
      );
      lastAgentText = hit?.contentDisplay || '';
    }
  } catch (_) { /* 无正文则只播前缀 */ }
  const text = formatXiaoaiAnnounce({
    petName: cfg.petName,
    agent,
    status,
    lastAgentText,
  });
  const result = await postXiaoaiAnnounce({
    enabled,
    homepageBaseUrl: cfg.homepageBaseUrl,
    homepagePetToken: cfg.homepagePetToken,
    text,
  });
  if (!result.ok && !result.skipped) {
    addMsg('小爱没播出去', 'err');
    showBubble('小爱没播出去');
  }
}

async function expand() {
  if (panelOpen) return;
  panelOpen = true;
  consolePaused = false;
  app.classList.add('is-expanded');
  panel.classList.remove('is-hidden');
  $('collapseBtn').classList.remove('is-hidden');
  $('chatToggle').classList.add('is-hidden');
  const win = tauriWindow();
  if (win) {
    await win.setSize(logicalSize(PANEL_SIZE));
    await win.setFocus();
  }
  await loadEnvs();
  await loadGroups();
  await loadMembers();
  if (!shouldStartConsolePolling({ panelOpen, consolePaused, loggedIn })) {
    $('loginUser')?.focus();
    return;
  }
  startConsolePolling();
  input.focus();
}

async function collapse() {
  if (!panelOpen) return;
  panelOpen = false;
  app.classList.remove('is-expanded');
  panel.classList.add('is-hidden');
  $('collapseBtn').classList.add('is-hidden');
  $('chatToggle').classList.remove('is-hidden');
  clearConsoleTimers();
  const win = tauriWindow();
  if (win) await win.setSize(logicalSize(petWindowSize(petScale)));
}

function tauriInvoke(cmd, args) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return Promise.reject(new Error('desktop only'));
  return invoke(cmd, args);
}

function assetUrl(absPath) {
  const convert = window.__TAURI__?.core?.convertFileSrc;
  return absPath && convert ? convert(absPath) : absPath;
}

function hidePetMenu() {
  const menu = $('petMenu');
  if (!menu) return;
  menu.classList.add('is-hidden');
  menu.hidden = true;
  menu.innerHTML = '';
}

async function refreshAppearanceCatalogs() {
  try {
    const models = await tauriInvoke('list_live2d_models');
    live2dCatalog = (models || []).map((row) => ({
      id: row.id,
      label: row.label,
      modelUrl: row.abs_path ? assetUrl(row.abs_path) : row.model_url,
    }));
  } catch (_) {
    live2dCatalog = [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }];
  }
  try {
    const skins = await tauriInvoke('list_sprite_skins');
    spriteCatalog = (skins || []).map((row) => ({
      id: row.id,
      label: row.label,
      frames: Object.fromEntries(
        Object.entries(row.frames || {}).map(([state, path]) => [state, assetUrl(path)])
      ),
    }));
  } catch (_) {
    spriteCatalog = [{ id: 'default', label: '默认剪影', frames: {} }];
  }
}

async function persistAppearance(patch) {
  cfg.pet = { ...(cfg.pet || {}), ...patch };
  appearance = normalizePetAppearance(cfg);
  if (window.__TAURI__?.core) {
    try {
      await window.__TAURI__.core.invoke('set_config', {
        patch: JSON.stringify({ pet: cfg.pet, live2d: cfg.live2d }),
      });
    } catch (error) {
      addMsg(`形象配置写入失败：${error.message || error}`, 'err');
    }
  }
}

async function applyAppearance() {
  appearance = normalizePetAppearance(cfg);
  loadingHint.classList.remove('is-hidden');
  if (appearance.mode === 'sprite') {
    pet.destroy();
    app.classList.add('sprite-mode', 'fallback-active');
    app.classList.remove('live2d-ready');
    const skin = spriteCatalog.find((s) => s.id === appearance.spriteSkin) || spriteCatalog[0];
    spritePet.init(skin);
    loadingHint.classList.add('is-hidden');
    setPetState(app.dataset.state || 'idle');
    return;
  }
  app.classList.remove('sprite-mode');
  pet.destroy();
  const model = live2dCatalog.find((m) => m.id === appearance.live2dId) || live2dCatalog[0];
  const live2d = {
    ...appearance.live2d,
    modelUrl: model?.modelUrl || appearance.live2d.modelUrl,
  };
  await pet.init(live2d);
  setPetState(app.dataset.state || 'idle');
}

function renderPetMenu(x, y) {
  const menu = $('petMenu');
  if (!menu) return;
  const rows = buildAppearanceMenu({
    mode: appearance.mode,
    live2dItems: live2dCatalog,
    spriteItems: spriteCatalog,
    currentModelUrl: live2dCatalog.find((m) => m.id === appearance.live2dId)?.modelUrl,
    currentSkin: appearance.spriteSkin,
  });
  menu.innerHTML = '';
  for (const row of rows) {
    if (row.separator) {
      const sep = document.createElement('div');
      sep.className = 'pet-menu-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = row.label;
    btn.dataset.id = row.id;
    if (row.checked) btn.setAttribute('aria-checked', 'true');
    btn.addEventListener('click', () => pickAppearanceMenu(row.id));
    menu.appendChild(btn);
  }
  menu.hidden = false;
  menu.classList.remove('is-hidden');
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - menu.offsetWidth - pad);
  const maxY = Math.max(pad, window.innerHeight - menu.offsetHeight - pad);
  menu.style.left = `${Math.min(Math.max(pad, x), maxX)}px`;
  menu.style.top = `${Math.min(Math.max(pad, y), maxY)}px`;
}

async function pickAppearanceMenu(id) {
  hidePetMenu();
  try {
    if (id === 'mode-live2d') {
      await persistAppearance({ mode: 'live2d' });
      await applyAppearance();
      return;
    }
    if (id === 'mode-sprite') {
      await persistAppearance({ mode: 'sprite' });
      await applyAppearance();
      showBubble('状态动图：idle / speaking 等文件名', 2400);
      return;
    }
    if (id === 'copy-prompt') {
      try {
        await navigator.clipboard.writeText(SPRITE_CUSTOMIZE_PROMPT);
        showBubble('已复制。带上一张参考图，到任意生图平台按说明出 zip', 2800);
      } catch (_) {
        try {
          const path = await tauriInvoke('write_sprite_customize_prompt', {
            text: SPRITE_CUSTOMIZE_PROMPT,
          });
          showBubble(`复制失败，已写入 ${path}`, 3600);
        } catch (error) {
          showBubble(error?.message || String(error) || '复制 prompt 失败', 2400);
        }
      }
      return;
    }
    if (id === 'load-zip') {
      const imported = await tauriInvoke('import_sprite_zip');
      if (!imported) return;
      await refreshAppearanceCatalogs();
      await persistAppearance({ mode: 'sprite', spriteSkin: imported.id });
      await applyAppearance();
      showBubble('已换上新形象', 1800);
      return;
    }
    if (id === 'upload') {
      const cmd = appearance.mode === 'sprite' ? 'import_sprite_skin' : 'import_live2d_model';
      const imported = await tauriInvoke(cmd);
      if (!imported) return;
      await refreshAppearanceCatalogs();
      if (appearance.mode === 'sprite') {
        await persistAppearance({ mode: 'sprite', spriteSkin: imported.id });
      } else {
        await persistAppearance({ mode: 'live2d', live2dId: imported.id });
      }
      await applyAppearance();
      showBubble('已换上新形象', 1800);
      return;
    }
    if (appearance.mode === 'sprite' && spriteCatalog.some((s) => s.id === id)) {
      await persistAppearance({ spriteSkin: id });
      await applyAppearance();
      return;
    }
    if (appearance.mode === 'live2d' && live2dCatalog.some((m) => m.id === id)) {
      const hit = live2dCatalog.find((m) => m.id === id);
      cfg.live2d = { ...(cfg.live2d || {}), modelUrl: hit.modelUrl.startsWith('models/') ? hit.modelUrl : cfg.live2d?.modelUrl };
      await persistAppearance({ live2dId: id });
      await applyAppearance();
    }
  } catch (error) {
    showBubble(error?.message || String(error) || '形象切换失败', 2400);
  }
}

async function interact() {
  if (appearance.mode === 'sprite') {
    spritePet.interact();
    setTimeout(() => {
      if (appearance.mode === 'sprite') setPetState('idle');
    }, 1800);
  } else {
    pet.interact();
  }
  showBubble(client ? '我在。要一起处理什么？' : '桌宠已就绪，登录后就能聊天。');
}

async function init() {
  const config = await bindThisEnvironmentConnecter(await loadConfig());
  petScale = readSavedPetScale(config);
  await setPetScale(petScale, false);
  applyConfig(config);
  appearance = normalizePetAppearance(cfg);
  await refreshAppearanceCatalogs();
  await applyAppearance();
  setPetState('idle');
  syncSpaceLock();
  if (cfg.wpUsername && $('loginUser')) $('loginUser').value = cfg.wpUsername;
  await checkConnection();
  if (loggedIn) await loadMembers();

  $('petHit').addEventListener('click', () => {
    if ($('petMenu') && !$('petMenu').hidden) return;
    interact();
  });
  $('petStage')?.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.chat-fab, .icon-btn, .topbar, .speech-bubble')) return;
    event.preventDefault();
    renderPetMenu(event.clientX, event.clientY);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#petMenu')) hidePetMenu();
  });
  $('openChatBtn').addEventListener('click', expand);
  $('chatToggle').addEventListener('click', expand);
  $('collapseBtn').addEventListener('click', collapse);
  $('sizeDownBtn').addEventListener('click', () => resizePet(-1));
  $('sizeUpBtn').addEventListener('click', () => resizePet(1));
  $('xiaoaiToggle').addEventListener('click', () => setXiaoaiEnabled(!cfg.xiaoaiAnnounce));
  $('xiaoaiTogglePanel').addEventListener('click', () => setXiaoaiEnabled(!cfg.xiaoaiAnnounce));
  $('loginGate')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitLogin();
  });
  groupSelect.addEventListener('change', () => {
    if (groupSelect.value) selectGroup(groupSelect.value);
  });
  envSelect?.addEventListener('change', () => {
    if (envSelect.value) selectEnv(envSelect.value);
  });
  input.addEventListener('keyup', (event) => {
    if (event.key === '@' || input.value.includes('@')) refreshAgentDatalist();
  });
  $('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    hideMentions();
    send();
  });
  input.addEventListener('input', () => {
    const cur = input.value;
    const at = cur.lastIndexOf('@');
    if (at < 0 || /\s/.test(cur.slice(at))) {
      hideMentions();
      return;
    }
    showMentions(cur.slice(at + 1));
  });
  $('mentionMenu')?.addEventListener('mousedown', (event) => {
    const li = event.target.closest('li[data-name]');
    if (!li) return;
    event.preventDefault();
    applyMention(li.dataset.name);
  });
  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || panelOpen) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      resizePet(1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      resizePet(-1);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
