import './connecterApi.js';
import { Live2DPet } from './live2dPet.js';
import {
  PET_SIZE_STEPS,
  nextPetScale,
  normalizePetScale,
  normalizePetState,
  petWindowSize,
} from './petConfig.js';
import {
  isStaleGroupFetch,
  renderMessageAuthor,
  shouldStartConsolePolling,
} from './petStamp.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const panel = $('panel');
const msgList = $('msgList');
const input = $('input');
const sendBtn = $('sendBtn');
const groupSelect = $('groupSelect');
const memberStrip = $('memberStrip');
const agentMentions = $('agentMentions');
const connectionBadge = $('connectionBadge');
const speechBubble = $('speechBubble');
const loadingHint = $('loadingHint');

const PANEL_SIZE = { width: 440, height: 680 };
const PET_SCALE_STORAGE_KEY = 'workpet.petScale';
const GROUP_ID_STORAGE_KEY = 'workpet.groupId';
const MEMBER_POLL_MS = 10000;

let client = null;
let cfg = {};
let msgPollTimer = null;
let memberPollTimer = null;
let bubbleTimer = null;
let panelOpen = false;
let sending = false;
let petScale = 1;
let currentGroupId = '';
let consolePaused = false;
let agentMembers = [];
const renderedMessageIds = new Set();
const pendingOptimistic = new Map();
const runPolls = {};

const pet = new Live2DPet({
  canvas: $('live2dCanvas'),
  container: $('petStage'),
  onReady: () => {
    app.classList.add('live2d-ready');
    app.classList.remove('fallback-active');
    loadingHint.classList.add('is-hidden');
  },
  onFallback: (error) => {
    app.classList.add('fallback-active');
    app.classList.remove('live2d-ready');
    loadingHint.textContent = `Live2D 降级：${error.message}`;
    loadingHint.title = error.message;
  },
});

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

function readSavedGroupId() {
  try {
    return localStorage.getItem(GROUP_ID_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

function persistGroupId(id) {
  try {
    if (id) localStorage.setItem(GROUP_ID_STORAGE_KEY, id);
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
  pet.setState(next);
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
  const content = msg.contentDisplay != null ? String(msg.contentDisplay) : '';
  for (const [id, pending] of pendingOptimistic) {
    if (pending.text !== content) continue;
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
  agentMentions.innerHTML = '';
  for (const member of agentMembers) {
    const option = document.createElement('option');
    option.value = `@${member.displayName}`;
    agentMentions.appendChild(option);
  }
}

function renderMembers(members) {
  memberStrip.innerHTML = '';
  agentMembers = (members || []).filter((m) => m && m.kind === 'agent' && m.displayName);
  refreshAgentDatalist();

  for (const member of members || []) {
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

function applyConfig(value) {
  cfg = value || {};
  $('petName').textContent = cfg.petName || 'WorkPet';
  const createClient = window.ConnecterClient?.createConnecterClient;
  if (cfg.connecterBaseUrl && cfg.token && createClient) {
    try {
      client = createClient(cfg);
    } catch (error) {
      addMsg(`中继客户端初始化失败：${error.message}`, 'err');
    }
  } else if (cfg.connecterBaseUrl && cfg.token) {
    addMsg('Connecter SDK 未加载，聊天暂不可用。', 'err');
  }
}

async function checkConnection() {
  if (!client) {
    connectionBadge.textContent = '仅桌宠模式';
    return;
  }
  try {
    const health = await client.health();
    connectionBadge.textContent = '在线';
    connectionBadge.classList.add('online');
    addMsg(`已连接 ${health.service || 'connecter-relay'}`, 'sys');
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
}

async function loadGroups() {
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
  if (!client) {
    addMsg('请先配置 connecterBaseUrl 和 token。', 'err');
    showBubble('我已经醒了，但还没有连接到 WorkPanel。');
    return;
  }
  if (!currentGroupId) {
    addMsg('请先选择群聊。', 'err');
    return;
  }

  sending = true;
  sendBtn.disabled = true;
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
    (response.runIds || []).forEach(pollRun);
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

async function pollRun(runId) {
  if (!client || runPolls[runId]) return;
  runPolls[runId] = true;
  const max = cfg.maxRunPolls || 30;
  for (let count = 0; count < max; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs || 2000));
    try {
      const row = await client.runs(runId);
      if (row?.status && !['queued', 'running', 'starting'].includes(row.status)) {
        addMsg(`run ${runId.slice(0, 8)} → ${row.status}`, 'sys');
        break;
      }
    } catch (_) { /* 短暂失败留给下一轮 */ }
  }
  delete runPolls[runId];
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
  await loadGroups();
  if (!shouldStartConsolePolling({ panelOpen, consolePaused })) return;
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

async function interact() {
  pet.interact();
  showBubble(client ? '我在。要一起处理什么？' : 'Live2D 已就绪，连接 WorkPanel 后就能聊天。');
}

async function init() {
  const config = await loadConfig();
  petScale = readSavedPetScale(config);
  await setPetScale(petScale, false);
  await pet.init(config.live2d);
  setPetState('idle');
  applyConfig(config);
  await checkConnection();

  $('petHit').addEventListener('click', interact);
  $('openChatBtn').addEventListener('click', expand);
  $('chatToggle').addEventListener('click', expand);
  $('collapseBtn').addEventListener('click', collapse);
  $('sizeDownBtn').addEventListener('click', () => resizePet(-1));
  $('sizeUpBtn').addEventListener('click', () => resizePet(1));
  groupSelect.addEventListener('change', () => {
    if (groupSelect.value) selectGroup(groupSelect.value);
  });
  input.addEventListener('keyup', (event) => {
    if (event.key === '@' || input.value.includes('@')) refreshAgentDatalist();
  });
  $('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    send();
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
