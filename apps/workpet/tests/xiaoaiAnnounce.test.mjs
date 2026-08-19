import test from 'node:test';
import assert from 'node:assert/strict';
import { postXiaoaiAnnounce, readXiaoaiEnabled } from '../ui/xiaoaiAnnounce.js';

test('readXiaoaiEnabled: storage overrides cfg', () => {
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: false }, () => '1'), true);
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: true }, () => '0'), false);
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: true }, () => 'true'), true);
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: false }, () => 'false'), false);
});

test('readXiaoaiEnabled: falls back to cfg when storage empty', () => {
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: true }, () => null), true);
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: false }, () => undefined), false);
  assert.equal(readXiaoaiEnabled(null, null), false);
  assert.equal(readXiaoaiEnabled({ xiaoaiAnnounce: true }, null), true);
});

test('postXiaoaiAnnounce no-ops when switch off', async () => {
  const calls = [];
  globalThis.fetch = async (...a) => { calls.push(a); return { ok: true, json: async () => ({}) }; };
  const r = await postXiaoaiAnnounce({ enabled: false, homepageBaseUrl: 'http://127.0.0.1:8000', homepagePetToken: 'x', text: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(calls.length, 0);
});

test('postXiaoaiAnnounce posts Bearer token', async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ data: { skipped: false } }) };
  };
  const r = await postXiaoaiAnnounce({
    enabled: true,
    homepageBaseUrl: 'http://127.0.0.1:8000/',
    homepagePetToken: 'pet-secret',
    text: '林的Pet，cs 已完成。',
  });
  assert.equal(r.ok, true);
  assert.equal(captured.url, 'http://127.0.0.1:8000/api/xiaomi/pet-announce');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer pet-secret');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.kind, 'workpet');
  assert.equal(body.text, '林的Pet，cs 已完成。');
});
