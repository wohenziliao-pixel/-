# EU 研发日志（滚动）

> **用途**：按日记录功能、部署与踩坑，上线或开新对话前先翻最近一节。  
> **现行入口/部署口径**：`docs/EU-部署与入口说明.md`（端口 **8000**、`/eu.html`）。  
> **细项完成单**：`docs/eu-completions/YYYY-MM-DD-*.md`（每条任务单独文件）。

---

## 2026-05-19（周二）— 功能批量 + 准备同步网络版

### 当日构建戳（网络版下一批）

`EU_CLIENT_BUILD_STAMP` = **`20260519-myworld-vs-storybook-copy-v86`**

| 版本 | 内容 |
|------|------|
| v83 | 对话云同步 `/browser-state/conversations` |
| v84 | 开发者编辑已上架书：标签 + 成人开关 |
| v85 | 故事书库删除 + 云端 gen 防并集拉回 |
| v86 | 我的世界 vs 故事书文案区分 |

上一批已推：**`2ed2622`**（v82 商城取向等）。

### 已交付功能（摘要）

| 模块 | 内容 | 完成单 |
|------|------|--------|
| 虚拟恋人 | 「我的世界」下 ♥ 抽屉；仅商城 `character`；简介页 / 加入列表 / 独立对话模式 `virtual-lover` | `020`、`022` |
| 登录修复 | `openMallDetail` 内重复 `const detailCtx` 导致第二段 script 未执行 → `euSyncSharedApiFromServer is not defined` | `021` |
| 开发者 | 「清理幽灵故事书」改为「转换分区 ▾」批量改类型（故事书/设定集/角色卡） | `023` |
| 故事书开场 | 过滤分享说明/CC 类前言；无有效开场时隐藏发「开始」、首条可见为 AI 叙事 | `024` |
| 商城取向 | 男性向/女性向筛选（无「女性向」标签归男性向）；服务端 `orientation=`；与全年龄 `sfw=1` 叠加 | `025` |
| 商城 UI | 取向钮：覆盖全局 `button{width:100%}`；类型条独立一行，下方 ♂/♀ 小图标钮；去掉导出 JSON/CSV、去掉「每页10条…」提示行 | `026`–`028` |
| **线上对话历史** | 大 browser-state partial 漏对话键 + 关页来不及 push → 专用 `/browser-state/conversations` + 650ms/keepalive 推送 | `031` |
| 开发者编辑已上架 | 公共条目弹窗恢复标签/成人开关；`PUT` 可改回全年龄 | `032` |
| 故事书删除 | 删库后云端并集拉回；pinned 清理；删后立即 push | `033` |
| 文案 | 我的世界=历史会话；故事书=藏书库 | `034` |
| 字控/分段等 | 进会话字控、简介分段、字号等（同日其它条目） | `015`–`019` 等 |

### 关键改动文件（v83–v86 须一并上线）

```
public/eu.html
src/endpoints/eu-browser-state.js       # GET/POST /api/eu/browser-state/conversations
src/endpoints/eu-mall-resources.js      # orientation；adultContent 可改回 false
```

灌水吧、虚拟恋人、开场白等逻辑均在 `eu.html`；**对话云同步、开发者改上架书、故事书删库** 须前端 + 对应 endpoint **同时 pull 并重启**。

### 本机数据快照（同步前核对）

| 路径 | 本机约数 | 说明 |
|------|----------|------|
| `data/eu-public/mall/resources/*.json` | **642** | 线上上次约 **626**，差约 16 本需 SFTP 合并 |
| `data/eu-public/mall/thumbs/` | **642** | 与 resources 成对上传 |
| `data/eu-tieba-board.json` | 单文件 | **不进 Git**；灌水吧全站共用，换机/线上要单独拷 |

### 代码已推送 Git

- 提交：**`2ed2622`** — `EU: 5/19 virtual lover, mall orientation filter, opening and dev tools (v82)`
- 远程：`main` @ `github.com/wohenziliao-pixel/-.git`
- 含：`public/eu.html`、`src/endpoints/eu-mall-resources.js`

### 网络版同步标准流程（稳妥版）

**顺序不要反：代码 → 书库文件 → 重建索引 → 验收**

1. **本机**  
   - 打开 `http://127.0.0.1:8000/eu.html`，确认构建戳 **v82**。  
   - 商城 ♂/♀、虚拟恋人、登录无报错。

2. **Git（仅代码，v83–v86）**  
   ```bash
   git add public/eu.html src/endpoints/eu-browser-state.js src/endpoints/eu-mall-resources.js
   git commit -m "EU: v86 conversation cloud, dev edit, storybook delete, copy"
   git push origin main
   ```  
   **勿提交** `tools/eu-mall-batch.config.json`（含密码）。

3. **服务器**（路径示例 `/opt/SillyTavern`）  
   ```bash
   cd /opt/SillyTavern
   git pull origin main
   pm2 restart all   # 或等价重启
   grep -o "20260519-[a-z0-9-]*-v[0-9]*" public/eu.html | head -1   # 应含 myworld-vs-storybook-copy-v86
   curl -sI https://st.ciyuanji.shop/eu.html | head -3
   ```

4. **书库 SFTP（WinSCP 推荐）**  
   - 本机：`...\data\eu-public\mall\resources` → 服务器：`.../data/eu-public/mall/resources`  
   - 本机：`...\data\eu-public\mall\thumbs` → 服务器：`.../data/eu-public/mall/thumbs`  
   - 模式：**本地 → 远程**，**仅较新文件**，**不要**「删除远程多余文件」。  
   - **不要**整包覆盖 `data/`、**不要**用本机 `data/_storage/` 盖线上。

5. **服务器重建索引（必做，否则列表仍显示旧条数）**  
   ```bash
   cd /opt/SillyTavern
   ls data/eu-public/mall/resources/*.json | wc -l    # 目标约 642
   node tools/eu-mall-rebuild-index.mjs               # 应：已写入索引 642 条
   pm2 restart all
   ```

6. **验收**  
   - `https://st.ciyuanji.shop/eu.html` 无痕，控制台构建戳 **v86**。  
   - 商城「共 N 条」≈ **642**；♂/♀、全年龄筛选正常。  
   - 换浏览器登录同账号：对话历史仍在（`/api/eu/browser-state/conversations`）。  
   - 开发者模式改**已上架**书：弹窗有标签与成人开关；18+ 可改回全年龄。  
   - 故事书页垃圾桶删书后刷新不再出现；侧栏 × 仅删会话（文案已区分）。

### 当日踩坑清单（避免重犯）

| 现象 | 根因 | 处理 |
|------|------|------|
| 男性向/女性向拉满整行、紫色大按钮 | 全局 `button { width: 100% }` + 默认渐变 | `.mall-orientation-btn` 加 `width: auto !important` 等覆盖 |
| 改了样式线上不变 | 未 commit/push 或浏览器缓存 | push + 服务器 pull 重启 + Ctrl+F5 |
| 取向筛选无效 | 只上了 `eu.html` 未上 `eu-mall-resources.js` 或未重启 | 两端一起部署并重启 node |
| pull 后商城仍 626 本 | 只更代码未传 `mall/resources` 或未 `rebuild-index` | SFTP 合并 + `eu-mall-rebuild-index.mjs` |
| 登录报 `euSyncSharedApiFromServer is not defined` | `eu.html` 第二段 script 前有语法错误（重复 `const`） | 修解析错误；两 script 块顺序执行 |
| 误覆盖线上用户 | 用本机整个 `data/` 上传 | **只**拷 `eu-public/mall` 子目录 |
| 启动 500 `writeFileAtomicSync` | `eu-shared-api.js` 导入方式 | `import { sync as writeFileAtomicSync } from 'write-file-atomic'`（见 5/18-010） |
| 新用户 OpenAI key 报错 | 服务器未配 `euSharedApiFromHandle` | `config.yaml` 设 `wohenziliao`；或 `node tools/eu-shared-api-sync-all.mjs` |
| 配图别人看不见 | 正文里 `http://127.0.0.1:.../api/eu/tieba/media/...` | 服务端会规范为 `/api/eu/tieba/media/...`；配图须走上传接口进 `eu-tieba-media` |

### 灌水吧（跨账号）说明

- 数据：**单文件** `DATA_ROOT/eu-tieba-board.json`，同服务器上**所有登录账号看同一份列表**。  
- 发帖/回复：须登录（酒馆 Cookie 或 `POST /api/eu/tieba/auth/session` 令牌）。  
- 展示名：`authorHandle` + `authorDisplayName`；列表会按用户库 `User.name` 补全昵称（见 `2026-05-13-003`）。  
- **本机贴的帖不会自动出现在线上**，除非把服务器上的 `eu-tieba-board.json`（及 `eu-tieba-media/`、`eu-tieba-avatars/`）一并同步。  
- 列表/配图 GET **不要求登录**（挂在 `requireLogin` 之前），便于未登录浏览。

### 新对话快捷开场白

```
请先读 docs/EU-研发日志.md（最近一节）、docs/EU-部署与入口说明.md。

我要继续 EU：<具体任务>。当前构建戳 v82，本机商城 642 本，代码已 push 2ed2622（或说明线上进度）。
```

---

## 历史索引

| 日期 | 说明 |
|------|------|
| 2026-05-16 | 正式 `eu.html`、商城分页、部署 626 本、文档 065/066 → 见 `eu-completions/2026-05-16-*` |
| 2026-05-17~18 | 根路径重定向、新用户共用 xAI、底栏精简 → `006`、`010`、`011`；提交至 `51d8149` 一带 |
| 2026-05-15 | 开发日记交接模板 → `2026-05-15-009-新窗口交接-开发日记与工作进程.md` |

---

*下一日请在本文顶部「---」之上新增一节，保留本日条目勿删。*
