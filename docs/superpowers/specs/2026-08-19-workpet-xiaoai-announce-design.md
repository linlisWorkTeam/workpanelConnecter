# WorkPet 小爱完成播报 — 设计稿

> 文档状态：已实现的设计记录；当前行为由 WorkPet UI 测试覆盖。

> 日期：2026-08-19  
> 状态：**待你确认 spec 文件**（桌宠开关；Agent run 终态经 homepage TTS 播稍长结论）  
> 相关：`docs/workpet-connecter-design.md` · `docs/superpowers/specs/2026-08-19-workpet-group-console-design.md`  
> 参考实现：`linlisHomePage` `api/app/plugins/xiaomi/`（`announce()`、`POST /api/tts`、完成播报总开关）

## 1. 已锁定决策

| # | 决策 |
|---|------|
| X1 | **何时播**：本宠发出去的 Agent **run 结束**时播。只认 `completed` / `failed` / `error` / `delivered`。**不**在 `accepted`/`queued`/`running`/`starting` 播（`accepted` 只是 WP 受理，不是结论）。不是每条群消息，也不是手动按钮。 |
| X2 | **音箱**：仍用 homepage 已绑定的那台小爱；不在桌宠里实现 miIO。 |
| X3 | **链路**：WorkPet → linlisHomePage **本机播报接口**（pet token）。不经 Connecter，不直连音箱。 |
| X4 | **开关**：WorkPet 上的「小爱播报」开关；homepage 现有 `announceEnabled` 仍是总闸（关则静默跳过）。 |
| X5 | **文案**：稍长口语。`{petName}，{agent} {status}。` + 当前群该 Agent 最新 `contentDisplay`（去 markdown、截约 80 字）。没有新正文则只播前半句。 |
| X6 | **失败**：网络/401 只桌宠气泡，不打断聊天、不改 Live2D fallback。 |
| X7 | **G2 例外**：桌宠仍不直连 WorkPanel；本功能**额外**连 homepage（仅播报）。Connecter 契约不因本功能新增 `/v1` 路由。 |

## 2. 目标与非目标

**目标：** 打开桌宠开关后，用户把任务交给群里 Agent，run 结束时小爱用口语回报结论，人不必盯着面板。

**非目标（本期）：**

- 桌宠直连小爱 IP/token
- 小爱语音反向控制桌宠（对话/唤醒词）
- 每条 WP 群消息都 TTS
- 子 Agent / 未由本宠发出的 run
- 把播报打进 Connecter `/v1/*`
- 真音箱进 CI

## 3. 拓扑

```text
WorkPet（开关开）  --pollRun-->  Connecter GET /v1/runs/:id
        |                         Connecter GET /v1/groups/:id/messages
        |
        +-- pet token -->  linlisHomePage POST /api/xiaomi/pet-announce
                                      │
                                      │ announce()：总闸 / 半双工 / 防抖
                                      ▼
                                 小爱音箱 TTS
```

`pollRun` 已存在于 `apps/workpet/ui/main.js`。仅当 status ∈ {`completed`,`failed`,`error`,`delivered`} 且开关打开时，拉一次当前群消息拼文案，然后 POST homepage。`accepted` 继续可在面板显示，但不触发小爱。

## 4. Homepage 接口（另一仓）

在 **linlisHomePage** 增加本机桌宠入口，内部调用现有 `announce(text, kind="workpet")`。

**`POST /api/xiaomi/pet-announce`**

鉴权：`Authorization: Bearer <homepagePetToken>` 或 `X-Pet-Token`。token 配在 homepage 服务端（与 `connector_token` 同类，**不是**网页 JWT）。错/缺 → **401**。

**Body**

```json
{
  "text": "林的Pet，cs completed。修好了窗口尺寸。",
  "kind": "workpet",
  "petName": "林的Pet"
}
```

`text` 必填，最长按 homepage `truncate_tts`（280 字）再截一次。homepage `announceEnabled=false` → 200 `{ "skipped": true }`，不 TTS。

不把小米 DID/设备 token 下发给桌宠。

## 5. WorkPet 配置与开关

`~/.workpet/config.json` 增补（均可选；缺省关播报）：

| 字段 | 含义 |
|------|------|
| `xiaoaiAnnounce` | `true` 才在 run 终态请求 homepage |
| `homepageBaseUrl` | 如 `http://127.0.0.1:8000` |
| `homepagePetToken` | 与 homepage 服务端 pet token 相同 |

UI：

- 收起态顶栏：开关，关=灰、开=绿，`aria-label="小爱播报"`
- 展开面板：同一状态再放一次（两处绑定同一 `cfg.xiaoaiAnnounce`）
- 切换立即写 `localStorage` 键 `workpet.xiaoaiAnnounce`，并经新 Tauri 命令回写 `~/.workpet/config.json` 的 `xiaoaiAnnounce`（与现有 `get_config` 对称）。无 Tauri（纯浏览器 dev）只活在 localStorage。

缺 `homepageBaseUrl` 或 token 时打开开关：气泡提示先配 homepage，不发请求。

## 6. 文案规则

纯函数 `formatXiaoaiAnnounce({ petName, agent, status, lastAgentText })`（放 `apps/workpet/ui/`，node:test 覆盖）：

1. 前缀：`{petName}，{agent} {口语status}。`  
   `completed`/`delivered`/`accepted` 终态里成功类 →「已完成」；`failed`/`error` →「失败」；其余用原 status。
2. 若 `lastAgentText` 非空：去 stamp、去 markdown 记号、压空白，接到前缀后，总长 ≤ 80 字（超出截断加「。」不必加「…」也可，与 homepage 280 上限不冲突，桌宠侧先收紧口语）。
3. `lastAgentText` 取当前群 `groupMessages` 里 `senderKind=agent` 且 `senderDisplayName===agent` 的**最新一条** `contentDisplay`。run 刚结束可能还没有 → 只播前缀。

同一 `runId` 只播一次。homepage 侧仍有 `xiaomi_announce_debounce_sec`。

## 7. 失败与验收

| 情况 | 行为 |
|------|------|
| 开关关 | 不请求 homepage |
| homepage 总闸关 | 200 skipped；桌宠不报错 |
| 无 URL/token | 开开关时提示配置 |
| 401/网络 | 气泡「小爱没播出去」；聊天继续 |
| Live2D 挂 | 与本期无关 |

验收：

1. 开关开 + 假 homepage 收到一次 POST，body 含 petName 与 status 口语。
2. 开关关，假 homepage 零请求。
3. `formatXiaoaiAnnounce` 截断与失败口语有单测。
4. 不回归群控制台 `test:ui` / `test:relay-unit`。

## 8. 测试

- WorkPet：`formatXiaoaiAnnounce`；SDK 或 fetch mock：开关关不调用。
- homepage：pet token 401；`announceEnabled` skipped；不测真音箱。

## 9. 明确不做（直到改规范）

- Connecter 新增播报路由
- 小爱控桌宠
- 把设备密钥写进 `~/.workpet/config.json`
