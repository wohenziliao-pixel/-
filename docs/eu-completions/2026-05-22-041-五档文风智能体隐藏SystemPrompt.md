# 五档文风智能体隐藏 System Prompt（深渊欲火）

## 任务

为五条文风对应智能体写入酒馆级强命令 System Prompt，藏在后台注入 generate，**用户界面不可见**，防止被复制；与弹窗内可见的轻量「文风」提示分离。

## 映射

| EU 文风 | 酒馆连接 | 智能体原文 |
|---------|----------|------------|
| 现代风 `modern` | DEEPSEEKV3 | DeepSeek V3 |
| 文学风 `literary` | GROK4.3 | Grok 4.3 |
| 创意风 `creative` | VENICE | Venice |
| 温柔风 `gentle` | GLM5.1 | GLM5.1 |
| 重口风 `explicit` | Euryale 70B | Euryale 70B |

## 实现

- `EU_WRITING_STYLE_AGENT_SYSTEM`：五段完整原文（用户提供的「深渊欲火」铁律）。
- `buildWritingStyleAgentSystemMessage()`：`identifier: euWritingStyleAgent`，在 `buildBudgetedMessages` 的 `EU_ST_NATIVE_CHAT_STACK` 分支中，先于可见的 `euWritingStyle` 注入。
- `buildWritingStyleSystemMessage()`：仅保留用户可见的短文风条，不再重复拼接强命令正文。

构建戳：`20260522-writing-style-agent-system-v123`

## 改动路径

- `public/eu.html`
- `docs/eu-completions/2026-05-22-041-五档文风智能体隐藏SystemPrompt.md`

## 自测

1. 强刷 `eu.html`，build 为 `v123`。
2. 开发者 F12 → Network → `generate` 请求体 `messages` 中应含 `role:system` 且内容含「深渊欲火」铁律（**普通用户界面不展示该段**）。
3. 切换五档文风各发一条，对应 system 正文应随 `writingStyleId` 变化。
4. 文风弹窗/Toast 仍只显示「现代风」等短描述，不出现完整铁律原文。
