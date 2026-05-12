# Grok 误配为 OpenAI 来源 → EU 推断为 xAI

## 现象

发送失败：`SillyTavern 400: OpenAI API key is missing.`  
用户实际使用 Grok，但酒馆 Chat Completion 预设里 **来源仍为 `openai`**（常见于切换界面或导入预设后未改下拉），酒馆按 OpenAI 分支校验密钥。

## 处理

- `public/eu-demo.html`  
  - `inferChatCompletionSourceForGrok`：若当前来源为 `openai`，且预设中 `xai_model` 或 `openai_model` 形如 Grok（`grok…`），则将 **`chat_completion_source` 视为 `xai`** 再解析模型、组 payload。  
  - 若纠正为 xAI 后 `resolveStPresetModel` 仍为空，但 `openai_model` 已是 Grok，则用该字符串作为模型 id。  
  - 更新 `EU_CLIENT_BUILD_STAMP`。

## 仍需用户在酒馆配置

xAI 密钥须在 SillyTavern **API 连接 → xAI**（或密钥管理）中保存；EU 只修正来源字段，不能代替密钥。

若纠正后提示变为 **`xAI API key is missing`**，请在酒馆填写 xAI API Key 并保存。
