# Connecter Relay 运维手册（P0.3）

> 部署形态：方案 B — nginx `:80` `/v1/*` → systemd Connecter `:9080`  
> 决策：root 2026-08-06 · 状态：已上线  
> API 契约：`docs/api-relay.md`

## 1. 端口

| 端口 | 归属 | 说明 |
|------|------|------|
| :80 | nginx | 对外；`/v1/*` → Connecter |
| :9080 | connecter-relay.service | 本机中继 |
| :8081 / :8080 | WP canary / prod | 仅作 backend，Connecter 不改其部署 |

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

## 6. 验证清单

- [ ] `:9080/v1/health` 与 `:80/v1/health` 均为 `ok`  
- [ ] 无 token 访问 `/v1/envs` → 401  
- [ ] pet chat → canary 有 messageId（勿对 prod）  
- [ ] `journalctl` 无持续报错；WP `:8081` 可达  
- [ ] homepage `:80/` 非 `/v1` 路径仍正常（方案 B）  

门禁（发版前）：`npm test` · `npm run test:relay` · 可选 `npm run test:e2e-resume`。

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 明文 HTTP | 公网前上 T2（443→80），见 NEXT P1.1 |
| 单实例中继 | systemd `Restart=on-failure`；备份 DB |
| token 进备份介质 | 限制备份目录权限；轮换后旧备份仍含旧密 |
| 误连 prod | `allowProdFromPet=false`；Pet UI 不提供 prod |
