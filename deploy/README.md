# Connecter Relay 运维手册（P0.3）

> 部署形态：方案 B — nginx `:80` `/v1/*` → systemd Connecter `:9080`  
> 决策：root 2026-08-06 · 状态：已上线  
> API 契约：`docs/api-relay.md`  
> **角色**：每站点一台 **Connecter**（`connecter-relay` 进程）；**Connecter Host** 全网一台，单站可与 Connecter 合署。桌宠 `connecterBaseUrl` 绑的是 Connecter，不是 Host。规格：`docs/superpowers/specs/2026-08-19-connecter-host-naming-design.md`。

| 场景 | 桌宠绑定的 Connecter（`connecterBaseUrl`） | 该站 runner `CONNECTER_RELAY_URL` |
|------|------------------------------------------|----------------------------------|
| 现在（本机开发） | `http://127.0.0.1:9080`（本环境 Connecter） | 同机 `http://127.0.0.1:9080` |
| 现在（ECS 合署站） | 该站桌宠才填 `http://101.132.60.79` | 与 Connecter 同机：`http://127.0.0.1:9080` |
| HTTPS 域名（443 通时） | `https://www.coffeecookie.online` | 同上 |
| 以后（局域网本站） | `http://<本站Connecter>:9080` 或内网 nginx `:80` | 同机 `127.0.0.1:9080` |

跨站走 Host federation；本站聊天不经 Host。桌宠不做扫端口 / mDNS，也不直接连接 Host。

## 1. 端口

| 端口 | 归属 | 说明 |
|------|------|------|
| :80 | nginx | 对外；`/v1/*` → Connecter |
| :9080 | connecter-relay.service | 本机中继 |
| :8082（当前本机）/ :8081（历史 fixture）/ :8080 | WP canary / prod | 仅作 backend，实际地址以 `relay.json` 为准；Connecter 不改其部署 |

开发可直连 `CONNECTER_RELAY_PORT=9080`，无需 nginx。

## 2. 日常操作

```bash
# 状态 / 日志
systemctl status connecter-relay --no-pager
journalctl -u connecter-relay -n 50 --no-pager -f

# 健康
curl -sS http://127.0.0.1:9080/v1/health
curl -sS http://127.0.0.1/v1/health

# 重载配置（改 relay.json / pets 后）
systemctl restart connecter-relay
# 改 nginx 后
nginx -t && systemctl reload nginx
```

配置路径（默认）：`/AI/WorkPanelConnecter/config/relay.json`（**gitignore，勿提交 token**）。  
数据库：`data/connector.db`（及 `-wal`/`-shm`）。

## 3. 备份与恢复

```bash
# 停写窗口尽量短：可先 stop，或依赖 WAL 热拷（仍建议停服备份）
systemctl stop connecter-relay
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/backups/connecter
cp -a /AI/WorkPanelConnecter/data/connector.db* /var/backups/connecter/db-$TS/
cp -a /AI/WorkPanelConnecter/config/relay.json /var/backups/connecter/relay-$TS.json
systemctl start connecter-relay
```

恢复：停服 → 还原 `connector.db*` 与（如需）`relay.json` → 启动。  
启动会 `resumePending`：将 `accepted` 未投递消息续投 canary/对应 backend。

## 4. Token 轮换（Pet）

1. 生成新 secret，写入 `relay.json` → `pets[].token`（可先保留旧 token 并行，或直接替换）。  
2. `systemctl restart connecter-relay`（bootstrap 新 session）。  
3. 更新 WorkPet 本机配置中的 Bearer。  
4. 若旧 token 已泄露：用旧 token 调 `POST /v1/session/revoke`，或改 token 后重启（旧 hash 不再匹配）。  
5. **勿**把真实 token 提交进 git；example 仅占位字符串。

Ops token（`auth.tokens`）同样改配置 + 重启；不走 revoke API。

## 5. 部署 / 回滚

```bash
cp config/relay.example.json config/relay.json   # 首次；再改真实值
cp deploy/connecter-relay.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now connecter-relay

# nginx：按 nginx-connecter.conf.example 合并 /v1/ location
nginx -t && systemctl reload nginx
```

回滚：

```bash
systemctl disable --now connecter-relay
# 去掉 nginx /v1/ location 后 reload
```

## 6. wp-runner（E2，ECS）

进程出站 pull：`heartbeat` + `/v1/agents/tasks` → 调用配置中的 canary WorkPanel → `/v1/agents/tasks/result`。历史 ECS fixture 使用 `:8081`；当前本机 canary 证据使用 `:8082`。
**不要**把 runner 配到 prod `:8080`（`scripts/wp-runner.js` 会拒）。

```bash
# 1. 在 relay.json 预配 runners[]（agentId/token/bindings；token 勿进 git）
#    绑定须与群管理员 displayName 一致，灰度群当前为 Cursor Agent
# 2. 安装 unit
cp deploy/wp-runner.service /etc/systemd/system/
systemctl daemon-reload
systemctl restart connecter-relay   # 加载 runners[]
systemctl enable --now wp-runner

systemctl status wp-runner --no-pager
journalctl -u wp-runner -n 50 --no-pager -f
```

验收（本机 loopback，禁止 echo mock）：

- `GET /v1/agents`（ops）里该 binding `runner_status=active` 且 `runner_last_seen` 新鲜
- pet `POST /v1/chat` 无 `@` → 响应带 `runner.agentId`（否则 503 `runner_offline`）
- canary 灰度群出现真实 WP 消息；`GET /v1/messages` 有非占位全文或 WP 回执

桌宠默认绑 **本环境 Connecter**（`http://127.0.0.1:9080`），不要把开发机桌宠直接指到 ECS。ECS 灰度 runner 给绑在那一站 Connecter 上的宠用。

## 7. 验证清单

- [ ] `:9080/v1/health` 与 `:80/v1/health` 均为 `ok`  
- [ ] 无 token 访问 `/v1/envs` → 401  
- [ ] pet chat → canary 有 messageId（勿对 prod）  
- [ ] `journalctl` 无持续报错；`relay.json` 配置的 WorkPanel backend 可达
- [ ] homepage `:80/` 非 `/v1` 路径仍正常（方案 B）  

门禁（发版前）：`npm test` · `npm run test:relay` · 可选 `npm run test:e2e-resume`。

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 明文 HTTP | 公网前上 T2（443→80），见 NEXT P1.1 |
| 单实例中继 | systemd `Restart=on-failure`；备份 DB |
| token 进备份介质 | 限制备份目录权限；轮换后旧备份仍含旧密 |
| 误连 prod | `allowProdFromPet=false`；Pet UI 不提供 prod |
