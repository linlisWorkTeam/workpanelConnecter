import './connecterApi.js';
import { Live2DPet } from './live2dPet.js';
import {
  PET_SIZE_STEPS,
  nextPetScale,
  normalizePetScale,
  normalizePetState,
  petWindowSize,
} from './petConfig.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const panel = $('panel');
const msgList = $('msgList');
const input = $('input');
const sendBtn = $('sendBtn');
const titleEl = $('panelTitle');
const connectionBadge = $('connectionBadge');
const speechBubble = $('speechBubble');
const loadingHint = $('loadingHint');

const PANEL_SIZE = { width: 440, height: 680 };
const PET_SCALE_STORAGE_KEY = 'workpet.petScale';

let client = null;
let cfg = {};
let cursor = 0;
let pollTimer = null;
let bubbleTimer = null;
let panelOpen = false;
let sending = false;
let petScale = 1;
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
  titleEl.textContent = cfg.group || cfg.env || '本地桌宠';
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
  cursor = 0;
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

async function send() {
  const text = input.value.trim();
  if (!text || sending) return;
  if (!client) {
    addMsg('请先配置 connecterBaseUrl 和 token。', 'err');
    showBubble('我已经醒了，但还没有连接到 WorkPanel。');
    return;
  }

  sending = true;
  sendBtn.disabled = true;
  setPetState('thinking');
  addMsg(text, 'mine', '发送中…');
  input.value = '';

  const id = `msg_pet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const response = await client.chat(text, { id });
    addMsg('已受理', 'sys', [response.messageId, ...(response.runIds || [])].filter(Boolean).join(' · '));
    cursor = 0;
    (response.runIds || []).forEach(pollRun);
    setPetState('idle');
  } catch (error) {
    addMsg(`发送失败：${error.message}`, 'err');
    showBubble('消息没有送达，再试一次吧。');
    setPetState('error');
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

async function pollMessages() {
  if (!client || !panelOpen) return;
  try {
    const response = await client.messages(cursor);
    for (const message of response.messages || []) {
      if (message.id?.startsWith('msg_pet_')) continue;
      const content = message.payload?.content || JSON.stringify(message.payload || {});
      addMsg(content, 'theirs', `seq ${message.seq} · ${message.direction || ''}`);
      showBubble(content);
      setPetState('speaking');
      setTimeout(() => setPetState('idle'), 1800);
    }
    cursor = response.nextCursor || cursor;
  } catch (_) { /* 下一轮再试，不打断桌宠 */ }
}

async function expand() {
  if (panelOpen) return;
  panelOpen = true;
  app.classList.add('is-expanded');
  panel.classList.remove('is-hidden');
  $('collapseBtn').classList.remove('is-hidden');
  $('chatToggle').classList.add('is-hidden');
  const win = tauriWindow();
  if (win) {
    await win.setSize(logicalSize(PANEL_SIZE));
    await win.setFocus();
  }
  cursor = 0;
  clearInterval(pollTimer);
  pollTimer = setInterval(pollMessages, cfg.pollIntervalMs || 2000);
  input.focus();
}

async function collapse() {
  if (!panelOpen) return;
  panelOpen = false;
  app.classList.remove('is-expanded');
  panel.classList.add('is-hidden');
  $('collapseBtn').classList.add('is-hidden');
  $('chatToggle').classList.remove('is-hidden');
  clearInterval(pollTimer);
  pollTimer = null;
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
