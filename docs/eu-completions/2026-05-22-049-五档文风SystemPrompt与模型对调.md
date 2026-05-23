# 五档文风 System Prompt 覆写与模型对调

## 任务

按产品描述重写了五档「深渊欲火」隐藏 System Prompt，并调整各文风对应的 Connection Manager 模型绑定；用户可见的文风切换文案不含模型名。

## 文风 ↔ 模型（仅后台，不对用户展示）

| 顺序 | 文风 | 酒馆配置名 | 来源 |
|------|------|------------|------|
| 1 | 现代风 | DEEPSEEKV3 | openrouter / deepseek-chat-v3 |
| 2 | 文学风 | Euryale 70B | openrouter / euryale-70b |
| 3 | 温柔风 | GLM5.1 | custom / 智谱 |
| 4 | 创意风 | GROK4.3 | xai / grok-4.3 |
| 5 | 重口风 | VENICE | custom / venice-uncensored-role-play |

**对调说明（相对旧版）**：文学风 ← 原 Grok；创意风 ← 原 Venice；重口风 ← 原 Euryale。

## 改动路径

- `public/eu.html`：`EU_WRITING_STYLE_PRESETS`（标签/简述/连接）、`EU_WRITING_STYLE_AGENT_SYSTEM`（全文覆写）、构建戳 `20260522-writing-style-agent-v130`

## 自测

1. 硬刷新 EU，build 含 **v130**。
2. 文风弹窗仅见风格名与简述，**不出现** Venice / Grok / GLM 等字样。
3. 五档各发一条，控制台 `dumpEuWritingStyleApiAudit()` 核对 `tavernModel` 与上表一致。
4. 创意风：未授权时不写元叙事/破第四面墙；重口风：仅在用户明确要求时加重口性癖库玩法。
