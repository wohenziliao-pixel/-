# SillyTavern generate 仅返回 `400 {"error":true}` 的可读化

## 现象

EU 故事书发送失败，提示 `SillyTavern 400: {"error":true}`，难以判断是未配 API 密钥还是不支持的 `chat_completion_source`。

## 常见根因（与本次代码无关的配置项）

1. **预设为 OpenAI 但未填密钥、也未用反向代理**：`chat-completions.js` 在 `!apiKey && !reverse_proxy && source !== custom` 时直接 400。
2. **`chat_completion_source` 不在当前分支支持列表**：落入 `else`，原先同样只返回 `{ error: true }`。
3. 本机 **llama-server** 未开或 **Custom URL** 错误时，多为 **502** 或上游错误 JSON，而非此裸 400。

## 改动

- `src/endpoints/backends/chat-completions.js`：上述 400 分支补充 `message` 字段（空 body、不支持 source、缺 OpenAI 密钥）。
- `public/eu-demo.html`：解析 400 响应体 JSON 中的 `message` 再拼进用户可见错误；更新 `EU_CLIENT_BUILD_STAMP`。

## 用户操作

重启 SillyTavern 进程后重试；若提示缺密钥，在酒馆 **API 连接** 将来源改为 **Custom** 并填写本机 `http://127.0.0.1:8080/v1`（或实际 llama 地址），与主界面能正常发聊同一预设。
