export const PET_STATES = Object.freeze(['idle', 'thinking', 'speaking', 'error']);
export const PET_SIZE_STEPS = Object.freeze([0.75, 0.9, 1, 1.15, 1.3, 1.5]);
export const PET_BASE_SIZE = Object.freeze({ width: 300, height: 420 });

export const DEFAULT_LIVE2D_CONFIG = Object.freeze({
  modelUrl: 'models/hiyori/Hiyori.model3.json',
  scale: 1,
  offsetX: 0,
  offsetY: 8,
  motions: Object.freeze({
    idle: 'Idle',
    thinking: 'Idle',
    speaking: 'TapBody',
    error: 'Idle',
  }),
});

const MODEL3_SUFFIX = /\.model3\.json(\?|#|$)/i;

/** Tauri convertFileSrc → https://asset.localhost/… or asset://… */
export function isAssetModelUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const path = value.trim().replace(/\\/g, '/');
  if (path.includes('..') || !MODEL3_SUFFIX.test(path)) return false;
  return /^(https?:\/\/asset\.localhost\/|asset:)/i.test(path);
}

export function isLocalModelUrl(value) {
  if (isAssetModelUrl(value)) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  const path = value.trim().replace(/\\/g, '/');
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || path.startsWith('/')) return false;
  return !path.split('/').includes('..') && MODEL3_SUFFIX.test(path);
}

export function normalizeLive2dConfig(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const modelUrl = isLocalModelUrl(value.modelUrl) ? value.modelUrl.replace(/\\/g, '/') : DEFAULT_LIVE2D_CONFIG.modelUrl;
  const number = (candidate, fallback, min, max) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const configuredMotions = value.motions && typeof value.motions === 'object' ? value.motions : {};
  const motions = {};
  for (const state of PET_STATES) {
    const group = configuredMotions[state];
    motions[state] = typeof group === 'string' && group.trim() ? group.trim() : DEFAULT_LIVE2D_CONFIG.motions[state];
  }
  return {
    modelUrl,
    scale: number(value.scale, DEFAULT_LIVE2D_CONFIG.scale, 0.05, 2),
    offsetX: number(value.offsetX, DEFAULT_LIVE2D_CONFIG.offsetX, -1000, 1000),
    offsetY: number(value.offsetY, DEFAULT_LIVE2D_CONFIG.offsetY, -1000, 1000),
    motions,
  };
}

export function normalizePetState(state) {
  return PET_STATES.includes(state) ? state : 'idle';
}

export function sanitizeSkinId(value, fallback = 'default') {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('..') || /[\\/]/.test(raw)) return fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw)) return fallback;
  return raw;
}

export function normalizePetAppearance(cfg = {}) {
  const pet = cfg?.pet && typeof cfg.pet === 'object' ? cfg.pet : {};
  const mode = pet.mode === 'sprite' ? 'sprite' : 'live2d';
  return {
    mode,
    live2d: normalizeLive2dConfig(cfg.live2d),
    spriteSkin: sanitizeSkinId(pet.spriteSkin, 'default'),
    live2dId: sanitizeSkinId(pet.live2dId, 'hiyori'),
  };
}

export function normalizePetScale(value) {
  if (value === null || value === undefined || value === '') return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(PET_SIZE_STEPS.at(-1), Math.max(PET_SIZE_STEPS[0], parsed));
}

export function nextPetScale(current, direction) {
  const value = normalizePetScale(current);
  if (direction > 0) return PET_SIZE_STEPS.find((step) => step > value + 0.001) ?? PET_SIZE_STEPS.at(-1);
  return [...PET_SIZE_STEPS].reverse().find((step) => step < value - 0.001) ?? PET_SIZE_STEPS[0];
}

/** This machine's Connecter (WorkPet binds here unless preferLocalConnecter is false). */
export const LOCAL_CONNECTER_BASE_URL = 'http://127.0.0.1:9080';

export function preferLocalConnecter(cfg = {}) {
  return cfg.preferLocalConnecter !== false;
}

export function isThisEnvironmentConnecter(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    const parts = host.split('.').map((n) => Number(n));
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Prefer this environment's Connecter; ignore a public/other-site URL when preferLocal is on. */
export function resolveConnecterBaseUrl(cfg = {}, { localReachable = false } = {}) {
  const explicit = String(cfg.connecterBaseUrl || cfg.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (explicit && isThisEnvironmentConnecter(explicit)) return explicit;
  if (preferLocalConnecter(cfg) && localReachable) return LOCAL_CONNECTER_BASE_URL;
  if (preferLocalConnecter(cfg)) return LOCAL_CONNECTER_BASE_URL;
  return explicit || LOCAL_CONNECTER_BASE_URL;
}

export function petWindowSize(scale) {
  const value = normalizePetScale(scale);
  return {
    width: Math.round(PET_BASE_SIZE.width * value),
    height: Math.round(PET_BASE_SIZE.height * value),
  };
}
