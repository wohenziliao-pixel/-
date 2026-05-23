# EU 研发日志（滚动）

> **用途**：按日记录功能、部署与踩坑，上线或开新对话前先翻最近一节。  
> **成册总查阅**：**[`docs/EU-开发手册.md`](EU-开发手册.md)**（架构、踩坑百科、模块索引、全量完成单链接）。  
> **现行入口/部署口径**：`docs/EU-部署与入口说明.md`（端口 **8000**、`/eu.html`）。  
> **细项完成单**：`docs/eu-completions/YYYY-MM-DD-*.md`（每条任务单独文件）；全量文件名见 `eu-completions/000-完成单全量索引.md`。

---

## 2026-05-22（夜）— 文风 v131～v133 网络版待发

### 构建戳

`EU_CLIENT_BUILD_STAMP` = **`20260522-writing-style-toggle-inrow-v133`**

### 主题

| 主题 | 要点 | 完成单 |
|------|------|--------|
| 全年龄/18+ 每档切换 | `EU_WRITING_STYLE_AGENT_SYSTEM_SFW` vs 完整 System | `050` |
| 五档 18+ System 终稿 | 现代/文学/温柔/创意/重口覆写 | `051` |
| 弹窗 UI | 切换钮在卡片内、compact 尺寸 | `052` |
| 网络版同步 | 本机 push → 服务器 pull + Ctrl+F5 | `053`、`054` |

上传前执行：`docs/eu-completions/2026-05-22-053-网络版v133同步指令.md`

---

## 2026-05-22（晚）— 文风五档 API、Connection Manager、16K/2048、网络版整理

### 当日构建戳（EU，现行）

`EU_CLIENT_BUILD_STAMP` = **`20260522-continue-regen-use-live-max-tokens-v117`**

（午后曾 `v109` 续写；晚间叠加文风/连接/上下文/单轮 token。）

### 主题摘要

| 主题 | 要点 | 完成单 |
|------|------|--------|
| Connection Manager | 切换整表重置、保存配置、先连通再存模型、OpenRouter 第三项 | `018`～`027` |
| 文风 ↔ 五条 API | DEEPSEEKV3 / GROK4.3 / GLM5.1 / VENICE / Euryale 70B | `017`、`028` |
| 16K 上下文 + 2048 单轮 | EU runtime 16383；去掉 2000 cap；8192 localStorage 迁移 | `031` |
| 乱码 / 简体中文 | 塌缩检测、改写写回、重口风约束 | `029`、`030` |
| 续写/重写 token | 统一 `euApplyLiveProfileMaxTokens`，不用字控 ~560 | `032` |
| **网络版上线** | 总清单文档 | `docs/EU-网络版上线整理-2026-05-22.md` |

### 上传前必读

1. `docs/EU-网络版上线整理-2026-05-22.md`
2. `docs/EU-部署与入口说明.md`
3. `docs/EU-开发手册.md` §四 踩坑百科

---

## 2026-05-22（周四）— 三窗口总归档 + EU 续写 v108→v109

### 当日构建戳（EU，午后）

`EU_CLIENT_BUILD_STAMP` = **`20260522-manual-continue-fix-v109`**

### 文档

- **三窗口总归档（新同事必读）**：`docs/EU-三窗口开发总归档-2026-05-20至22.md`
- 续写交接更新：`docs/eu-completions/2026-05-22-009-新窗口交接-续写开发与待办.md`
- 完成单：`2026-05-22-001`～`010`（酒馆回退、tokenizers、续写系列）

### 窗口 C（续写，仅 eu.html）

| 戳 | 要点 |
|----|------|
| v108 | 手动续写与字控分离、结尾摘录进 user、history 不重复 assistant |
| **v109** | SSE 尾包 flush；手动续写减 system；流式 rawChunkDisplay；预设 allowStale |

### 窗口 B（酒馆 index，勿再乱改）

- 黑屏：`eventSource` 重复 import（`015`）→ 多次回退 `public/`（`031`、`001`）
- Token 红条：checkout 撤掉 xAI tokenizers → **`2026-05-22-002`** 仅恢复 `tokenizers.js` 兜底

### 新对话开场白

```
请先读 docs/EU-三窗口开发总归档-2026-05-20至22.md
任务：<具体需求>
```

---

## 2026-05-21（周三）— 酒馆 index.html 连接 / 发送 / 遮罩（31 篇完成单）

### 主题

原版 SillyTavern UI（`/index.html`）与 EU **分离**；本会话大量改动后**多轮回退**至 HEAD，仅保留必要兜底。

### 典型问题

| 现象 | 完成单方向 |
|------|------------|
| 整页黑屏 | `015` eventSource 重复 import |
| 按钮无反应 / 遮罩挡点击 | `030`、`031` 回退 |
| Token 计数红条、发送中断 | `003`、`002`（5/22 恢复 tokenizers） |
| 未连接仍写入 / 发送锁死 | `012`～`027` 系列（多数已回退） |
| 8000 未启动初始化卡住 | `023` |

### 注意

- **不要**在未授权下再改 `script.js` 发送链；EU 功能在 `eu.html`
- 细项见 `docs/eu-completions/2026-05-21-001` … `031`

---

## 2026-05-20（周二）— 「我的世界」聊天历史 / 对话云闭环（v90→v99）

### 当日构建戳

`EU_CLIENT_BUILD_STAMP` = **`20260520-conversation-keep-user-msgs-v99`**

**汇总文档（踩坑 + 开发日志全文）**：`docs/eu-completions/2026-05-20-008-聊天历史踩坑与开发日志汇总.md`

### 问题定义

- **要保留**：侧栏「我的世界」→ 已打开的故事书对话里，**用户/AI 往来气泡**（`eu_demo_conversations_<handle>` 内 `messages[]`）。
- **不是**：故事书藏书库；也不是页面上仅显示的故事**开场白/设定正文**（易误判为「有内容」）。

### 根因链（最终口径）

1. **云端**：机制存在（`GET/POST /api/eu/browser-state/conversations` → `data/<handle>/eu-mall-browser-state.json`）；曾长期 **clearedAt 锁 / push skipped / 未 push 到磁盘**。  
2. **重开 v98**：`openWorldChat` → `ensureConversationForCharacter` 新建**空 conv** 盖住有消息的 key。  
3. **重开 v99（主因）**：`shouldResetOpening` 用开场白**替换整段 messages**，**删除用户句**（如「发生了什么」）。  
4. **部署**：代码已 v99 但 **Node 旧进程（如 7010）未杀**，浏览器未 Ctrl+F5。  
5. **无关**：本机酒馆/IP 程序；`/api/eu/dev/deactivate` 403；xAI 额度只影响 AI 回复。

**「重开浏览器」**：同配置重开**不必然**清空 LS；但**会触发恢复逻辑**，上述 bug 在恢复时暴露——用户追问「是否新窗口」**方向对**，勿再答复「与重开无关」。

### 版本与 Git（main，节选）

| 戳 | 要点 | 完成单 |
|----|------|--------|
| v91–v92 | 清空权威、mall 不夹带对话 | `041`、`042` |
| v93–v94 | 清锁后新会话可写；push 校验 savedKeys | `001`、`002` |
| v95 | resume 补全；服务端 conv+sess 放行 | `003` |
| v96–v97 | 调试函数；pull/load 顺序 | `004`、`005` |
| v98 | 勿新建空 conv | `006` |
| **v99** | **开场白重置保留 user 消息** | `007` |

提交链：`2027886` → `519631a` → `276f5ee` → `d573f93` → `9d66b3c` → **`7d0b4a1`（v99）**

### 关键文件

```
public/eu.html                          # 对话云 pull/push、openWorldChat、v99 保留 user
src/endpoints/eu-browser-state.js       # /conversations、clearedAt 锁
tools/eu-conversation-cloud-check.mjs   # 服务器验收
tools/eu-conversation-save-v94-test.mjs
```

### 服务器部署（/opt/SillyTavern，已踩坑）

```bash
git pull
grep EU_CLIENT_BUILD_STAMP public/eu.html | head -1   # keep-user-msgs-v99
ps aux | grep node
kill <旧PID>              # 勿写 kill <PID>kill <7010>；7010 曾为旧进程
sleep 2
nohup node server.js > /tmp/st.log 2>&1 &
node tools/eu-conversation-cloud-check.mjs wohenziliao
```

浏览器：**Ctrl+F5**；Console `client build` 含 **v99**。

### 验收（已通过一例）

- `await euDebugConversationCloud()`：`serverBytes` ≈ `localBytes` ≈ 3923，`serverClearedAt: 0`。  
- 关浏览器再开：自动进对话，**用户气泡仍在**（v99 后用户确认「可以了」）。

### 当日踩坑清单

| 现象 | 根因 | 处理 |
|------|------|------|
| 像纯本地、外部称无云端 | 写入失败 + 打开时删消息；迁移页文案误导 | `serverBytes` 反证；主站有 `/conversations` |
| push ok 仍丢 | conversations 未 saved / 开场白重置删 user | v94、**v99** |
| skipped keys 三键 | clearedAt + resume 不合格 | v95 |
| 自动进对话但空 | 空 conv / 只渲染开场白 | v98、**v99** |
| pull 有 v99 行为旧 | 旧 node 未重启 | kill 旧 PID 再启动 |
| 两个 node server.js | 未杀旧进程又 nohup | 只留一个新 PID |
| 发消息 AI 不回 | xAI credits 用尽 | 充值/自备 Key；user 句仍可写入 |
| Console 诊断报错 | 脚本未包在 `(()=>{})()` 或变量笔误 | 用汇总文档 §7 命令 |
| 曾说「重开不是原因」 | 表述过绝 | 见上「重开浏览器」口径 |

### 新对话快捷开场白

```
请先读 docs/eu-completions/2026-05-20-008-聊天历史踩坑与开发日志汇总.md
与 docs/EU-研发日志.md（2026-05-20 节）。

线上 v99 已验收聊天历史；任务：<具体需求>。
```

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
| **2026-05-20** | **聊天历史对话云 v90→v99 汇总** → `2026-05-20-008-聊天历史踩坑与开发日志汇总.md` |
| 2026-05-19 | 对话云 v83+、虚拟恋人、商城取向、文案区分 → `eu-completions/2026-05-19-*`；本节见上 |
| 2026-05-16 | 正式 `eu.html`、商城分页、部署 626 本、文档 065/066 → 见 `eu-completions/2026-05-16-*` |
| 2026-05-17~18 | 根路径重定向、新用户共用 xAI、底栏精简 → `006`、`010`、`011`；提交至 `51d8149` 一带 |
| **2026-05-22** | **三窗口总归档** → `docs/EU-三窗口开发总归档-2026-05-20至22.md`；续写 v109 |
| 2026-05-21 | 酒馆 index 黑屏/发送/Token → `eu-completions/2026-05-21-*` |
| 2026-05-15 | 开发日记交接模板 → `2026-05-15-009-新窗口交接-开发日记与工作进程.md` |

---

*下一日请在本文顶部「---」之上新增一节，保留本日条目勿删。*
