# 修复 server-main 缺失 euTiebaRouter 导入

## 问题

合并 `skipEuTiebaCsrf` 时误删 `import { router as euTiebaRouter } from './endpoints/eu-tieba.js'`，进程启动即 `ReferenceError: euTiebaRouter is not defined`，8000 端口无监听，浏览器 `ERR_CONNECTION_REFUSED`。

## 改动

- `src/server-main.js`：恢复 `euTiebaRouter` 与 `skipEuTiebaCsrf` 并列导入。

## 自测

执行 `node server.js` 应出现 `SillyTavern is listening`，`http://127.0.0.1:8000/eu-demo.html` 可打开。
