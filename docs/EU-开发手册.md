# EU 开发与踩坑手册（成册）

> **用途**：进一步开发、排错、上线前的**总查阅入口**。  
> **维护约定**：可交付任务仍写 `docs/eu-completions/YYYY-MM-DD-序号-标题.md`；按日摘要写 `docs/EU-研发日志.md`；本册只做**归纳与索引**（重大变更时改对应章节）。

---

## 零、文档体系（读哪一本）

| 层级 | 文件 | 何时读 |
|------|------|--------|
| **本册** | `docs/EU-开发手册.md` | 新功能设计、踩坑检索、架构/数据口径 |
| **滚动日志** | `docs/EU-研发日志.md` | 最近几天做了什么、当日 Git/部署步骤 |
| **任务完成单** | `docs/eu-completions/*.md`（约 300 篇） | 某一改动的细节、自测项、根因 |
| **全量文件名索引** | `docs/eu-completions/000-完成单全量索引.md` | 按年月扫文件名 |
| **部署口径** | `docs/EU-部署与入口说明.md` | 端口、入口、SFTP、权限（**8017 已废弃**） |
| **架构备忘** | `docs/eu-playbook-architecture-and-mobile.md` | 索引/资料库/移动端方法论 |
| **专题汇总** | 如 `2026-05-20-008-聊天历史踩坑与开发日志汇总.md` | 大专题一次读完 |
| **三窗口总归档** | `docs/EU-三窗口开发总归档-2026-05-20至22.md` | **2026-05-20～22 三个 Cursor 窗口**必读 |

### 新对话 / 新同事交接（复制即用）

```
请先读：
1. docs/EU-三窗口开发总归档-2026-05-20至22.md
2. docs/EU-开发手册.md（本册）
3. docs/EU-研发日志.md（最近一节）
4. docs/EU-部署与入口说明.md

现行：public/eu.html，端口 8000，构建戳见 Console [次元姬 EU] client build。
勿改 index.html / script.js（除非用户明确只修 tokenizers）。
任务：<具体需求>
```

---

## 一、现行基线（2026-05-20）

| 项 | 值 |
|----|-----|
| 正式前端 | `public/eu.html`（`/eu-demo.html` → 308） |
| 端口 | **8000**（`config.yaml` `dataRoot: ./data`） |
| 线上示例路径 | `/opt/SillyTavern` |
| 构建戳（示例） | `20260522-manual-continue-fix-v109`（以 `grep EU_CLIENT_BUILD_STAMP public/eu.html` 为准） |
| 登录落地 | **商城**（`enterApp` + `landing: 'mall'`） |
| 登录后对话 | **不自动** `openWorldChat`；侧栏手动点开，记录仍云同步 |
| 公共商城 | `data/eu-public/mall/`（**不进 Git**，SFTP 合并 + `eu-mall-rebuild-index.mjs`） |

---

## 二、术语与数据（必分清）

### 2.1 产品三块（最易混）

| 名称 | 是什么 | 存哪 |
|------|--------|------|
| **我的世界** | 侧栏历史**会话**；点进全屏对话 | `eu_demo_conversations_<handle>` 等三键 |
| **故事书库** | 已**获取**的书列表 | `eu_demo_acquired_*`、轻量 meta |
| **商城** | 公共书目浏览/获取 | `data/eu-public/mall/` + API 分页 |

**聊天历史** = `messages[]` 里 user/assistant **气泡**，不是开场白大段剧情块。

### 2.2 用户数据落盘

| 数据 | 浏览器 localStorage | 服务器 |
|------|---------------------|--------|
| 个人资料 JSON | `eu_demo_account_profile_<handle>` | `eu-mall-browser-state.json` 内同键（约 **120KB**/键上限） |
| 头像 data URL | `eu_demo_account_avatar_dataurl_<handle>` | 不进 profile JSON；灌水公开头像见下 |
| 对话云 | 三键见下 | 同上 JSON 文件 |
| 灌水公开头像 | — | `data/eu-tieba-avatars/<slug>.jpg` |
| 酒馆 API/设置 | — | `data/<handle>/settings.json`、`secrets.json` |
| 灌水全站帖 | — | `data/eu-tieba-board.json`（**全站一份**） |

**对话云三键**（账号 `handle`）：

- `eu_demo_conversations_<handle>` — 消息正文（云端单键约 **4MB** 上限；上传前裁到约 **3.5MB**）
- `eu_demo_character_sessions_<handle>` — 角色→会话映射（约 **400KB**/键）
- `eu_demo_last_chat_resume_<handle>` — 恢复指针（约 **400KB**/键）

API：`GET/POST /api/eu/browser-state/conversations`；整包 `POST /api/eu/browser-state`。

迁移页 `eu-localstorage-port.html` 文案「不请求云端」**不代表**主站 `eu.html` 无云。

### 2.3 权限（简表）

| 能力 | 绑定 |
|------|------|
| 开发者模式（最高） | 口令 + **浏览器 session**，非账号永久 |
| 商城发布 | `euRoles` `mall.publisher` |
| 贴吧管理 | `tieba.moderator` |
| 新用户 xAI | `config.yaml` `euSharedApiFromHandle` + 登录 `euSyncSharedApiFromServer` |

---

## 三、部署与运维（汇总）

### 3.1 代码更新（服务器）

```bash
cd /opt/SillyTavern
git pull origin main
grep EU_CLIENT_BUILD_STAMP public/eu.html | head -1
# 仅改 eu.html 时不必重启 Node；改 src/endpoints/* 后：
ps aux | grep "node server.js"
kill <旧PID>    # 勿粘贴错误如 kill <PID>kill 7010
nohup node server.js > /tmp/st.log 2>&1 &
```

### 3.2 浏览器

- **Ctrl+F5** 或 `eu.html?v=<构建戳后缀>`
- Console：`[次元姬 EU] client build …`
- 手机预览：`eu-mobile-preview.html` → **刷新内嵌**

### 3.3 切勿

- 用本机整个 `data/` 覆盖线上（会冲用户账号）
- 只 pull `eu.html` 不 pull `eu-mall-resources.js` / `eu-browser-state.js` 却期望新 API 生效
- 以为「刷新即可」而服务器仍是**旧 node 进程**或**未 pull**
- 提交 `tools/eu-mall-batch.config.json`（含密码）

### 3.4 公共商城书库（无 Git）

本机 `data/eu-public/mall/resources` + `thumbs` → SFTP **仅较新合并** → 服务器：

```bash
node tools/eu-mall-rebuild-index.mjs
```

### 3.5 验收命令（对话云）

```bash
node tools/eu-conversation-cloud-check.mjs <handle>
```

浏览器：`await euDebugConversationCloud()` → `serverBytes`、`localMessages`、`build`。

---

## 四、踩坑百科（按主题）

> 细项见完成单；此处为**高频复现**归纳。

### 4.1 部署、缓存、构建戳

| 现象 | 根因 | 对策 |
|------|------|------|
| 改了代码线上仍旧 | 未 push / 未 pull / 旧 node | pull + kill 旧进程 + 看构建戳 |
| 刷新无效 | 缓存 / iframe 未刷新内嵌 | Ctrl+F5、`?v=`、预览页点刷新内嵌 |
| `git pull` 冲突 | 服务器手改 `eu-shared-api.js` 等 | `git checkout -- <文件>` 再 pull |
| 启动 500 `writeFileAtomicSync` | import 写法错误 | `import { sync as writeFileAtomicSync } from 'write-file-atomic'` |
| grep 到 `.st-chat-send-btn` 误以为有底栏发送钮 | 别的页面样式类名 | grep `assistant-send-btn` / `bottom-input-compose` |

### 4.2 对话云与「我的世界」历史（v90–v99）

| 现象 | 根因 | 对策 |
|------|------|------|
| 外部说「纯 localStorage」 | push 失败 + 打开时删消息 | `serverBytes` 反证；专题 `2026-05-20-008` |
| `push ok` 仍丢 | `conversations` 未进 `savedKeys` / clearedAt 锁 | v94–v95；看 Network `skippedKeys` |
| 重开只见开场白 | v98 空 conv；**v99 开场白重置删 user** | 构建戳 v99+ |
| 登录先进商城再跳进对话 | `scheduleEuResumeLastChatIfAny` | v102 已取消自动恢复 |
| 发消息无 AI 回 | xAI 额度 | 与存档无关；充值/自备 Key |

### 4.3 商城、封面、取向、OOM

| 现象 | 根因 | 对策 |
|------|------|------|
| 男性向/女性向整行紫条 | 全局 `button{width:100%}` | `.mall-orientation-btn` 覆盖；改**文字钮** v101 |
| 手机看不到取向钮 | 固定 36px 方钮裁切符号 | 文字 + `width:auto` |
| 取向筛选无效 | 未部署 `eu-mall-resources.js` | 前后端一起 pull 重启 |
| pull 后仍 626 本 | 未 SFTP 资源或未 rebuild-index | SFTP + `eu-mall-rebuild-index.mjs` |
| 封面 404 / 裂图 | public 路径、thumb 缺失、content-visibility | 见 5/14–5/16 封面系列完成单 |
| 商城/列表 OOM | 全量 DOM、整包 JSON 水合 | 分页（10 条/页）、虚拟滚动、轻量获取、禁全量合并 |

### 4.4 内存与启动

| 现象 | 根因 | 对策 |
|------|------|------|
| 登录/进商城崩溃 | 整库载入 devItems、browser-state 过大 | lite 登录、分片、延后云同步、释放本机书库 |
| 详情弹窗 OOM | 整本 JSON 进弹窗 | preview/lean 接口、截断 desc |

### 4.5 登录、API、生成

| 现象 | 根因 | 对策 |
|------|------|------|
| `euSyncSharedApiFromServer is not defined` | `eu.html` 语法错误（重复 const） | 修 script；见 `2026-05-19-021` |
| OpenAI key missing（新用户） | 未套站长 xAI | `euSharedApiFromHandle` + sync 接口 + 批量脚本 |
| `error: true` 叠字 | catch 再包一层「发送失败」 | 见 `2026-05-10-002` |
| 从 `0.0.0.0` 书签进 | Cookie/host 不一致 | 用 `127.0.0.1` 或正式域名 |

### 4.6 移动端、底栏、顶栏

| 现象 | 根因 | 对策 |
|------|------|------|
| 顶栏「次元姬」挡对话首行 | `topbar-mobile` z-index 压住对话层 | v60 对话页隐藏主站顶栏 |
| 底栏竖排、输入框极窄 | 全局 `button/textarea{width:100%}` | `.bottom-input-bar` 内覆盖 |
| 底栏三钮丢失 | v54–v59 未入库，被 v90+ 覆盖 | `bottom-input-compose` v100 |
| 正文左右被挡 | 侧栏三角、滚动条贴边 | 消息区 padding + `scrollbar-gutter` |

### 4.7 灌水吧

| 现象 | 根因 | 对策 |
|------|------|------|
| 本机帖线上没有 | 板数据单文件未同步 | 拷 `eu-tieba-board.json` + media |
| 配图别人看不见 | 正文写 127.0.0.1 | 走上传 API，URL 规范为 `/api/eu/tieba/media/...` |
| 删帖 403 | 权限非开发者/作者 | 见 RBAC 与 `euTiebaDev` 系列 |

### 4.8 开发者模式与批量

| 现象 | 根因 | 对策 |
|------|------|------|
| 开发者 404 | 未 activate / session 丢 | 口令；`eu-dev-mode` 路由 |
| 批量上架连不上 | 端口错、CSRF、ECONNRESET | 8000、登录 cookie、重试脚本 |
| 删除无简介误删 656 | 筛选条件过宽 | `2026-05-16-057` |

### 4.9 开场白、展示、分段

| 现象 | 根因 | 对策 |
|------|------|------|
| 简介/开场白挤一团 | 无 `\n\n`、`**场景**:` glued | `euNormalizeReadableParagraphs` v61+ |
| 界面见字但 messages 为 0 | 渲染的是开场白不是气泡 | 以 `localMessages` 为准 |
| 展示层删光正文 | 清洗正则过宽 | v21 保留正文；区分展示/后台 |

---

## 五、功能模块索引（按域查完成单）

### 5.1 对话、生成、世界书

- 故事书重生成/续写：`2026-05-10-001`
- 目标长度 / max_tokens / 字控 / 截断：`2026-05-10-003`、`004`、`2026-05-19-015`~`018`
- 展示层清洗 / game 标签：`2026-05-15-020`、`021`
- 开场白 / 分段 / HTML 提取：`2026-05-15-016`、`022`、`2026-05-16-014`~`020`、`2026-05-19-017`、`024`、`2026-05-19-011`
- 世界书注入 / 对齐：`2026-04-30-*`、`2026-05-01-*` 多条

### 5.2 对话云与存档

- 跨浏览器续聊起点：`2026-05-19-031`、`036`
- v91–v99 链：`2026-05-19-041`、`042`，`2026-05-20-001`~`007`
- **汇总**：`2026-05-20-008-聊天历史踩坑与开发日志汇总.md`
- 登录不自动进对话：`2026-05-20-011`

### 5.3 商城

- 分页 / 搜索 / 全年龄：`2026-05-16-064`、`035`~`037`
- 取向筛选：`2026-05-19-025`~`028`
- 封面 / thumb / 404：`2026-05-13-013`~`015`、`2026-05-14-019`~`027`
- AI 标签 / 简介批量：`2026-05-16-003`~`008`、`052`
- 部署 626/642：`2026-05-16-065`、`066`

### 5.4 登录、账号、RBAC、API

- 多用户注册：`2026-05-10-005`、`006`
- 个人资料 / 头像 / 云快照：`2026-05-10-007`、`2026-05-12-006`、`2026-05-13-005`、`006`
- xAI 共用：`2026-05-17-008`、`2026-05-18-010`、`011`
- RBAC 授权 UI：`2026-05-13-001`、`002`

### 5.5 灌水吧

- API / CORS / 删帖：`2026-05-10-008`~`014`
- 头像 / 配图 / 列表 UI：`2026-05-12-001`~`008`、`2026-05-13-003`

### 5.6 移动端与布局

- 侧栏抽屉：`2026-05-13-008`
- 手机预览：`2026-05-13-009`、`010`、`2026-05-14-012`、`013`
- 顶栏 / 商城 / 灌水布局：`2026-05-14-011`、`014`、`015`
- 底栏：`2026-05-18-010`、`011`，`2026-05-20-009`，`2026-05-19-009`（并入输入框 v59 思路）

### 5.7 开发者模式

- 口令 / 权限：`2026-05-15-006`~`010`
- 批量上架 / 索引：`2026-05-15-001`~`005`、`2026-05-16-048`~`050`
- 列表 OOM / 分页：`2026-05-16-025`、`026`、`044`
- 转换分区：`2026-05-19-023`

### 5.8 虚拟恋人

- `2026-05-19-020`、`022`、`2026-05-19-012`

### 5.9 部署与工程

- 端口 8000 / 弃 8017：`2026-05-16-009`、`010`
- 根路径 eu.html：`2026-05-17-006`
- 一键启动：`2026-05-16-012`、`021`
- 开发交接模板：`2026-05-15-009`
- 5/19 部署总结：`2026-05-19-030`、`035`

---

## 六、关键代码地图

| 区域 | 路径 |
|------|------|
| 主前端 | `public/eu.html`（单文件大仓，含 UI + 业务） |
| 浏览器状态 / 对话云 | `src/endpoints/eu-browser-state.js` |
| 商城 API | `src/endpoints/eu-mall-resources.js` |
| 灌水吧 | `src/endpoints/eu-tieba.js` |
| EU 注册登录 | `src/endpoints/eu-auth.js` |
| 共用 xAI | `src/endpoints/eu-shared-api.js` |
| 开发者 | `src/endpoints/eu-dev-mode.js` |
| RBAC | `src/endpoints/eu-rbac-routes.js` |
| 路由挂载 | `src/server-main.js` |
| 配置 | `default/config.yaml` |

**`eu.html` 内常改函数（检索用）**：

- `enterApp`、`showPage`、`euEnterAppLoadSessionState`
- `openWorldChat`、`tryRestoreLastWorldChatSession`、`persistConversationRuntime`
- `euPushConversationCloudNow`、`euPullConversationCloudBeforeLoad`、`euDebugConversationCloud`
- `filterMall`、`setMallOrientationFilter`、`acquireMallItem`
- `euNormalizeReadableParagraphs`、`euFormatTextToDisplayHtml`

---

## 七、工具脚本（`tools/`）

| 脚本 | 用途 |
|------|------|
| `eu-conversation-cloud-check.mjs` | 服务器对话云磁盘字节/条数 |
| `eu-conversation-save-v94-test.mjs` | 清锁逻辑自测 |
| `eu-shared-api-sync-all.mjs` | 批量套站长 xAI |
| `eu-mall-rebuild-index.mjs` | 重建公共商城索引 |
| `eu-mall-batch-*.mjs` / `.bat` | 批量上架（注意 config 勿提交） |
| `eu-deploy-verify.mjs` | 外网构建戳（若有） |

---

## 八、按日滚动日志（摘要入口）

| 日期 | 入口 |
|------|------|
| 最新 | `docs/EU-研发日志.md` 文件**最上方**一节 |
| 2026-05-20 | 对话云 v99、底栏 v100、登录商城 v101/v102 → 研发日志 + `2026-05-20-008` |
| 2026-05-19 | 虚拟恋人、取向、对话云 v83+ → 研发日志 5/19 节 |
| 2026-05-16~18 | 正式 eu.html、OOM、分页、xAI → 研发日志历史索引 |
| 2026-04~05 初 | 生成链路、世界书 → `eu-completions/2026-04-*`、`2026-05-01-*`、`05-02-*`、`05-03-*` |

---

## 九、完成单全量列表

共 **299** 篇（含本索引页），按年月罗列：

→ **[000-完成单全量索引.md](eu-completions/000-完成单全量索引.md)**

---

## 十、本册修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-20 | 首版成册：合并研发日志、部署说明、对话云/底栏/登录近期结论与全量完成单索引 |

---

*进一步开发时：先在本册第四章搜现象 → 第五章进完成单 → 第六章定位代码。*
