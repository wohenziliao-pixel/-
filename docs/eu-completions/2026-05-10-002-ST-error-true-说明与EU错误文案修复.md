# SillyTavern 返回 `error: true` 的说明与 EU 错误展示修复

## 现象

故事书对话中出现「发送失败：发送失败：SillyTavern 返回 error: true」类文案。

## 原因说明

1. **酒馆的约定**：生成接口在部分失败场景下仍返回 **HTTP 200**，响应 JSON 里带 **`error: true`**（有时没有 `message`），表示「本次生成未成功」，具体原因多在 **SillyTavern 服务端终端/日志**（上游 API、密钥、额度、模型名、网络等）。
2. **EU 的处理**：`requestAiReply` 解析到 `stData.error` 后走本地 llama 兜底；若关闭兜底（`EU_ALLOW_DIRECT_LLAMA_FALLBACK === false`），会 `throw new Error('发送失败：…')`。
3. **重复「发送失败：」**：故事书发送的 `catch` 里无条件再拼一层「发送失败：」，与内层已带前缀的 `Error.message` 叠在一起。

## 代码改动

- `formatStGenerateErrorDetail`：合并 `message` / `response` / `status` 等字段；对裸 `error: true` 给出可操作提示。
- `formatEuUserFacingSendFailure`：避免重复前缀。
- 构建戳：`20260508-046`。

路径：`public/eu-demo.html`。

## 用户侧建议

若仍失败：在 **SillyTavern 本机运行窗口**查看报错；在 EU 使用的同一套 **API 连接** 下于酒馆内直接发一条消息对比是否同样失败。
