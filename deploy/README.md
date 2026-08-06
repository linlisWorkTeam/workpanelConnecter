# Connecter Relay 部署（Phase 2 · 方案 B）

> 决策：root 2026-08-06 拍板 **B** —— nginx 保留 :80，`/v1/*` 反代 → Connecter :9080。
> 状态：已上线（2026-08-06）

## 端口策略

| 端口 | 归属 | 说明 |
|---|---|---|
| :80 | nginx（default_server） | 对外入口；`/v1/*` → Connecter，其余 → 原 WorkPanel/homepage 路由 |
| :9080 | Connecter relay（systemd） | 本机监听；开发/生产同一端口，靠 config 区分 |
| :8081 / :8080 | WorkPanel canary / prod | Connecter 后端（配置路由，不改动） |

方案 B 附带收益：Connecter 监听 9080（>1024），**无需 root 绑 80 / setcap**；nginx 负责 80 与未来 443(T2)。

## 部署步骤

```bash
# 1. 配置（gitignored，勿提交真实 token）
cp config/relay.example.json config/relay.json   # 改 token / pets

# 2. systemd
cp deploy/connecter-relay.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now connecter-relay
systemctl status connecter-relay --no-pager

# 3. nginx 反代（default_server 加 /v1/ location，见 nginx-connecter.conf.example）
nginx -t && systemctl reload nginx
```

## 验证

```bash
curl -s http://127.0.0.1:9080/v1/health            # Connecter 直连
curl -s http://127.0.0.1:80/v1/health              # 经 nginx :80（对外路径）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:80/   # homepage 仍 200
journalctl -u connecter-relay -n 20 --no-pager      # 日志
```

## 回滚

```bash
systemctl disable --now connecter-relay
# nginx：移除 default_server 中的 /v1/ location 后 reload
```

## 风险

- nginx 反代为 HTTP 明文（D11：公网前上 443→80，T2 跟进）
- 单机单实例：中继挂了 WorkPet 即不可达（systemd Restart=on-failure 兜底）
- config/relay.json 含真实 token：已 gitignore；轮换需同步 WorkPet 配置
