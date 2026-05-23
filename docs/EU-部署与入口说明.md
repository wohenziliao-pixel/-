# EU 部署与入口说明（当前口径）

> **2026-05-16** 本机已测通，准备上传替换网络版。历史完成记录里若仍写 `8017` / `eu-demo.html`，以本文为准。

---

## 一、环境与入口

| 项 | 当前值 |
|----|--------|
| 仓库 | `SillyTavern-1.17.0` |
| **正式前端** | `public/eu.html`（勿再以 `eu-demo.html` 对外宣传） |
| 手机外框预览 | `public/eu-mobile-preview.html` |
| **HTTP 端口** | **8000**（`config.yaml`；旧文档中的 **8017 已废弃**） |
| 本机入口 | `http://127.0.0.1:8000/eu.html` |
| 网络版入口 | `https://<你的新域名>/eu.html` |
| 旧书签 | `/eu-demo.html` → 服务端 **308** 到 `/eu.html` |
| 测试账号 | `wohenziliao`（权限见下；非酒馆 ADMIN） |
| 公共商城数据 | 服务端 `data/eu-public/mall/`（**不要**用本机 data 覆盖线上） |
| 前端构建戳 | 控制台 `[次元姬 EU] client build`，当前 **`20260522-opening-zh-translate-v137`**（见 `docs/eu-completions/2026-05-22-059-网络版v137同步指令.md`） |

---

## 二、权限模型（简表）

| 类型 | 绑定方式 | 取消方式 |
|------|----------|----------|
| 酒馆 **admin** | 用户库 `admin: true` | ST 用户管理，非 EU 授权弹窗 |
| EU **super.admin** | `euRoles` | 不在「取消授权」内 |
| **商城/贴吧管理** | `euRoles`: `mall.publisher` / `tieba.moderator` | 用户授权 → **取消授权** |
| **开发者模式（最高）** | 聊天口令 + **浏览器 session** | 退出开发者模式 / 登出；**不跟账号走** |

开发者口令：`#开发者模式404945859` → `POST /api/eu/dev/activate`。

---

## 三、商城（已测）

- 分页：**每页 10 条**，底栏翻页；`GET /api/eu/mall/resources?page=&pageSize=10`
- 搜索：同上接口 `q=`，总条数/总页数为**筛后**结果
- 全年龄：`sfw=1`（服务端分页前过滤 `adultContent` / 18+ 标签）；约 **226** 条 vs 全库 **626**
- 18+ 角标 = **成人向**（`adultContent: true` 或成人内容类标签）

---

## 四、上传替换网络版（操作清单）

### 4.1 同步代码（Git，推荐）

本机许多文件曾**未入库**，上传前需 commit + push，例如：

- `public/eu.html`、`public/eu-mobile-preview.html`
- `public/scripts/extensions/connection-manager/index.js`、`public/scripts/openai.js`、`public/scripts/tokenizers.js`
- `public/index.html`（Connection Manager「保存配置」）
- `default/content/presets/openai/文风转换-现代文.json`（新装/恢复预设时）
- `src/server-main.js`、`src/endpoints/eu-*.js`（**v118 必含** `eu-browser-state.js`、`eu-mall-resources.js`；另 `eu-rbac-routes.js`、`eu-dev-mode.js` 等）
- `src/users.js`（若有改动）

**不要提交**：`tools/eu-mall-batch.config.json`（含密码）。

服务器：

```bash
cd /path/to/SillyTavern-1.17.0
git pull origin main
npm install   # 仅 package 变更时
# 重启 node 进程（必须）
```

### 4.2 线上没有商城书库时：必须单独上传 data（约 125MB）

**不会进 Git**（`.gitignore` 含 `/data`）。本机约：

| 路径 | 约大小 | 说明 |
|------|--------|------|
| `data/eu-public/mall/resources/` | ~114MB，626 个 `.json` | 故事书正文与元数据 |
| `data/eu-public/mall/thumbs/` | ~9MB，626 张封面 | 与 resources 成对 |
| 索引 | 在 `data/_storage/` | 上传后在服务器执行重建（见下） |

**不要**用本机整个 `data/` 覆盖服务器（会冲掉线上用户账号）；只拷 **`eu-public/mall`** 目录。

#### 方式 A：WinSCP / FileZilla（Windows 常用）

1. 连上服务器 SFTP。
2. 本机目录：  
   `D:\Eureka\SillyTavern\SillyTavern-1.17.0\data\eu-public\mall\`
3. 服务器目录（与酒馆安装目录一致）：  
   `<服务器项目>/data/eu-public/mall/`
4. 上传整个 `mall` 文件夹，保证服务器上有：
   - `data/eu-public/mall/resources/*.json`
   - `data/eu-public/mall/thumbs/*.jpg`

#### 方式 B：scp（本机 PowerShell，已配 SSH 密钥时）

```powershell
scp -r "D:\Eureka\SillyTavern\SillyTavern-1.17.0\data\eu-public\mall" 用户@服务器IP:/path/to/SillyTavern-1.17.0/data/eu-public/
```

把 `用户@服务器IP` 和 `/path/to/SillyTavern-1.17.0` 换成你的。

#### 上传后：在服务器重建索引（必做）

代码 `git pull` 并安装依赖后，在服务器项目根执行：

```bash
node tools/eu-mall-rebuild-index.mjs
```

应输出：`已写入索引 626 条`。然后 **重启** `node server.js`。

#### 验收

```bash
ls data/eu-public/mall/resources/*.json | wc -l   # 应约 626
```

浏览器打开 `https://你的域名/eu.html` → 商城应显示约 626 条（全年龄约 226）。

### 4.3 不同步 / 慎覆盖（线上已有用户时）

- 不要用本机 `data/_storage/` 整包覆盖（含用户与索引混放）
- 不要用本机 `data/<handle>/` 覆盖线上用户私有目录（v118 后个人快照仅索引/资料；故事书正文在 `eu-public/mall`）
- 线上若某用户 `eu-mall-browser-state.json` 曾 >50MB：勿用本机文件覆盖；部署 v118 后让用户登录同步，或运维删除其中 `eu_demo_dev_heavy` 键

### 4.3 服务器地址变更时必改

1. 对外链接：`https://新域名/eu.html`
2. 反代 / Cloudflare 隧道 → 指向进程监听端口（与 `config.yaml` 的 `port` 一致，默认 **8000**）
3. 服务器 `config.yaml` → `cors.origin` 增加 `https://新域名`
4. 本机批量工具 `tools/eu-mall-batch.config.json` → `"baseUrl": "https://新域名"`（勿提交 Git）

### 4.4 上线验收

- [ ] `https://新域名/eu.html` 可开，构建戳含 **`v133`**（`writing-style-toggle-inrow`）
- [ ] 普通用户上传故事书：`POST /api/eu/mall/contribute` 成功；个人 browser-state 无巨型 dev/heavy
- [ ] EU 文风五档 + 酒馆五条连接名一致；`dumpEuWritingStyleApiAudit()` 五条 `tavernFound`
- [ ] 故事书生成 `max_tokens` ≥ 2048；状态条上下文 **16383**
- [ ] `/eu-demo.html` 308 到 `eu.html`
- [ ] 商城全年龄：约 226 条、每页 10 条
- [ ] 搜索后总页数变化
- [ ] 开发者口令 / 退出开发者模式 / 用户授权与取消授权
- [ ] `GET /api/eu/mall/resources?page=1&pageSize=10&sfw=1` 无 `adultContent: true`

---

## 五、批量工具（本机对线上）

- 配置：`tools/eu-mall-batch.config.json`（`baseUrl` 指向**线上**域名）
- 示例：`tools/eu-mall-batch.config.example.json`（端口 **8000**）
- 脚本：`tools/eu-mall-batch-run.cmd`、`tools/eu-mall-purge-no-desc.mjs` 等

---

## 六、文档索引

| 文档 | 用途 |
|------|------|
| 本文 | 部署与入口**唯一现行口径** |
| `docs/eu-completions/2026-05-16-011-联网版URL去掉demo正式eu.html.md` | URL 迁移说明 |
| `docs/EU-网络版上线整理-2026-05-22.md` | 上传总清单（v118 基线） |
| `docs/eu-completions/2026-05-22-059-网络版v137同步指令.md` | **本次网络版同步（v134～v137）** |
| `docs/EU-三窗口开发总归档-2026-05-20至22.md` | **三 Cursor 窗口**开发/踩坑/注意事项总入口 |
| `docs/eu-completions/2026-05-22-009-新窗口交接-续写开发与待办.md` | 续写/重生成专题交接 |
| `docs/eu-completions/2026-05-15-009-新窗口交接-开发日记与工作进程.md` | 开发交接（已同步 2026-05-16） |
| `docs/eu-completions/2026-05-16-*` | 近期功能完成记录 |

历史 `eu-completions` 条目中出现的 `public/eu-demo.html`、`8017` 为**当时快照**，不必逐条改；以本文为准。
