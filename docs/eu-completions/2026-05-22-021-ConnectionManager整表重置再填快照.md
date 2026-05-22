# Connection Manager 整表重置再填快照

## 问题

用户反馈切换「API 连接配置」后仍有旧表单项残留（例如选 DEEPSEEKV3 / OpenRouter 时，仍显示上一套 Custom 的智谱 URL、`glm-4-1` 等）。不能只在旧表单上「补几项」，需要**用已储存数据整表填入**。

## 根因

此前逻辑是 **partial merge**：只把快照里有的字段写到表单，**未出现在快照里的连接字段**（如 `custom_url`、`custom_model`）继续保留上一套配置的值；再叠加切换来源时 `reconnectOpenAi()` 中途连接，界面更易串台。

## 改动

### `public/scripts/openai.js`

- `getOpenAIConnectionDefaults()`：导出所有「连接相关」字段的默认值。
- `setChatCompletionSourceQuiet()`：切换来源时**不**自动 `reconnectOpenAi`。
- `reconnectOpenAi` 改为导出；`#chat_completion_source` 的 change 在 `source === 'connection_profile'` 时跳过自动连接。

### `public/scripts/extensions/connection-manager/index.js`

切换配置时顺序改为：

1. **整表清空**：所有连接字段先恢复默认（含 `custom_url`、`custom_model` 等置空）。
2. **整表填入**：`fullState = { ...defaults, ...profile.connectionSnapshot }` 写入 `oai_settings` 与全部对应控件。
3. **安静切换来源** → 刷新显隐 → **末尾只连接一次** → 再写 OpenRouter 模型/提供商等。

保存配置时仍用完整 `connectionSnapshot`（与「更新配置」/ 手动连接成功后写入一致）。

## 用户必做

旧条目若无 `connectionSnapshot`，请对**每条**配置重新：

**设对 → 点「更新配置」或「连接」成功** → 硬刷新 → 再切换验证。

## 自测

- DEEPSEEKV3：应只见 OpenRouter 相关项，不应再挂智谱 Custom URL / glm 模型名。
- GLM 5.1：应只见 Custom 项，OpenRouter 区域应隐藏。
