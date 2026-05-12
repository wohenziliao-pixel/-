# EU generate：`user_name` 对齐用户画像（`{{user}}` 宏）

## 问题

用户在 EU「用户画像」中填写名称（如「朔风」），但故事正文里仍出现字面量 `{{user}}` 或宏被替换成登录名 `demo_user`，与预期不符。

## 原因

酒馆在组装/转发请求时用 `request.body.user_name` 参与宏替换（与主界面一致）。EU 此前固定把 `user_name` 设为 **`state.currentUser`（登录 handle）**，未使用 EU 本地「用户画像」的 **名称** 字段。

## 改动

- `public/eu-demo.html`：新增 `getStEffectiveUserNameForMacros()`（优先当前激活画像 `name`，否则登录名，否则 `user`），`buildStGeneratePayload` 中 `user_name` 改为该值。
- 更新 `EU_CLIENT_BUILD_STAMP`。

## 说明（边界）

- 宏替换主要由 **酒馆在发上游前** 处理；模型仍有可能在回复里**照抄** `{{user}}` 字样，与 `user_name` 无关。
- 已生成的旧气泡不会自动改写；新一条对话生效。
