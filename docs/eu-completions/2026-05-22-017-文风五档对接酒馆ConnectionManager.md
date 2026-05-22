# 文风五档对接酒馆 Connection Manager

## 任务

用户在酒馆 Connection Manager 配置了 5 条 API，要求 EU「文风转换」切换时与之一一对应。

## 本机核查（`data/wohenziliao/settings.json` → `extension_settings.connectionManager.profiles`）

| 酒馆 profile 显示名 | 实际 api | 实际 model | 实际 api-url |
|---------------------|----------|------------|--------------|
| DEEPSEEKV3 | xai | grok-4.3 | — |
| Euryale 70B | custom | GLM-5.1 | open.bigmodel.cn |
| GLM 5.1 | custom | venice-uncensored | api.venice.ai |
| GROK4.3 | openrouter | deepseek/deepseek-chat-v3-0324 | — |
| VENICE | openrouter | deepseek/deepseek-chat-v3-0324 | — |

**说明**：酒馆里的 **profile 名称** 与真实后端不一致（例如名叫 DEEPSEEKV3 实际是 Grok）。EU 按 **真实 api/model/url** 绑定，不按混乱的 profile 名。

## EU 文风 → 用户意图 → 技术绑定

| EU 文风 | 用户说的模型 | EU `stChatSource` | EU `stModel` | 对齐的酒馆 profile（按真实后端） |
|---------|--------------|-------------------|--------------|----------------------------------|
| 现代风 | DEEPSEEK V3 | openrouter | deepseek/deepseek-chat-v3-0324 | GROK4.3 / VENICE（实为 DeepSeek） |
| 文学风 | GROK 4.3 | xai | grok-4.3 | DEEPSEEKV3（名为 DeepSeek 实为 Grok） |
| 温柔风 | GLM 5.1 | custom | GLM-5.1 | Euryale 70B（名为 Euryale 实为 GLM） |
| 创意风 | Venice | custom | venice-uncensored | GLM 5.1（名为 GLM 实为 Venice） |
| 重口风 | Euryale | openrouter | sao10k/l3.1-euryale-70b | `oai_settings.openrouter_model`（无单独 profile） |

`resolveEuLiveProfileForGeneration`：OpenRouter / xAI / custom（含 `customUrl`）均写入 live profile。

## 改动

- `public/eu.html`（`20260522-writing-style-tavern-conn-v114`）

## 自测

1. 强刷 `eu.html`，`dumpEuWritingStyleApiAudit()` 看五档 `stChatSource`/`stModel`/`customUrl`。
2. 逐档切换文风发消息，Network `generate` 中 `chat_completion_source` 与 `model`（custom 时还有 `custom_url`）应随表变化。
3. 开发者模式弹窗可见 `· 酒馆[显示名]` 便于与 Connection Manager 对照。
