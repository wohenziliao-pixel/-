# 共用 API 同步 Connection Manager 五连接

## 现象

仅站长账号可对话；其他用户（如 lynn0426）现代风报「当前文风暂时不可用」。非站长密令失效，而是共用 API 未带全连接配置。

## 根因

- `config.euSharedApiFromHandle` 的 `applyEuSharedApiProfile` 只复制 `secrets.json`、预设与 `oai_settings`。
- EU v125+ 文风按 **Connection Manager 每条连接的 `secret-id`** 轮换密钥（现代/文学风 OpenRouter 必需）。
- 新用户注册后已有 `settings.json` 时，**不会**合并 `extension_settings.connectionManager.profiles`，故缺 DEEPSEEKV3 / Euryale 70B 等绑定。
- 站长本机曾 SCP 完整 `settings.json`，故仅站长正常。

## 改动

- `src/endpoints/eu-shared-api.js`：`mergeConnectionManagerFromSource`，套用共用 API 时同步五条连接 profile。

## 服务器操作（必做）

1. `config.yaml` 确认：
   ```yaml
   enableUserAccounts: true
   euSharedApiFromHandle: wohenziliao
   ```
2. 部署新 `eu-shared-api.js` 后 **重启 Node**。
3. 一次性为老用户补全：
   ```bash
   cd /opt/SillyTavern
   node tools/eu-shared-api-sync-all.mjs
   ```
4. 抽查：
   ```bash
   node tools/eu-audit-writing-style-apis.mjs lynn0426
   ```

## 自测

新注册账号选现代风可发消息；老用户在 sync-all 后同上。
