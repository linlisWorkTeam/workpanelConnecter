# 凭证事件运行手册

[English](security-incident.md) · [简体中文](security-incident.zh-CN.md)

1. 禁用受影响的 peer/device，并吊销其活动凭证或签名密钥；
2. 添加并部署 `next` 密钥，将其切换为 active；所有 peer 接受后再吊销旧密钥；
3. 按站点、主体、密钥 ID、trace 和消息搜索 append-only 审计事件，枚举暴露窗口内已接受的投递。使用 `GET /v1/ops/security/deliveries?siteId=&keyId=&since=&until=&status=`；该接口只返回标识符和状态，不返回消息体；
4. 只重新排队已核实的非终态命令。不要为不同内容复用 message ID；
5. 轮换 Bearer/bootstrap 密钥，复查 Site/群组 ACL，并保留加密数据库快照供调查。
