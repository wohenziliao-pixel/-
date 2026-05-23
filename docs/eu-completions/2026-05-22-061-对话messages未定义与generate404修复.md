# 对话 messages 未定义与 generate 404 修复

## 现象

故事书发消息失败，气泡显示 `发送失败: messages is not defined`；控制台 `stream_http_404`，Network 中 `POST /api/backends/chat-completions/generate` 为 404。

## 根因

1. **前端笔误**：`requestAiReply` 内变量名为 `messagesNs`，但日志与 `requestDirectLlamaReply` 多处误写为 `messages`。流式失败后走非流式兜底时触发 `ReferenceError`，掩盖真实 HTTP 404。
2. **服务端 404**：线上 `generate` 路由不可达（进程未起、反代未转发 `/api`、或路径错误），需运维侧排查。

## 改动

- `requestAiReply`：全部改为 `messagesNs`。
- `requestAiReplyStream`：404/405 时尝试备用路径；对用户提示「对话接口未找到…」。
- 构建戳：`20260522-fix-messages-undefined-v139`。

## 路径

- `public/eu.html`

## 自测

1. 本机发一条故事书消息，不应再出现 `messages is not defined`。
2. 若仍失败且为 404：服务器执行 `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8000/api/backends/chat-completions/generate`（需带登录 cookie 时改用浏览器 Network 看状态）；确认 SillyTavern 在跑且 Nginx/隧道转发 `/api/*`。
