# WorkPet 小爱完成播报 Implementation Plan

> 文档状态：历史实施计划。小爱播报的最终行为以 WorkPet 测试和 `apps/workpet/README.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌宠开关打开后，本宠发出的 Agent run 真正结束时，经 linlisHomePage 用小爱播一句稍长口语结论。

**Architecture:** WorkPet 不直连音箱、不经 Connecter 播报。`pollRun` 等到 `completed|failed|error|delivered` 后拼文案，POST homepage `POST /api/xiaomi/pet-announce`（pet token）。homepage 调用现有 `announce()`，总闸/半双工/防抖不变。`accepted` 只在面板显示、不 TTS。

**Tech Stack:** WorkPet 纯 JS + Tauri 2；homepage FastAPI + 现有 `app.plugins.xiaomi`。

**Repos:** `D:\AI\workpanelConnecter`（桌宠）与 `D:\AI\linlisHomePage`（播报接口）。两仓分别提交。

## Global Constraints

- 不在桌宠实现 miIO；不把小米 DID/设备 token 写入 `~/.workpet/config.json`。
- 桌宠仍不直连 WorkPanel（G2）；本功能额外只连 homepage 播报接口。
- Connecter **不**新增 `/v1` 播报路由。
- 终态集合精确为 `completed` / `failed` / `error` / `delivered`；**永不**对 `accepted`/`queued`/`running`/`starting` TTS。
- 开关关或缺 `homepageBaseUrl`/`homepagePetToken`：不发请求。
- homepage `announceEnabled=false` → 200 `{ "skipped": true }`，桌宠不报错。
- 文案桌宠侧总长 ≤ 80 字；homepage 再套 `truncate_tts`（280）。
- 同一 `runId` 只播一次。
- CI 不连真音箱。`npm run test:ui` 与 `npm run test:relay-unit` 必须保持绿。
- 失败只气泡「小爱没播出去」。

---

## File map

| File | Responsibility |
|------|----------------|
| `apps/workpet/ui/petStamp.js` | `formatXiaoaiAnnounce`、`XIAOAI_DONE_STATUSES` |
| `apps/workpet/ui/xiaoaiAnnounce.js` | POST homepage；开关关短路 |
| `apps/workpet/tests/petStamp.test.mjs` | 文案单测 |
| `apps/workpet/tests/xiaoaiAnnounce.test.mjs` | fetch mock：关开关零请求 |
| `apps/workpet/ui/main.js` `index.html` `style.css` | 开关 UI + pollRun 挂钩 |
| `apps/workpet/src-tauri/src/main.rs` | `set_config` 回写 `xiaoaiAnnounce` |
| `apps/workpet/config.example.json` | 新字段占位 |
| `linlisHomePage/api/app/core/config.py` | `xiaomi_pet_token` |
| `linlisHomePage/api/app/plugins/xiaomi/router.py` | `POST /pet-announce` |
| `linlisHomePage/api/tests/test_xiaomi_pet_announce.py` | 401 / skipped / 调用 announce |

---

### Task 1: 播报文案纯函数

**Files:**
- Modify: `apps/workpet/ui/petStamp.js`
- Modify: `apps/workpet/tests/petStamp.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `export const XIAOAI_DONE_STATUSES = ['completed', 'failed', 'error', 'delivered']`；`export function formatXiaoaiAnnounce({ petName, agent, status, lastAgentText })` → `string`；`export function isXiaoaiDoneStatus(status)` → `boolean`

- [ ] **Step 1: Write the failing test**

Append to `apps/workpet/tests/petStamp.test.mjs`:

```js
import {
  formatXiaoaiAnnounce,
  isXiaoaiDoneStatus,
} from '../ui/petStamp.js';

test('isXiaoaiDoneStatus only terminal results', () => {
  assert.equal(isXiaoaiDoneStatus('delivered'), true);
  assert.equal(isXiaoaiDoneStatus('failed'), true);
  assert.equal(isXiaoaiDoneStatus('accepted'), false);
  assert.equal(isXiaoaiDoneStatus('running'), false);
});

test('formatXiaoaiAnnounce success with latest agent text', () => {
  const text = formatXiaoaiAnnounce({
    petName: '林的Pet',
    agent: 'cs',
    status: 'delivered',
    lastAgentText: '修好了窗口尺寸。还有一些边距。',
  });
  assert.match(text, /^林的Pet，cs 已完成。/);
  assert.ok(text.length <= 80);
  assert.match(text, /修好了窗口尺寸/);
});

test('formatXiaoaiAnnounce failed without body', () => {
  assert.equal(
    formatXiaoaiAnnounce({ petName: 'WorkPet', agent: 'cs', status: 'failed', lastAgentText: '' }),
    'WorkPet，cs 失败。'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/workpet && node --test tests/petStamp.test.mjs`

Expected: FAIL `does not provide an export named 'formatXiaoaiAnnounce'`

- [ ] **Step 3: Implement**

Add to `apps/workpet/ui/petStamp.js`:

```js
export const XIAOAI_DONE_STATUSES = ['completed', 'failed', 'error', 'delivered'];

export function isXiaoaiDoneStatus(status) {
  return XIAOAI_DONE_STATUSES.includes(String(status || ''));
}

function spokenStatus(status) {
  const s = String(status || '');
  if (s === 'completed' || s === 'delivered') return '已完成';
  if (s === 'failed' || s === 'error') return '失败';
  return s || '已结束';
}

function stripForSpeech(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/[#*`>|]+/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function formatXiaoaiAnnounce({ petName, agent, status, lastAgentText } = {}) {
  const name = String(petName || 'WorkPet').trim() || 'WorkPet';
  const who = String(agent || 'Agent').trim() || 'Agent';
  const prefix = `${name}，${who} ${spokenStatus(status)}。`;
  const extra = stripForSpeech(lastAgentText);
  if (!extra) return prefix.slice(0, 80);
  const room = 80 - prefix.length;
  if (room <= 1) return prefix.slice(0, 80);
  const body = extra.length <= room ? extra : extra.slice(0, Math.max(0, room - 1)).trimEnd();
  return `${prefix}${body}`.slice(0, 80);
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/workpet && npm run test:ui`

Expected: all pass (including the new three).

- [ ] **Step 5: Commit** (workpanelConnecter)

```bash
git add apps/workpet/ui/petStamp.js apps/workpet/tests/petStamp.test.mjs
git commit -m "feat: format WorkPet XiaoAi announce copy"
```

---

### Task 2: homepage pet-announce 接口

**Files:**
- Modify: `D:\AI\linlisHomePage\api\app\core\config.py`（`xiaomi_pet_token: str = ""`）
- Modify: `D:\AI\linlisHomePage\api\app\plugins\xiaomi\router.py`
- Create: `D:\AI\linlisHomePage\api\tests\test_xiaomi_pet_announce.py`

**Interfaces:**
- Consumes: `announce(text, kind=...)` from `app.plugins.xiaomi.dialogue.orchestrator`
- Produces: `POST /api/xiaomi/pet-announce`；Header `Authorization: Bearer <token>` **或** `X-Pet-Token: <token>`；body `{ "text", "kind": "workpet", "petName" }`

- [ ] **Step 1: Write the failing test**

`api/tests/test_xiaomi_pet_announce.py`:

```python
from unittest.mock import AsyncMock, patch

from app.core.config import settings


def test_pet_announce_requires_token(client, monkeypatch):
    monkeypatch.setattr(settings, "xiaomi_pet_token", "pet-secret")
    assert client.post("/api/xiaomi/pet-announce", json={"text": "hi"}).status_code == 401


def test_pet_announce_wrong_token(client, monkeypatch):
    monkeypatch.setattr(settings, "xiaomi_pet_token", "pet-secret")
    r = client.post(
        "/api/xiaomi/pet-announce",
        json={"text": "hi"},
        headers={"X-Pet-Token": "nope"},
    )
    assert r.status_code == 401


def test_pet_announce_calls_announce(client, monkeypatch):
    monkeypatch.setattr(settings, "xiaomi_pet_token", "pet-secret")
    mocked = AsyncMock()
    with patch("app.plugins.xiaomi.router.announce", mocked):
        r = client.post(
            "/api/xiaomi/pet-announce",
            json={"text": "林的Pet，cs 已完成。", "kind": "workpet", "petName": "林的Pet"},
            headers={"X-Pet-Token": "pet-secret"},
        )
    assert r.status_code == 200
    mocked.assert_awaited()
    assert mocked.await_args.kwargs.get("kind") == "workpet" or mocked.await_args.args[0]
```

If `announce` import path in router is `from app.plugins.xiaomi.dialogue.orchestrator import announce`, patch that path: `app.plugins.xiaomi.dialogue.orchestrator.announce`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\AI\linlisHomePage\api && python -m pytest tests/test_xiaomi_pet_announce.py -q`

Expected: FAIL import or 404 `/pet-announce`

- [ ] **Step 3: Implement**

`config.py` add:

```python
xiaomi_pet_token: str = ""
```

In `router.py` add:

```python
from fastapi import Header, Request
from app.core.config import settings
from app.plugins.xiaomi.dialogue.orchestrator import announce
from app.plugins.xiaomi.watchers.parse import truncate_tts

class PetAnnounceRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    kind: str = "workpet"
    petName: str | None = None

def _pet_token_ok(request: Request, x_pet_token: str | None) -> bool:
    expected = (settings.xiaomi_pet_token or "").strip()
    if not expected:
        return False
    auth = request.headers.get("authorization") or ""
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    got = (x_pet_token or bearer or "").strip()
    return got == expected

@router.post("/pet-announce")
async def pet_announce(
    req: PetAnnounceRequest,
    request: Request,
    x_pet_token: Annotated[str | None, Header()] = None,
) -> Result[dict]:
    if not (settings.xiaomi_pet_token or "").strip():
        raise HTTPException(status_code=503, detail="pet announce token not configured")
    if not _pet_token_ok(request, x_pet_token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    text = truncate_tts(req.text.strip())
    await announce(text, kind=req.kind or "workpet")
    return Result.success({"status": "ok", "skipped": False})
```

`announce()` already no-ops TTS when `announceEnabled` is false. Return 200 either way. If you can read skipped from hub, optional; otherwise `{ skipped: false }` is fine — desktop treats any 2xx as success.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_xiaomi_pet_announce.py tests/test_xiaomi_plugin.py -q`

Expected: pass

- [ ] **Step 5: Commit** (linlisHomePage)

```bash
git add api/app/core/config.py api/app/plugins/xiaomi/router.py api/tests/test_xiaomi_pet_announce.py
git commit -m "feat: pet-announce endpoint for WorkPet XiaoAi TTS"
```

---

### Task 3: WorkPet homepage 客户端

**Files:**
- Create: `apps/workpet/ui/xiaoaiAnnounce.js`
- Create: `apps/workpet/tests/xiaoaiAnnounce.test.mjs`
- Modify: `apps/workpet/package.json` `test:ui` 加入新测试文件

**Interfaces:**
- Consumes: `formatXiaoaiAnnounce`（拼好的 `text` 由 Task 5 传入）
- Produces: `export async function postXiaoaiAnnounce({ enabled, homepageBaseUrl, homepagePetToken, text })` → `{ ok, skipped, error }`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { postXiaoaiAnnounce } from '../ui/xiaoaiAnnounce.js';

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
```

- [ ] **Step 2: Run to fail**

Run: `cd apps/workpet && node --test tests/xiaoaiAnnounce.test.mjs`

Expected: module not found

- [ ] **Step 3: Implement**

```js
export async function postXiaoaiAnnounce({
  enabled,
  homepageBaseUrl,
  homepagePetToken,
  text,
} = {}) {
  if (!enabled) return { ok: true, skipped: true, error: null };
  const base = String(homepageBaseUrl || '').replace(/\/+$/, '');
  const token = String(homepagePetToken || '').trim();
  const payload = String(text || '').trim();
  if (!base || !token) return { ok: false, skipped: true, error: 'homepage 未配置' };
  if (!payload) return { ok: false, skipped: true, error: 'empty text' };
  try {
    const res = await fetch(base + '/api/xiaomi/pet-announce', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-Pet-Token': token,
      },
      body: JSON.stringify({ text: payload, kind: 'workpet' }),
    });
    if (!res.ok) {
      return { ok: false, skipped: false, error: 'HTTP ' + res.status };
    }
    return { ok: true, skipped: false, error: null };
  } catch (err) {
    return { ok: false, skipped: false, error: err.message || 'network' };
  }
}
```

Update `test:ui`:

`"test:ui": "node --test tests/petConfig.test.mjs tests/connecterApi.test.mjs tests/petStamp.test.mjs tests/xiaoaiAnnounce.test.mjs"`

- [ ] **Step 4: Run** `cd apps/workpet && npm run test:ui` — all pass

- [ ] **Step 5: Commit**

```bash
git add apps/workpet/ui/xiaoaiAnnounce.js apps/workpet/tests/xiaoaiAnnounce.test.mjs apps/workpet/package.json
git commit -m "feat: WorkPet client for homepage XiaoAi announce"
```

---

### Task 4: 开关 UI + Tauri 回写

**Files:**
- Modify: `apps/workpet/src-tauri/src/main.rs`
- Modify: `apps/workpet/ui/index.html`
- Modify: `apps/workpet/ui/style.css`
- Modify: `apps/workpet/ui/main.js`
- Modify: `apps/workpet/config.example.json`

**Interfaces:**
- Consumes: `cfg.xiaoaiAnnounce`, `cfg.homepageBaseUrl`, `cfg.homepagePetToken`
- Produces: `set_config` 合并写 `~/.workpet/config.json`；`localStorage workpet.xiaoaiAnnounce`

- [ ] **Step 1: Write failing tests for config merge helper if you extract one**

若 Rust 不便单测，在 `apps/workpet/ui/petStamp.js` 或 `xiaoaiAnnounce.js` 增加：

```js
export function readXiaoaiEnabled(cfg, storageGet) {
  const stored = storageGet && storageGet('workpet.xiaoaiAnnounce');
  if (stored === '1' || stored === 'true') return true;
  if (stored === '0' || stored === 'false') return false;
  return Boolean(cfg && cfg.xiaoaiAnnounce);
}
```

Test that storage overrides cfg.

- [ ] **Step 2: Fail then implement Rust**

```rust
#[tauri::command]
fn set_config(patch: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home dir".to_string())?;
    let dir = home.join(".workpet");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let mut root = serde_json::Map::new();
    if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&raw) {
            root = map;
        }
    }
    let incoming: serde_json::Value =
        serde_json::from_str(&patch).map_err(|e| format!("invalid json: {e}"))?;
    if let serde_json::Value::Object(map) = incoming {
        for (k, v) in map {
            root.insert(k, v);
        }
    } else {
        return Err("patch must be object".into());
    }
    let out = serde_json::Value::Object(root);
    std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap() + "\n")
        .map_err(|e| e.to_string())
}
```

Register: `generate_handler![get_config, set_config]`

`Cargo.toml` 已有 `serde_json` 则直接用；没有就加 `serde_json = "1"`.

HTML 顶栏 `top-actions` 里 size-control **之前**插入：

```html
<button id="xiaoaiToggle" class="icon-btn xiaoai-toggle" type="button" aria-pressed="false" aria-label="小爱播报" title="小爱播报">
  <span aria-hidden="true">♪</span>
</button>
```

展开面板 `panel-head` 里 connectionBadge 旁加同样 `id="xiaoaiTogglePanel"`（两个按钮调同一个 `setXiaoaiEnabled`）。

CSS：`.xiaoai-toggle.is-on { color: #7dffb3; }` 灰默认。

`main.js`：`setXiaoaiEnabled(on)` 更新 `cfg.xiaoaiAnnounce`、两按钮 `aria-pressed`/`is-on`、`localStorage`、`invoke('set_config', { patch: JSON.stringify({ xiaoaiAnnounce: on }) })`。打开但缺 URL/token → `addMsg('请先配置 homepageBaseUrl 和 homepagePetToken。', 'err')` 且不要保持开（或保持开但气泡提示；**规格：开开关时提示，不发请求** — 允许开关视觉为开，post 时 skipped）。

config.example.json:

```json
"xiaoaiAnnounce": false,
"homepageBaseUrl": "http://127.0.0.1:8000",
"homepagePetToken": "REPLACE_WITH_HOMEPAGE_XIAOMI_PET_TOKEN"
```

- [ ] **Step 4:** `cd apps/workpet && npm run test:ui`

- [ ] **Step 5: Commit** `feat: WorkPet XiaoAi announce toggle persisted via Tauri`

---

### Task 5: pollRun 挂钩

**Files:**
- Modify: `apps/workpet/ui/main.js`

**Interfaces:**
- Consumes: `isXiaoaiDoneStatus`, `formatXiaoaiAnnounce`, `postXiaoaiAnnounce`, `client.groupMessages`, `client.runs`
- Produces: 每个 `runId` 最多一次 POST

- [ ] **Step 1:** 无 jsdom。把「何时播」逻辑抽到 `petStamp.js`：

```js
export function shouldAnnounceRun(prevStatus, nextStatus) {
  return !isXiaoaiDoneStatus(prevStatus) && isXiaoaiDoneStatus(nextStatus);
}
```

Test: `accepted → delivered` true；`delivered → delivered` false；`running → accepted` false.

- [ ] **Step 2: Fail then change `pollRun`**

```js
async function pollRun(runId, meta = {}) {
  if (!client || runPolls[runId]) return;
  runPolls[runId] = true;
  const max = cfg.maxRunPolls || 30;
  let prev = '';
  const announced = new Set(); // module-level runAnnounced better
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
    } catch (_) { /* 下一轮 */ }
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
```

`send()` 里 `pollRun(runId, { agent: response.mentionedAgent || response.coordinatorAgent || '' })`.

`groupMessages` 响应是 `{ messages }`（handlers）。

- [ ] **Step 4:** `cd apps/workpet && npm run test:ui` 以及仓库根 `npm run test:relay-unit`

- [ ] **Step 5: Commit** `feat: announce XiaoAi when pet-dispatched runs finish`

---

### Task 6: 文档占位

**Files:**
- Modify: `apps/workpet/README.md`（配置表加三字段 + 开关说明）
- Modify: `docs/NEXT-DEV-PATH.md` P3 或 P2 旁记一行「WorkPet 小爱播报（homepage pet-announce）」⏳→ 本任务结束后 ✅

不改 `docs/api-relay.md`（无新 Connecter 路由）。

- [ ] **Step 3:** 无测试。确认 README 不含真实 token。

- [ ] **Step 4: Commit** `docs: document WorkPet XiaoAi homepage announce switch`

- [ ] **Step 5:** homepage `.env.example` 增加 `XIAOMI_PET_TOKEN=`（若该仓用 env 映射 pydantic）。

---

## Self-review

| Spec | Task |
|------|------|
| X1 终态集合 / 非 accepted | 1, 5 |
| X2 不实现 miIO | 全程 |
| X3 homepage pet-announce | 2, 3 |
| X4 双开关 + 总闸 | 2, 4 |
| X5 稍长文案 ≤80 | 1 |
| X6 失败气泡 | 5 |
| X7 不新增 Connecter 路由 | 6 |
| Tauri 回写 | 4 |
| 同一 runId 一次 | 5 `runAnnounced` |

无 TBD。`pollRun` 对 `accepted` 继续轮询直到 DONE 或次数用尽。
