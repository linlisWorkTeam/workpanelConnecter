import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRITE_CUSTOMIZE_PROMPT } from '../ui/spriteCustomizePrompt.js';

test('customize prompt names the four sprite files and a zip', () => {
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\bidle\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\bthinking\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\bspeaking\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\berror\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\.zip/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /参考图/);
});
