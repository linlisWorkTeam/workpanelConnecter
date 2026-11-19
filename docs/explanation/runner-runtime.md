# Runner 公共执行核心

Runner 仍使用 Node.js 和 JavaScript ES Modules，不需要 TypeScript 编译，也不引入继承、依赖注入或插件注册框架。此次抽离统一 Codex Runner 与 WorkPanel Runner 的生命周期；它没有新增容器管理服务。

## 从哪里读代码

先读 [runnerLoop.js](../../src/runners/runnerLoop.js)。`runRunner()` 展示注册、启动心跳、领取任务和调用执行器的主流程；`executeLeasedTask()` 展示 ack、执行和结果提交。再按需要查看下面的模块。

| 模块 | 职责 |
| --- | --- |
| [runnerClient.js](../../src/runners/runnerClient.js) | 注册、心跳、领取任务、ack、续租和结果提交的 HTTP 请求 |
| [taskLease.js](../../src/runners/taskLease.js) | 租约续期、到期检测、向执行器发出停止信号 |
| [codexExecutor.js](../../src/runners/codexExecutor.js) | 工作区、Codex 会话、调用现有 CLI 适配器并返回结果 |
| [workpanelExecutor.js](../../src/runners/workpanelExecutor.js) | 派发 WorkPanel 任务、报告受理状态、等待回复 |
| [codex-runner.js](../../scripts/codex-runner.js)、[wp-runner.js](../../scripts/wp-runner.js) | 读取配置，组装客户端和执行器，启动公共循环 |

执行器是一个普通异步函数，接收任务及 `{ signal, reportRunning }`，返回 `{ status, content, writeBack }`。只有需要报告受理状态的执行器才调用 `reportRunning()`。新增执行器时，复用公共循环即可，不应复制心跳和续租逻辑。

## 心跳与租约的区别

心跳证明 Runner 最近仍在连接 Connecter；任务租约证明当前执行者仍有权回传特定任务。二者分别定时执行，不会因执行器正在等待模型或远端回复而暂停。

- 心跳默认每 15 秒发送，可沿用 `runners[].heartbeatMs` 配置；同一 Runner 不重叠发送心跳。
- Runner 顺序执行，每次只领取一个任务；注册时声明最大并发为 1。
- 从领取任务开始维护租约，执行过程中以及提交最终结果时持续续租。
- 续租网络失败或 HTTP 5xx 后，在原租约有效期内重试；明确被拒绝或本地到期后，立即中止执行器信号并禁止后续回传。
- 使用领取/续租请求的开始时间保守计算有效期，迟到的响应不能让已到期的本地租约恢复有效。
- 最终结果 ID 按任务和 attempt 稳定生成；服务端继续负责幂等与 fencing 校验。
- 进程收到 SIGINT/SIGTERM 后停止领取后续任务，等待已领取任务结束；心跳和续租在等待期间继续运行。

## WorkPanel 远程执行的限制

WorkPanel Runner 现在也在等待回复期间持续发送心跳和续租，原先“等回复后才续租”的逻辑已移除。原有 canary 限制和 `writeBack: false` 保持有效。

租约失效会停止继续观察和回传；已发出的 WorkPanel HTTP 请求仍使用现有客户端的请求超时。此适配器没有远端取消确认协议，不能保证已派发的 Agent 随之终止。因此任务重领仍可能遇到远端旧任务继续执行；该限制不能靠结果 fencing 消除。在用于共享可写工作区前，需要另行补齐远端取消确认或按业务任务 ID 去重。

## 本地验证

```bash
npm run test:runner-runtime
npm run test:wp-runner-e2e
npm run test:codex-runner
npm run test:codex-runner-e2e
```

公共核心测试覆盖长任务心跳、结果提交期间续租、租约拒绝、瞬时故障、迟到续租、ack 超时和资源清理。WorkPanel 端到端测试使用真实本地 Relay 与延迟回复的模拟 WorkPanel；Codex 端到端测试使用真实本地 Relay 与模拟 CLI。它们不调用真实模型，也不证明云端生产部署已经验收。

## 语言与维护约束

目前 HTTP/JSON 协议和异步 I/O 仍适合 Node.js；本次继续使用 JavaScript，避免同时迁移语言和执行架构。公共函数用少量 JSDoc 解释边界，业务协议仍需服务端在运行时校验。优先使用普通函数、清晰名称和直接调用链；只抽取已经重复的机制。若以后采用 TypeScript，优先补充协议数据类型，再根据实际问题决定是否引入更多类型抽象。
