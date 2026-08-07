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

export function isLocalModelUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const path = value.trim().replace(/\\/g, '/');
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || path.startsWith('/')) return false;
  return !path.split('/').includes('..') && path.toLowerCase().endsWith('.model3.json');
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

export function petWindowSize(scale) {
  const value = normalizePetScale(scale);
  return {
    width: Math.round(PET_BASE_SIZE.width * value),
    height: Math.round(PET_BASE_SIZE.height * value),
  };
}
