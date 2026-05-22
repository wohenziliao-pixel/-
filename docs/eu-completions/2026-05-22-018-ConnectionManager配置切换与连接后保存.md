# Connection Manager 配置切换与连接后保存

## 任务

用户反馈：在 API 设置里切换「API 连接配置」下拉时，下方表单（OpenRouter 模型、API 源等）不随已保存的配置切换，仍显示上一套，导致文风/模型混乱。

期望行为：

1. **下拉切换**：加载该配置快照中的 API、预设、URL、模型等到表单。
2. **连接成功**：把当前表单写回当前选中的配置快照，便于随时切换复用。

## 根因

`public/scripts/extensions/connection-manager/index.js` 的 `applyConnectionProfile` 按顺序执行 `/api`、`/preset`、`/model` 等 slash 命令，但：

- 切换 API 后会异步拉取模型列表；
- `/model` 在列表未就绪时执行，常匹配失败或匹配到旧源下的选项；
- 界面仍显示上一套的 OpenRouter 模型等（与用户截图「选 GLM 5.1 仍显示 DeepSeek V3」一致）。

另：配置快照仅在用户点「更新配置」时写入；连接成功不会自动保存，快照易与当前表单脱节。

## 改动

**文件**：`public/scripts/extensions/connection-manager/index.js`

1. **应用顺序加固**
   - 先执行除 `model` 外的命令；在 `api` / `preset` / `api-url` 后等待 `online_status !== 'no_connection'`。
   - 在 `api` 后等待当前活动 API 的模型控件就绪（下拉有选项或 custom 输入框可用）。
   - **最后**再执行 `model`，并 `saveSettingsDebounced()`。

2. **连接成功后自动更新快照**
   - 监听 `ONLINE_STATUS_CHANGED`（非 `no_connection` 且非正在应用配置时）。
   - 若已选中某条配置，防抖 400ms 后调用 `updateConnectionProfile`，把当前表单写入该条快照。

3. **应用过程防重入**
   - `isApplyingConnectionProfile` 标志，避免应用配置时触发自动更新造成竞态。

## 用户自测

1. 重启或硬刷新 `http://127.0.0.1:8000/`（或 `eu.html` 内嵌酒馆设置页），确保加载新脚本。
2. 打开 **API 连接** → 对每条配置（如 GLM 5.1、GROK4.3）：
   - 手动设好 API 源、模型、密钥 → 点 **连接** 至状态「有效」→ 应自动写入该条快照（可看详情「i」图标字段是否更新）。
3. 在下拉中依次切换各配置，确认：
   - OpenRouter / Custom / xAI 等 **源** 与 **模型** 随配置变化，不再卡在上一套。
4. 若某条历史快照本身存错（此前未点过更新），需对该条重新设表单 → 连接成功一次，或点 **更新配置** 修正后再切换验证。

## 说明

- 本修复在酒馆 **Connection Manager 扩展** 层，与 `eu.html` 文风五档硬编码 API 映射独立；两者可同时使用。
- 旧快照若 api/model 字段本身错误，切换后会忠实加载错误快照；需按上一步重新保存各条。
