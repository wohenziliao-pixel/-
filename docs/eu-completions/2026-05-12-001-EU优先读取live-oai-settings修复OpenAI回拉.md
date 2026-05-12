# EU 优先读取 live oai_settings，修复 OpenAI 回拉

## 问题

用户确认酒馆界面一直使用 xAI/Grok，但 EU 仍报 `OpenAI API key is missing`。

现场数据核对结果：
- `data/wohenziliao/settings.json` 中 `oai_settings.chat_completion_source = "xai"`；
- `data/wohenziliao/OpenAI Settings/Default.json` 中 `chat_completion_source = "openai"`（旧值）。

EU 之前优先读取预设文件字段，导致被旧值回拉到 OpenAI。

## 修复

- `public/eu-demo.html`
  - `fetchStLiveGenerationProfile` 改为优先读取 `settings.json` 里的 `oai_settings` 作为 live 配置来源；
  - 连接相关字段合并时始终由 live settings 覆盖预设旧字段；
  - 保留 Grok 误配推断逻辑；
  - 更新 `EU_CLIENT_BUILD_STAMP`。

## 预期

即使 `OpenAI Settings/Default.json` 里还残留 `openai`，EU 也会按当前 live `oai_settings`（xAI）发请求，不再触发 OpenAI key 缺失错误。
