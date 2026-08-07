import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIVE2D_CONFIG,
  isLocalModelUrl,
  nextPetScale,
  normalizeLive2dConfig,
  normalizePetScale,
  normalizePetState,
  petWindowSize,
} from '../ui/petConfig.js';

test('accepts only local model3.json paths', () => {
  assert.equal(isLocalModelUrl('models/pet/pet.model3.json'), true);
  assert.equal(isLocalModelUrl('https://example.com/pet.model3.json'), false);
  assert.equal(isLocalModelUrl('../secret.model3.json'), false);
  assert.equal(isLocalModelUrl('/models/pet.model3.json'), false);
  assert.equal(isLocalModelUrl('models/pet.json'), false);
});

test('normalizes numeric bounds and motion groups', () => {
  const result = normalizeLive2dConfig({
    modelUrl: 'custom\\pet.model3.json',
    scale: 99,
    offsetX: '24',
    offsetY: Number.NaN,
    motions: { speaking: 'Wave', idle: '' },
  });
  assert.equal(result.modelUrl, 'custom/pet.model3.json');
  assert.equal(result.scale, 2);
  assert.equal(result.offsetX, 24);
  assert.equal(result.offsetY, DEFAULT_LIVE2D_CONFIG.offsetY);
  assert.equal(result.motions.speaking, 'Wave');
  assert.equal(result.motions.idle, 'Idle');
});

test('falls back unknown UI states to idle', () => {
  assert.equal(normalizePetState('thinking'), 'thinking');
  assert.equal(normalizePetState('offline'), 'idle');
  assert.equal(normalizePetState(undefined), 'idle');
});

test('clamps pet scale and calculates window size', () => {
  assert.equal(normalizePetScale(null), 1);
  assert.equal(normalizePetScale('bad'), 1);
  assert.equal(normalizePetScale(0.2), 0.75);
  assert.equal(normalizePetScale(4), 1.5);
  assert.deepEqual(petWindowSize(1.15), { width: 345, height: 483 });
});

test('steps pet scale in both directions', () => {
  assert.equal(nextPetScale(1, 1), 1.15);
  assert.equal(nextPetScale(1, -1), 0.9);
  assert.equal(nextPetScale(1.5, 1), 1.5);
  assert.equal(nextPetScale(0.75, -1), 0.75);
});
