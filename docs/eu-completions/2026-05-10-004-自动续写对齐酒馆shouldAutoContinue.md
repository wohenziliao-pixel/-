# 故事书自动续写对齐酒馆 `shouldAutoContinue`

## 目标

与 `public/script.js` 一致：`target_length` 与**当前整条 AI 消息（合并后）**的 token 数比较；**不**用目标改写单轮 `max_tokens`。

## 行为摘要

- 移除 `applyStorybookTargetMaxTokensToStPayload`（此前用目标压单轮 max_tokens，与酒馆不符）。
- `shouldAutoContinueReply(fullMergedReply, depth)`：`estimateTokenCount(fullMergedReply) < targetTokens` 且正文 trim 长度 > 5、`depth < 2`、开关与「允许聊天补全」同酒馆。
- `requestAiReply`：通过 `autoContinueAccumulated` 维护多段合并后的全文；续写请求的 `history` 末条 assistant 使用**已合并全文**；子调用返回的 `reply` 已是全文，不再与外层片段二次 `mergeContinuationReply`。
- 流式首轮后的续写判断去掉 `looksReplyIncomplete` / 单轮 completion 等 EU 扩展，仅保留与酒馆一致的 token 门槛。

## 路径

- `public/eu-demo.html`（`EU_CLIENT_BUILD_STAMP = 20260508-050`）

## 与酒馆差异说明

- 酒馆用 `getTokenCount`，EU 用 `estimateTokenCount`，数值可能略有偏差。
