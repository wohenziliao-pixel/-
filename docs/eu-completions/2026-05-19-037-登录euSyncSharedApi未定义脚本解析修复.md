# 登录 euSyncSharedApiFromServer 未定义（脚本解析失败）

## 任务

本机 `http://127.0.0.1:8000/eu.html` 登录报：`登录失败：euSyncSharedApiFromServer is not defined`。

## 根因

`public/eu.html` 第 4 段 `<script>` 存在语法错误：`euPushConversationCloudNow` 内重复 `const convKey`，整段脚本未执行，其后定义的 `euSyncSharedApiFromServer` 不存在；`enterApp` 调用时报 ReferenceError。

## 改动

- 删除重复的 `const convKey` 声明。
- 修正误写入正则的 `motion` 标签名（改回 `div`）。
- 构建戳：`20260519-login-script-parse-fix-v88`。

## 自测

1. 强刷 `eu.html`（构建戳 v88）。
2. 登录应成功；控制台无 `is not defined`。
3. `node` 校验四段 script 均可 `new Function` 通过。

## 部署

仅 `public/eu.html`；服务器 pull 后重启 node。
