# WorkPet / Connecter / Connecter Host — 命名与边界

> 日期：2026-08-19 · 状态：**已拍板**  
> 拍板：用户确认「同意」  
> 文档状态：命名与边界决定仍有效；其中“联邦未实现”属于 2026-08-19 历史状态。当前实现见 `docs/architecture.md` 与 `docs/P0-P3-IMPLEMENTATION-STATUS.md`。

## 1. 锁定的名字

| 名字 | 数量 | 出现在 | 职责 |
|------|------|--------|------|
| **WorkPet** | 很多 | **仅 UI** | 桌宠。只连自己绑定的那一台 Connecter。 |
| **Connecter** | 每站点一台 | 后端 | 接下辖 WorkPet；对本站 WorkPanel 投递；出站 Runner 挂在这一台。 |
| **Connecter Host** | **全网一台** | 后端 | 只做 Connecter↔Connecter 会合。不接桌宠、不直连 WP、不执行 Agent。 |

进程/仓库里现有的 `connecter-relay`、`/v1/*`、`connecterBaseUrl` **先不改字符串**。语义：

- `connecterBaseUrl` = 这只 WorkPet **绑定的 Connecter**（不是 Host）。
- 单站可以把 Host 与该站 Connecter **合署**为同一进程（当前 ECS 即此）。
- 多站时再拆进程；协议按已经拆开来写。

UI 不出现 Host、不出现「中继」第二套产品名。

## 2. 关系

```text
WorkPet A ──绑定──► Connecter A ──► 本站 WorkPanel A
                      │
                      ▼
                Connecter Host（唯一）
                      │
                      ▼
WorkPet B ──绑定──► Connecter B ──► 本站 WorkPanel B
```

- **本站**：`WorkPet A → Connecter A → WP A`。**不经过 Host**。Host 宕机，本站聊天仍应可用。
- **跨站**：`Connecter A → Host → Connecter B → WP/Runner B`。会合链路和 durable federation 均已在 v0.2.0+ 落地；真实多服务器部署仍是环境验收项。

## 3. 守住的边界

1. WorkPet **永不**直连 Host、**永不**直连 WorkPanel（G2：不做桌宠侧 mDNS/扫端口）。
2. Host **不执行** Agent；群消息权威仍在 WorkPanel。
3. Runner / wp-runner 向 **Connecter** 出站 pull，不向 Host 注册（合署时同一端口无妨）。
4. Host 不选主（E4 再说）。
5. 不要再发明 Node / Edge / Hub 第四个词。

## 4. 当前部署怎么读

ECS `connecter-relay` + nginx `:80 /v1/` = **云站点 Connecter 与 Host 合署**。  
本机 `127.0.0.1:9080` = **本环境 Connecter**。WorkPet **优先绑定本环境**（loopback / 局域网），不把桌宠直接绑定 Host 或别的站；跨站由本站 Connecter 代为联邦。

局域网：每台（或每办公室）一台 Connecter；需要跨站时所有 Connecter 指向同一 Host URL。桌宠仍只填本站 Connecter。

## 5. 非目标（本稿）

- 不实现 Connecter↔Host 联邦协议（E3）。
- 不重命名 systemd unit / npm 包 / 源码目录。
- 不改 WorkPet 窗口上的产品名（仍叫 WorkPet）。
