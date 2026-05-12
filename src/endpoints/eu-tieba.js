/**
 * EU 灌水吧：主题帖与楼层回复，数据存于 DATA_ROOT/eu-tieba-board.json；帖与楼层含 authorHandle（标识）与 authorDisplayName（展示昵称）。
 * 灌水区写操作身份与酒馆其它路由解耦：优先酒馆 Cookie 会话（req.user）；否则识别请求头 `X-EU-Tieba-Api`（由 POST /api/eu/tieba/auth/session 签发，内存令牌，不经酒馆 CSRF）。
 * 删帖需 profile.admin / EU 管理账号；若 config `euTiebaDevBulkDelete` 为 true（默认），已登录用户可任选其一标识「EU 开发者删帖」：`JSON` 体 `euTiebaDev: true`、查询参数 `?euTiebaDev=1`、或请求头 `X-EU-Tieba-Dev: 1`。
 * 配图上传：POST /upload-image，长边不超过 1600px、JPEG 质量 82，写入 DATA_ROOT/eu-tieba-media/；
 * 正文与列表使用路径 `/api/eu/tieba/media/<file>`（该 GET 挂在 requireLogin 之前，便于未登录浏览列表/帖子时仍能加载图）。
 * 灌水区发帖人头像：POST/DELETE `/avatar`（需灌水区身份），GET `/avatar/:handle` 匿名可读，文件存 DATA_ROOT/eu-tieba-avatars/<slug>.jpg。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import sanitize from 'sanitize-filename';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import storage from 'node-persist';
import { ResizeStrategy } from '@jimp/plugin-resize';
import { Jimp, JimpMime } from '../jimp.js';
import { getIpFromRequest } from '../express-common.js';
import { invalidateFirefoxCache, isPathUnderParent, getConfigValue } from '../util.js';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { toKey, getPasswordHash } from '../users.js';
import {
    issueEuTiebaApiToken,
    revokeEuTiebaApiToken,
    getHandleFromEuTiebaApiToken,
} from './eu-tieba-api-auth.js';

export const router = express.Router();

const EU_MANAGEMENT_HANDLES = new Set(['admin', 'administrator', 'root', 'eu_admin']);

/** @type {Promise<void>} */
let boardChain = Promise.resolve();

/**
 * @param {() => void | Promise<void>} fn
 * @returns {Promise<void>}
 */
function queueBoard(fn) {
    boardChain = boardChain.then(
        () => Promise.resolve().then(fn),
        () => Promise.resolve().then(fn),
    );
    return boardChain;
}

function boardFilePath() {
    return path.join(globalThis.DATA_ROOT, 'eu-tieba-board.json');
}

function loadBoardSync() {
    const fp = boardFilePath();
    try {
        const raw = fs.readFileSync(fp, 'utf8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || !Array.isArray(data.threads)) {
            return { threads: [] };
        }
        return data;
    } catch {
        return { threads: [] };
    }
}

function saveBoardSync(data) {
    writeFileAtomicSync(boardFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function canModerate(req) {
    const p = req.tiebaActorUser;
    if (!p) {
        return false;
    }
    if (p.admin === true) {
        return true;
    }
    const h = String(p.handle || '').trim().toLowerCase();
    return EU_MANAGEMENT_HANDLES.has(h);
}

/**
 * EU 开发者删帖标识：请求头（旧）、查询参数 `euTiebaDev=1`（防反代丢 DELETE body）、或 JSON 体 `euTiebaDev`。
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function readEuTiebaDevClientFlag(req) {
    const h = String(req.get('x-eu-tieba-dev') || '').trim();
    if (h === '1') {
        return true;
    }
    const rawQ = req.query?.euTiebaDev;
    const qStr = Array.isArray(rawQ) ? String(rawQ[0] ?? '') : String(rawQ ?? '');
    const q = qStr.trim().toLowerCase();
    if (q === '1' || q === 'true' || q === 'yes') {
        return true;
    }
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
        return false;
    }
    const v = /** @type {{ euTiebaDev?: unknown }} */ (b).euTiebaDev;
    if (v === true || v === 1) {
        return true;
    }
    const sv = String(v ?? '').trim().toLowerCase();
    if (sv === '1' || sv === 'true' || sv === 'yes') {
        return true;
    }
    return false;
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function tiebaDeleteForbiddenDetail(req) {
    if (canModerate(req)) {
        return '无删帖权限（内部状态异常）';
    }
    if (!getConfigValue('euTiebaDevBulkDelete', true, 'boolean')) {
        return '无删帖权限：服务端已关闭 euTiebaDevBulkDelete。';
    }
    const handle = req.tiebaActorHandle;
    if (!handle) {
        return '无删帖权限：未识别灌水区身份。请使用酒馆登录会话，或 POST /api/eu/tieba/auth/session 获取灌水令牌后重试。';
    }
    if (!readEuTiebaDevClientFlag(req)) {
        return '无删帖权限：未收到开发者删帖标记（JSON euTiebaDev / ?euTiebaDev=1）。请确认已开启 EU 开发者模式并硬刷新页面；若仍失败请重启 SillyTavern 以加载最新 eu-tieba 接口。';
    }
    return '无删帖权限';
}

/**
 * 是否允许删灌水帖/楼层：版主链，或（配置开启 + 开发者标识 + 已登录）。
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function canDeleteTiebaContent(req) {
    if (canModerate(req)) {
        return true;
    }
    if (!getConfigValue('euTiebaDevBulkDelete', true, 'boolean')) {
        return false;
    }
    if (!readEuTiebaDevClientFlag(req)) {
        return false;
    }
    return Boolean(req.tiebaActorHandle);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {string | null}
 */
function requireTiebaActor(req, res) {
    const h = req.tiebaActorHandle;
    if (!h) {
        res.status(403).json({ error: '请先登录：灌水发帖/回复需酒馆会话或灌水区令牌（POST /api/eu/tieba/auth/session）。' });
        return null;
    }
    return h;
}

function sanitizeTitle(s) {
    return String(s ?? '').trim().slice(0, 200);
}

function sanitizeBody(s, max) {
    return String(s ?? '').trim().slice(0, max);
}

/** 灌水吧展示昵称：去控制字符与尖括号，限长。 */
function sanitizeAuthorDisplayName(raw, max = 64) {
    const n = Math.min(120, Math.max(1, Number(max) || 64));
    let s = String(raw ?? '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, n);
    return s;
}

/**
 * 发帖/回帖署名展示名：优先客户端传的 EU 昵称，否则酒馆 profile.name，最后为 handle。
 * @param {import('express').Request} req
 * @param {unknown} bodyAuthorDisplayName
 * @param {string} handle
 */
function resolveAuthorDisplayName(req, bodyAuthorDisplayName, handle) {
    const fromBody = sanitizeAuthorDisplayName(bodyAuthorDisplayName, 64);
    const profileName = sanitizeAuthorDisplayName(req.tiebaActorUser?.name, 64);
    const h = String(handle || '').trim();
    return fromBody || profileName || h;
}

/**
 * @param {string | undefined} authorHandle
 * @param {string | undefined} authorDisplayName
 * @returns {string}
 */
function tiebaStoredDisplayLabel(authorHandle, authorDisplayName) {
    const d = sanitizeAuthorDisplayName(authorDisplayName, 64);
    if (d) {
        return d;
    }
    return String(authorHandle || '').trim();
}

const SNIPPET_MAX = 220;

/**
 * @param {string} raw
 * @returns {string | null}
 */
function safeHttpImageUrl(raw) {
    const u = String(raw || '').trim().slice(0, 2048);
    if (!/^https?:\/\//i.test(u)) {
        return null;
    }
    if (/[\s"'<>]/.test(u) || /javascript:/i.test(u)) {
        return null;
    }
    return u;
}

/**
 * 将正文里 `![](http://127.0.0.1:…/api/eu/tieba/media/…)` 规范为 `![](/api/eu/tieba/media/…)`，避免他人用其它域名打开时图片仍指向发帖人本机。
 * @param {string} raw
 * @returns {string}
 */
function normalizeTiebaContentLocalhostMediaUrls(raw) {
    let s = String(raw ?? '');
    const re = /!\[([^\]]*)\]\(\s*https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(\/api\/eu\/tieba\/media\/[^)\s]+)\s*\)/gi;
    s = s.replace(re, (match, alt, pathAfterHost) => `![${alt}](${pathAfterHost})`);
    return s;
}

/** 灌水吧公共媒体文件名（仅允许上传端生成的 eu_tieba_* 样式）。 */
const TIEBA_MEDIA_FILENAME_RE = /^eu_tieba_\d+_[a-z0-9]+\.jpe?g$/i;

/**
 * @param {string} raw
 * @returns {string | null}
 */
function safeTiebaMediaUrl(raw) {
    let u = String(raw || '').trim().slice(0, 512);
    if (!u || /[\x00<>]/.test(u)) {
        return null;
    }
    let dec;
    try {
        dec = decodeURIComponent(u.split('?')[0] || '');
    } catch {
        dec = u.split('?')[0] || '';
    }
    if (dec.includes('..')) {
        return null;
    }
    const m = dec.match(/^\/?api\/eu\/tieba\/media\/([^/]+)$/i);
    if (!m) {
        return null;
    }
    const fn = String(m[1] || '').trim();
    if (!TIEBA_MEDIA_FILENAME_RE.test(fn)) {
        return null;
    }
    return `/api/eu/tieba/media/${fn}`;
}

function tiebaMediaDirectory() {
    return path.join(globalThis.DATA_ROOT, 'eu-tieba-media');
}

/** 与帖子 authorHandle 规范化一致：小写 + 仅 a-z0-9_-，长度 1–64。 */
const TIEBA_AVATAR_SLUG_RE = /^[a-z0-9_-]{1,64}$/;

/**
 * @param {string} handle
 * @returns {string | null}
 */
function tiebaAvatarSlug(handle) {
    const s = String(handle ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '');
    if (!s || s.length > 64 || !TIEBA_AVATAR_SLUG_RE.test(s)) {
        return null;
    }
    return s;
}

function tiebaAvatarsDirectory() {
    return path.join(globalThis.DATA_ROOT, 'eu-tieba-avatars');
}

/**
 * 本地上传图路径（与 eu-demo normalizeStoredImagePath 一致）。
 * @param {string} raw
 * @returns {string | null}
 */
function safeUserRelativeImagePath(raw) {
    let u = String(raw || '').trim().slice(0, 2048);
    if (!u || /[\x00<>]/.test(u)) {
        return null;
    }
    let dec;
    try {
        dec = decodeURIComponent(u);
    } catch {
        dec = u;
    }
    if (dec.includes('..')) {
        return null;
    }
    const lower = dec.toLowerCase();
    const ok =
        lower.startsWith('/user/images/') ||
        lower.startsWith('user/images/') ||
        lower.startsWith('/user%20images/');
    if (!ok) {
        return null;
    }
    const base = u.split('?')[0];
    if (!/\.(jpe?g|png|gif|webp|bmp)$/i.test(base)) {
        return null;
    }
    return u.startsWith('/') ? u : `/${u}`;
}

/**
 * 从首楼正文提取首张图 URL（Markdown / HTML / 裸链；含 /api/eu/tieba/media/... 与 /user/images/...）。
 * @param {string} text
 * @returns {string | null}
 */
function extractFirstImageUrl(text) {
    const s = String(text || '');
    const mdRe = /!\[[^\]]*]\(\s*([^)\s]+)\s*\)/gi;
    let mm;
    while ((mm = mdRe.exec(s)) !== null) {
        const candidate = String(mm[1] || '').trim();
        const http = safeHttpImageUrl(candidate);
        if (http) {
            return http;
        }
        const media = safeTiebaMediaUrl(candidate);
        if (media) {
            return media;
        }
        const rel = safeUserRelativeImagePath(candidate);
        if (rel) {
            return rel;
        }
    }
    const im = s.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (im) {
        const candidate = String(im[1] || '').trim();
        const u = safeHttpImageUrl(candidate) || safeTiebaMediaUrl(candidate) || safeUserRelativeImagePath(candidate);
        if (u) {
            return u;
        }
    }
    const bare = s.match(/(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:\?[^\s<>"']*)?/i);
    if (bare) {
        const u = safeHttpImageUrl(bare[1]);
        if (u) {
            return u;
        }
    }
    const bareRel = s.match(/(\/?user\/images\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|bmp))(?:\?[^\s<>"']*)?/i);
    if (bareRel) {
        const u = safeUserRelativeImagePath(bareRel[1]);
        if (u) {
            return u;
        }
    }
    const bareMedia = s.match(/(\/?api\/eu\/tieba\/media\/eu_tieba_[^\s<>"']+\.jpe?g)(?:\?[^\s<>"']*)?/i);
    if (bareMedia) {
        const u = safeTiebaMediaUrl(bareMedia[1]);
        if (u) {
            return u;
        }
    }
    return null;
}

/**
 * 首楼纯文字摘要（供列表预览）。
 * @param {string} text
 * @returns {string}
 */
function plainSnippetFromContent(text) {
    let s = String(text || '');
    s = s.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
    s = s.replace(/<[^>]+>/g, ' ');
    s = s.replace(/https?:\/\/\S+/gi, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > SNIPPET_MAX) {
        return `${s.slice(0, SNIPPET_MAX)}…`;
    }
    return s;
}

function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const THREAD_ID_RE = /^t_[a-zA-Z0-9_]+$/;
const REPLY_ID_RE = /^r_[a-zA-Z0-9_]+$/;

function normalizeThread(t) {
    const replies = Array.isArray(t.replies) ? t.replies : [];
    return {
        id: t.id,
        title: t.title,
        content: t.content,
        authorHandle: t.authorHandle,
        authorDisplayName: tiebaStoredDisplayLabel(t.authorHandle, t.authorDisplayName),
        createdAt: t.createdAt,
        replies: replies.map((r) => ({
            id: r.id,
            authorHandle: r.authorHandle,
            authorDisplayName: tiebaStoredDisplayLabel(r.authorHandle, r.authorDisplayName),
            content: r.content,
            createdAt: r.createdAt,
            replyQuote: typeof r.replyQuote === 'string' ? r.replyQuote : undefined,
        })),
    };
}

const tiebaAuthLimiter = new RateLimiterMemory({
    points: 12,
    duration: 60,
});

/**
 * 绑定灌水操作者：酒馆会话优先，否则 `X-EU-Tieba-Api` 令牌对应用户。
 * @type {import('express').RequestHandler}
 */
async function tiebaBindActorMiddleware(req, res, next) {
    req.tiebaActorHandle = null;
    req.tiebaActorUser = null;
    try {
        if (req.user?.profile?.handle) {
            req.tiebaActorHandle = String(req.user.profile.handle).trim();
            req.tiebaActorUser = req.user.profile;
            return next();
        }
        const tok = String(req.headers['x-eu-tieba-api'] || '').trim();
        if (tok) {
            const handle = getHandleFromEuTiebaApiToken(tok);
            if (handle) {
                /** @type {import('../users.js').User | undefined} */
                const user = await storage.getItem(toKey(handle));
                if (user && user.enabled !== false) {
                    req.tiebaActorHandle = handle;
                    req.tiebaActorUser = user;
                }
            }
        }
        return next();
    } catch (e) {
        return next(e);
    }
}

/** 灌水吧配图：免登录可读（挂载在 requireLogin 之前），仅允许 DATA_ROOT/eu-tieba-media 下白名单文件名。 */
router.get('/media/:filename', (req, res) => {
    const fn = String(req.params.filename || '').trim();
    if (!TIEBA_MEDIA_FILENAME_RE.test(fn)) {
        return res.sendStatus(404);
    }
    const directory = tiebaMediaDirectory();
    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch {
        return res.sendStatus(500);
    }
    const fullPath = path.join(directory, fn);
    if (!isPathUnderParent(directory, path.resolve(fullPath))) {
        return res.sendStatus(403);
    }
    if (!fs.existsSync(fullPath)) {
        return res.sendStatus(404);
    }
    try {
        invalidateFirefoxCache(fn, req, res);
        return res.sendFile(fn, { root: directory });
    } catch (e) {
        console.error('[eu-tieba] GET /media', e);
        return res.sendStatus(500);
    }
});

/** 灌水区用户头像：匿名可读，仅提供 eu-tieba-avatars 下白名单文件名。 */
router.get('/avatar/:handle', (req, res) => {
    let raw = String(req.params.handle || '').trim();
    if (raw.toLowerCase().endsWith('.jpg')) {
        raw = raw.slice(0, -4);
    }
    const slug = tiebaAvatarSlug(raw);
    if (!slug) {
        return res.sendStatus(404);
    }
    const fn = `${slug}.jpg`;
    const directory = tiebaAvatarsDirectory();
    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch {
        return res.sendStatus(500);
    }
    const fullPath = path.join(directory, fn);
    if (!isPathUnderParent(directory, path.resolve(fullPath))) {
        return res.sendStatus(403);
    }
    if (!fs.existsSync(fullPath)) {
        return res.sendStatus(404);
    }
    try {
        invalidateFirefoxCache(fn, req, res);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(fn, { root: directory });
    } catch (e) {
        console.error('[eu-tieba] GET /avatar', e);
        return res.sendStatus(500);
    }
});

router.post('/auth/session', async (req, res) => {
    try {
        if (!getConfigValue('enableUserAccounts', false, 'boolean')) {
            return res.status(403).json({ error: '未开启多用户时不签发灌水区独立令牌；单用户模式请直接使用页面登录。' });
        }
        const ip = getIpFromRequest(req);
        await tiebaAuthLimiter.consume(ip);
        const rawHandle = req.body?.handle ?? req.body?.username;
        const password = req.body?.password;
        const handle = String(rawHandle || '').trim().toLowerCase();
        if (!handle || password === undefined || password === null || String(password) === '') {
            return res.status(400).json({ error: '缺少 handle 或 password' });
        }
        /** @type {import('../users.js').User | undefined} */
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return res.status(403).json({ error: '账号或密码不正确' });
        }
        if (!user.enabled) {
            return res.status(403).json({ error: '账号已禁用' });
        }
        if (user.password && user.password !== getPasswordHash(String(password), user.salt)) {
            return res.status(403).json({ error: '账号或密码不正确' });
        }
        await tiebaAuthLimiter.delete(ip);
        const { token, expiresAt } = issueEuTiebaApiToken(handle);
        return res.json({ tiebaApiToken: token, expiresAt, handle });
    } catch (e) {
        if (e instanceof RateLimiterRes) {
            return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
        }
        console.error('[eu-tieba] POST /auth/session', e);
        return res.status(500).json({ error: '签发令牌失败' });
    }
});

router.post('/auth/logout', (req, res) => {
    const tok = String(req.headers['x-eu-tieba-api'] || req.body?.tiebaApiToken || '').trim();
    if (tok) {
        revokeEuTiebaApiToken(tok);
    }
    return res.json({ ok: true });
});

router.use(tiebaBindActorMiddleware);

router.get('/session', (req, res) => {
    const handle = req.tiebaActorHandle ?? null;
    const profileNameRaw = req.tiebaActorUser?.name;
    const profileName =
        typeof profileNameRaw === 'string' && profileNameRaw.trim()
            ? sanitizeAuthorDisplayName(profileNameRaw, 120)
            : null;
    res.json({
        loggedIn: Boolean(handle),
        handle: handle || null,
        profileName,
        canModerate: canModerate(req),
    });
});

router.get('/threads', async (req, res) => {
    try {
        await queueBoard(async () => {
            const data = loadBoardSync();
            const threads = data.threads.map((t) => {
                const replies = Array.isArray(t.replies) ? t.replies : [];
                const lastReply = replies.length ? replies[replies.length - 1].createdAt : null;
                const lastActivityAt = lastReply || t.createdAt || 0;
                const content = typeof t.content === 'string' ? t.content : '';
                return {
                    id: t.id,
                    title: t.title,
                    authorHandle: t.authorHandle,
                    authorDisplayName: tiebaStoredDisplayLabel(t.authorHandle, t.authorDisplayName),
                    createdAt: t.createdAt,
                    replyCount: replies.length,
                    lastActivityAt,
                    snippet: plainSnippetFromContent(content),
                    thumbUrl: extractFirstImageUrl(content),
                };
            });
            threads.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
            res.json({ threads });
        });
    } catch (e) {
        console.error('[eu-tieba] GET /threads', e);
        res.status(500).json({ error: '加载主题列表失败' });
    }
});

router.get('/thread/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!THREAD_ID_RE.test(id)) {
        return res.status(400).json({ error: '无效的主题 ID' });
    }
    try {
        await queueBoard(async () => {
            const data = loadBoardSync();
            const thread = data.threads.find((x) => x.id === id);
            if (!thread) {
                return res.status(404).json({ error: '主题不存在' });
            }
            return res.json({ thread: normalizeThread(thread) });
        });
    } catch (e) {
        console.error('[eu-tieba] GET /thread', e);
        res.status(500).json({ error: '加载主题失败' });
    }
});

router.post('/thread', async (req, res) => {
    const handle = requireTiebaActor(req, res);
    if (!handle) {
        return;
    }
    const title = sanitizeTitle(req.body?.title);
    const content = normalizeTiebaContentLocalhostMediaUrls(sanitizeBody(req.body?.content, 16000));
    if (!title || !content) {
        return res.status(400).json({ error: '标题与正文不能为空' });
    }
    try {
        await queueBoard(async () => {
            const data = loadBoardSync();
            const thread = {
                id: newId('t'),
                title,
                content,
                authorHandle: handle,
                authorDisplayName: resolveAuthorDisplayName(req, req.body?.authorDisplayName, handle),
                createdAt: Date.now(),
                replies: [],
            };
            data.threads.push(thread);
            saveBoardSync(data);
            res.json({ thread: normalizeThread(thread) });
        });
    } catch (e) {
        console.error('[eu-tieba] POST /thread', e);
        res.status(500).json({ error: '发帖失败' });
    }
});

router.post('/reply', async (req, res) => {
    const handle = requireTiebaActor(req, res);
    if (!handle) {
        return;
    }
    const threadId = String(req.body?.threadId || '').trim();
    const content = normalizeTiebaContentLocalhostMediaUrls(sanitizeBody(req.body?.content, 8000));
    const replyQuote = sanitizeBody(req.body?.replyQuote, 2000);
    if (!THREAD_ID_RE.test(threadId)) {
        return res.status(400).json({ error: '无效的主题' });
    }
    if (!content) {
        return res.status(400).json({ error: '回复不能为空' });
    }
    try {
        await queueBoard(async () => {
            const data = loadBoardSync();
            const thread = data.threads.find((x) => x.id === threadId);
            if (!thread) {
                return res.status(404).json({ error: '主题不存在' });
            }
            if (!Array.isArray(thread.replies)) {
                thread.replies = [];
            }
            const reply = {
                id: newId('r'),
                authorHandle: handle,
                authorDisplayName: resolveAuthorDisplayName(req, req.body?.authorDisplayName, handle),
                content,
                createdAt: Date.now(),
            };
            if (replyQuote) {
                reply.replyQuote = replyQuote;
            }
            thread.replies.push(reply);
            saveBoardSync(data);
            res.json({ thread: normalizeThread(thread) });
        });
    } catch (e) {
        console.error('[eu-tieba] POST /reply', e);
        res.status(500).json({ error: '回复失败' });
    }
});

router.delete('/thread/:id', async (req, res) => {
    if (!canDeleteTiebaContent(req)) {
        return res.status(403).json({ error: tiebaDeleteForbiddenDetail(req) });
    }
    const id = String(req.params.id || '').trim();
    if (!THREAD_ID_RE.test(id)) {
        return res.status(400).json({ error: '无效的主题 ID' });
    }
    try {
        await queueBoard(async () => {
            const data = loadBoardSync();
            const idx = data.threads.findIndex((x) => x.id === id);
            if (idx < 0) {
                return res.status(404).json({ error: '主题不存在' });
            }
            data.threads.splice(idx, 1);
            saveBoardSync(data);
            res.json({ ok: true });
        });
    } catch (e) {
        console.error('[eu-tieba] DELETE /thread', e);
        res.status(500).json({ error: '删除失败' });
    }
});

router.delete('/reply', async (req, res) => {
    if (!canDeleteTiebaContent(req)) {
        return res.status(403).json({ error: tiebaDeleteForbiddenDetail(req) });
    }
    const threadId = String(req.body?.threadId || '').trim();
    const replyId = String(req.body?.replyId || '').trim();
    if (!THREAD_ID_RE.test(threadId) || !REPLY_ID_RE.test(replyId)) {
        return res.status(400).json({ error: '无效的参数' });
    }
    try {
        await queueBoard(async () => {
            const data = loadBoardSync();
            const thread = data.threads.find((x) => x.id === threadId);
            if (!thread) {
                return res.status(404).json({ error: '主题不存在' });
            }
            if (!Array.isArray(thread.replies)) {
                thread.replies = [];
            }
            const ridx = thread.replies.findIndex((x) => x.id === replyId);
            if (ridx < 0) {
                return res.status(404).json({ error: '楼层不存在' });
            }
            thread.replies.splice(ridx, 1);
            saveBoardSync(data);
            res.json({ thread: normalizeThread(thread) });
        });
    } catch (e) {
        console.error('[eu-tieba] DELETE /reply', e);
        res.status(500).json({ error: '删除楼层失败' });
    }
});

/** 网页展示用：长边像素上限（与常见 CMS 大图规格一致）。 */
const TIEBA_UPLOAD_MAX_LONG_EDGE = 1600;
/** JPEG 输出质量（体积与观感折中）。 */
const TIEBA_UPLOAD_JPEG_QUALITY = 82;
/** 解码后像素上限，防止恶意大图拖垮进程。 */
const TIEBA_UPLOAD_MAX_PIXELS = 24_000_000;
/** Base64 原始长度上限（约 9MB 二进制）。 */
const TIEBA_UPLOAD_MAX_B64_CHARS = 12_000_000;

router.post('/upload-image', async (req, res) => {
    const handle = requireTiebaActor(req, res);
    if (!handle) {
        return;
    }
    const rawB64 = req.body?.image;
    if (!rawB64 || typeof rawB64 !== 'string') {
        return res.status(400).json({ error: '缺少图片数据（base64）' });
    }
    const trimmed = rawB64.trim();
    if (trimmed.length > TIEBA_UPLOAD_MAX_B64_CHARS) {
        return res.status(400).json({ error: '图片数据过大，请选择较小的文件' });
    }
    let buffer;
    try {
        buffer = Buffer.from(trimmed, 'base64');
    } catch {
        return res.status(400).json({ error: '图片数据不是有效的 Base64' });
    }
    if (buffer.length < 32 || buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: '图片文件无效或过大' });
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return res.status(400).json({ error: '暂不支持 GIF，请使用 JPG / PNG / WebP 静态图' });
    }

    try {
        const image = await Jimp.read(buffer);
        const iw = image.bitmap.width;
        const ih = image.bitmap.height;
        if (!iw || !ih || iw * ih > TIEBA_UPLOAD_MAX_PIXELS) {
            return res.status(400).json({ error: '图片尺寸过大' });
        }
        const longEdge = Math.max(iw, ih);
        if (longEdge > TIEBA_UPLOAD_MAX_LONG_EDGE) {
            const scale = TIEBA_UPLOAD_MAX_LONG_EDGE / longEdge;
            const nw = Math.max(1, Math.round(iw * scale));
            const nh = Math.max(1, Math.round(ih * scale));
            image.resize({ w: nw, h: nh, mode: ResizeStrategy.BILINEAR });
        }
        const outBuf = await image.getBuffer(JimpMime.jpeg, { quality: TIEBA_UPLOAD_JPEG_QUALITY, jpegColorSpace: 'ycbcr' });

        const dir = tiebaMediaDirectory();
        fs.mkdirSync(dir, { recursive: true });
        const filename = sanitize(`eu_tieba_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`);
        const pathToNewFile = path.join(dir, filename);
        writeFileAtomicSync(pathToNewFile, new Uint8Array(outBuf));
        const publicPath = `/api/eu/tieba/media/${filename}`;
        console.info('[eu-tieba] upload-image', handle, publicPath, `${iw}x${ih}->${image.bitmap.width}x${image.bitmap.height}`);
        res.json({ path: publicPath });
    } catch (e) {
        console.error('[eu-tieba] POST /upload-image', e);
        res.status(400).json({ error: '无法处理该图片，请换一张 JPG/PNG/WebP 试试' });
    }
});

/** 灌水区展示用头像：写入当前酒馆登录用户的 slug 对应文件。 */
const TIEBA_AVATAR_MAX_LONG_EDGE = 512;
const TIEBA_AVATAR_JPEG_QUALITY = 88;
const TIEBA_AVATAR_MAX_PIXELS = 8_000_000;
const TIEBA_AVATAR_MAX_B64_CHARS = 2_800_000;

router.post('/avatar', async (req, res) => {
    const handle = requireTiebaActor(req, res);
    if (!handle) {
        return;
    }
    const slug = tiebaAvatarSlug(handle);
    if (!slug) {
        return res.status(400).json({ error: '当前账号标识无法用于灌水区头像文件名' });
    }
    const rawB64 = req.body?.image;
    if (!rawB64 || typeof rawB64 !== 'string') {
        return res.status(400).json({ error: '缺少图片数据（base64）' });
    }
    const trimmed = rawB64.trim();
    if (trimmed.length > TIEBA_AVATAR_MAX_B64_CHARS) {
        return res.status(400).json({ error: '图片数据过大' });
    }
    let buffer;
    try {
        buffer = Buffer.from(trimmed, 'base64');
    } catch {
        return res.status(400).json({ error: '图片数据不是有效的 Base64' });
    }
    if (buffer.length < 32 || buffer.length > 3 * 1024 * 1024) {
        return res.status(400).json({ error: '图片文件无效或过大' });
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return res.status(400).json({ error: '暂不支持 GIF' });
    }

    try {
        const image = await Jimp.read(buffer);
        const iw = image.bitmap.width;
        const ih = image.bitmap.height;
        if (!iw || !ih || iw * ih > TIEBA_AVATAR_MAX_PIXELS) {
            return res.status(400).json({ error: '图片尺寸过大' });
        }
        const longEdge = Math.max(iw, ih);
        if (longEdge > TIEBA_AVATAR_MAX_LONG_EDGE) {
            const scale = TIEBA_AVATAR_MAX_LONG_EDGE / longEdge;
            const nw = Math.max(1, Math.round(iw * scale));
            const nh = Math.max(1, Math.round(ih * scale));
            image.resize({ w: nw, h: nh, mode: ResizeStrategy.BILINEAR });
        }
        const outBuf = await image.getBuffer(JimpMime.jpeg, { quality: TIEBA_AVATAR_JPEG_QUALITY, jpegColorSpace: 'ycbcr' });
        const dir = tiebaAvatarsDirectory();
        fs.mkdirSync(dir, { recursive: true });
        const fn = `${slug}.jpg`;
        const pathToNewFile = path.join(dir, fn);
        writeFileAtomicSync(pathToNewFile, new Uint8Array(outBuf));
        const publicPath = `/api/eu/tieba/avatar/${slug}`;
        console.info('[eu-tieba] POST /avatar', handle, publicPath);
        res.json({ ok: true, url: publicPath });
    } catch (e) {
        console.error('[eu-tieba] POST /avatar', e);
        res.status(400).json({ error: '无法处理该图片' });
    }
});

router.delete('/avatar', (req, res) => {
    const handle = requireTiebaActor(req, res);
    if (!handle) {
        return;
    }
    const slug = tiebaAvatarSlug(handle);
    if (!slug) {
        return res.status(400).json({ error: '无效账号标识' });
    }
    try {
        const directory = tiebaAvatarsDirectory();
        const fn = `${slug}.jpg`;
        const fullPath = path.join(directory, fn);
        if (isPathUnderParent(directory, path.resolve(fullPath)) && fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('[eu-tieba] DELETE /avatar', e);
        res.status(500).json({ error: '删除失败' });
    }
});
