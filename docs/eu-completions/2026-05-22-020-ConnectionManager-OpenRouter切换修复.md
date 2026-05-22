# Connection Manager OpenRouter 随配置切换修复

## 问题

切换「API 连接配置」列表时，**OpenRouter 模型**（及提供商等）不随配置变化；例如选中「GLM 5.1」（Custom）时，OpenRouter 下拉仍显示上一套的 DeepSeek V3。

## 根因

1. 快照写入 `oai_settings` 晚于 `chat_completion_source` 的 `change` → 异步 `saveModelList` 仍用**旧** `openrouter_model` 填充下拉。
2. 对 `<select>`（含 `#model_openrouter_select` / select2）用了 `trigger('input')`，应用模型无效，应使用 `change`。
3. 切换后未调用 `toggleChatCompletionForms()`，非 OpenRouter 配置时 OpenRouter 表单块仍可见。

## 改动

- `public/scripts/extensions/connection-manager/index.js`
  - `seedOaiSettingsFromSnapshot`：切换 API 源**之前**写入快照到 `oai_settings`。
  - `applyOpenRouterFieldsFromSnapshot`：等待模型列表后设置 OpenRouter 模型/提供商/量化等。
  - `applySnapshotField`：`<select>` 统一 `trigger('change')`。
  - 应用结束调用 `toggleChatCompletionForms()`。
- `public/scripts/openai.js`：导出 `toggleChatCompletionForms` 供扩展调用。

## 用户自测

1. 硬刷新 `http://127.0.0.1:8000/index.html`。
2. 对每条 **OpenRouter** 配置（如 DEEPSEEKV3、Euryale）：设好模型 → **连接** 或 **更新配置**（生成完整快照）。
3. 在 OpenRouter 与 Custom（GLM）等配置间切换：
   - 选 OpenRouter 配置时，OpenRouter 模型应变为该条保存的模型；
   - 选 Custom/GLM 时，OpenRouter 整块应隐藏，只显示 Custom 相关表单项。
