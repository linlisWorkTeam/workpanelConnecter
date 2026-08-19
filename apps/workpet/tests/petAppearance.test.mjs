import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppearanceMenu } from '../ui/petAppearanceMenu.js';
import { framesFromSkin } from '../ui/spritePet.js';

test('appearance menu lists mode, current skins, and upload', () => {
  const menu = buildAppearanceMenu({
    mode: 'sprite',
    currentSkin: 'default',
    currentModelUrl: 'models/hiyori/Hiyori.model3.json',
    live2dItems: [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }],
    spriteItems: [
      { id: 'default', label: '默认剪影' },
      { id: 'mycat', label: 'mycat' },
    ],
  });
  assert.equal(menu.find((r) => r.id === 'mode-sprite').checked, true);
  assert.equal(menu.find((r) => r.id === 'mode-live2d').checked, false);
  assert.equal(menu.find((r) => r.id === 'default').checked, true);
  assert.equal(menu.find((r) => r.id === 'upload').label.includes('动图'), true);
});

test('sprite menu adds copy prompt and load zip; live2d does not', () => {
  const sprite = buildAppearanceMenu({
    mode: 'sprite',
    currentSkin: 'default',
    currentModelUrl: 'models/hiyori/Hiyori.model3.json',
    live2dItems: [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }],
    spriteItems: [{ id: 'default', label: '默认剪影' }],
  });
  assert.equal(sprite.find((r) => r.id === 'copy-prompt').label, '复制定制 prompt');
  assert.equal(sprite.find((r) => r.id === 'load-zip').label, '加载压缩包…');
  assert.ok(sprite.find((r) => r.id === 'upload'));

  const live2d = buildAppearanceMenu({
    mode: 'live2d',
    currentSkin: 'default',
    currentModelUrl: 'models/hiyori/Hiyori.model3.json',
    live2dItems: [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }],
    spriteItems: [{ id: 'default', label: '默认剪影' }],
  });
  assert.equal(live2d.find((r) => r.id === 'copy-prompt'), undefined);
  assert.equal(live2d.find((r) => r.id === 'load-zip'), undefined);
  assert.ok(live2d.find((r) => r.id === 'upload'));
});

test('sprite frames fall back to idle then bundled svg', () => {
  assert.equal(framesFromSkin(null).speaking, 'skin.svg');
  assert.equal(framesFromSkin({ frames: { idle: 'a.webp' } }).error, 'a.webp');
  assert.equal(framesFromSkin({ frames: { idle: 'a.webp', speaking: 'b.gif' } }).speaking, 'b.gif');
});
