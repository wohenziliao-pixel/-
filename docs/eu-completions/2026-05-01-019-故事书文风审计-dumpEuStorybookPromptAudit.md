# 2026-05-01-019 故事书文风审计 dumpEuStorybookPromptAudit

## 背景
- 用户体感 EU 与酒馆同题材文风不一致，怀疑「污染」或串到旧书（如爱可丝）；需可复现排查手段。

## 代码侧结论
- `public/eu-demo.html` 内全文检索无「爱可丝」等硬编码书名；差异主要来自 EU 固定叙事 system、`buildCompactStorybookDirective`、用户「新增规则」、乱入/设定集、以及当前卡 `first_mes` 是否与酒馆导入为同一文件。

## 改动
- 新增 `dumpEuStorybookPromptAudit(seedUserText?)`：输出 `activeStorybookUid`、会话 metadata 一致性、`first_mes` 长度/哈希/预览、压缩 directive 预览、规则条数、乱入/全局设定/正则附加 system、ST resource 标题等。
- 挂到 `window.dumpEuStorybookPromptAudit`；`runEuStAlignmentSelfCheck` 的 `consoleHint` 增加该入口。

## 用法
- 打开目标故事书世界聊天后，控制台：`dumpEuStorybookPromptAudit()`  
- 与酒馆对照：将同卡 `first_mes` 做相同长度哈希或 diff；若哈希不同则不是同一卡或不同版本。
