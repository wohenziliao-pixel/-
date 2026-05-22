# Connection Manager 隔离快照修复（切换不带入旧资料）

## 问题

用户反馈：切换「API 连接配置」时**上一套表单的资料会一起带进来**，不是干净切换到另一套已保存配置。

## 根因（更正）

1. **`bind_preset_to_connection` 默认为 true**：切换配置时会执行 `/preset`，把 **Default 等预设 JSON 里的连接字段**（API 源、OpenRouter 模型、提供商等）写回表单，与目标配置混在一起；即便之后再 `/api`，非当前源的模型/选项仍残留在 `oai_settings` 与界面上。
2. **原实现只保存少量 slash 字段**（api / model / preset 名等），未保存 `openrouter_providers`、`openrouter_allow_fallbacks` 等；切换时未覆盖的字段继续沿用上一套。
3. **连接成功即自动写回配置**（上一版）：在切换过程中若触发「有效」状态，可能把**未切换完成**的表单写入当前配置，加剧各条配置趋同。

## 改动

**文件**：`public/scripts/extensions/connection-manager/index.js`

1. **`connectionSnapshot`**：在「更新配置 / 新建配置 / 手动连接成功后保存」时，从 `settingsToUpdate` 中所有 `isConnection` 字段抓取完整快照写入 profile。
2. **切换时**：
   - **不再**走 `/api` → `/preset` → `/api` → `/model` 链（避免预设污染）；
   - 先应用辅助项（密钥 secret-id、代理等），再用快照**整体覆盖**连接相关 UI 与 `oai_settings`。
   - 无快照的旧配置：用 profile 内 `api` / `model` / `api-url` 拼最小快照；仍建议用户点一次「更新配置」补全。
3. **连接成功保存**：仅当用户**点击连接按钮**且随后状态变为有效时，才自动写回当前选中配置（切换下拉时不会误保存）。

## 用户必做（一次）

旧配置没有完整 `connectionSnapshot`，请对 **每条** API 连接配置：

1. 选中该条 → 把 API 源、模型、URL、OpenRouter 选项等设对；
2. 点 **连接** 至「有效」（会自动保存快照），或点 **更新配置**；
3. 再切换其它条验证互不串台。

然后 **硬刷新** 页面。

## 自测

- 配置 A：OpenRouter + DeepSeek；配置 B：Custom + GLM；来回切换，源与模型应各自独立，不应出现「选 GLM 仍显示 DeepSeek OpenRouter 模型」。
- 每条详情（i）中字段应与当前表单一致。
