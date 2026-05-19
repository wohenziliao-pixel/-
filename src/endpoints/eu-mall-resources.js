import fs from 'node:fs';
import path from 'node:path';
import storage from 'node-persist';
import express from 'express';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import sanitize from 'sanitize-filename';
import { ResizeStrategy } from '@jimp/plugin-resize';
import { Jimp, JimpMime } from '../jimp.js';
import { isPathUnderParent } from '../util.js';
import { getAllUserHandles, getUserDirectories } from '../users.js';
import { isEuDevSuperUser } from './eu-dev-mode.js';
import { appendEuAuditLog, EU_ROLES, euRoleViewForRequest, getEuRoleSet, hasAnyEuRole, hasEuRole } from './eu-rbac.js';
import {
    EU_LLM_TAG_DEFAULT_MODEL,
    applyAdultToTagList,
    buildMallListDescFromRaw,
    buildMallResourcePreview,
    gatherInferTextFromCard,
    inferStorybookAdultWithXai,
    inferStorybookTagsWithXai,
    readXaiKeyForUser,
} from './eu-storybook-llm-tags.js';

/**
 * 商城公用区写权限：网站管理者（super.admin）或商城授权者（mall.publisher）可改删任意公共资源。
 * 普通用户无上架权限，不可写商城（见 requireMallPublisher）。
 */
function assertCanModifyMallResource(req, res, _existingOwner) {
    const actor = req.user?.profile;
    if (!actor) {
        res.status(401).json({ error: '未登录' });
        return false;
    }
    if (isEuDevSuperUser(req)) {
        return true;
    }
    if (hasAnyEuRole(actor, [EU_ROLES.SUPER_ADMIN, EU_ROLES.MALL_PUBLISHER])) {
        return true;
    }
    res.status(403).json({ error: '需要商城管理权限（mall.publisher）或网站管理者权限（super.admin）' });
    return false;
}

export const router = express.Router();

const INDEX_KEY = 'eu:mall:index:v1';
const VERSION = 1;
const PAGE_SIZE_MAX = 200;
const PUBLIC_ROOT = () => path.join(globalThis.DATA_ROOT, 'eu-public');
const MALL_ROOT = () => path.join(PUBLIC_ROOT(), 'mall');
const RESOURCE_DIR = () => path.join(MALL_ROOT(), 'resources');
const THUMB_DIR = () => path.join(MALL_ROOT(), 'thumbs');
const MIGRATION_DIR = () => path.join(MALL_ROOT(), 'migration');

function ensureMallDirs() {
    fs.mkdirSync(RESOURCE_DIR(), { recursive: true });
    fs.mkdirSync(THUMB_DIR(), { recursive: true });
    fs.mkdirSync(MIGRATION_DIR(), { recursive: true });
}

function normalizeType(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'setting' || s === 'settings') return 'setting';
    if (s === 'character' || s === 'card') return 'character';
    return 'storybook';
}

function normalizeTags(v) {
    const arr = Array.isArray(v) ? v : [v];
    return [...new Set(arr.flatMap((x) => String(x || '').split(/[;；,，、\n\r]+/).map((t) => t.trim())).filter(Boolean))];
}

/** 上架查重：标题/文件名去扩展名、空白、大小写后比较（同类型内）。 */
function normalizeUploadDedupKey(name) {
    let s = String(name || '').trim();
    if (!s) return '';
    s = s.replace(/\.(json|png|webp|jpe?g)$/i, '');
    return s.replace(/\s+/g, ' ').toLowerCase();
}

async function findDuplicateMallResourceByTitle(type, title) {
    const key = normalizeUploadDedupKey(title);
    if (!key) return null;
    const want = normalizeType(type);
    const index = await readIndex();
    return index.find((row) => normalizeType(row.type) === want && normalizeUploadDedupKey(row.title) === key) || null;
}

async function readIndex() {
    const list = await storage.getItem(INDEX_KEY);
    return Array.isArray(list) ? list : [];
}

async function writeIndex(index) {
    await storage.setItem(INDEX_KEY, Array.isArray(index) ? index : []);
}

/** 列表 API 用：截断简介，丢弃误写入索引的 JSON/技术块。 */
function capMallListDesc(desc) {
    let s = String(desc || '').trim();
    if (!s) return '';
    const head = s.slice(0, 600);
    if (/^\s*[\[{]/.test(head) || /"findRegex"|"chineseName"|"alternate_greetings"|"extensions"\s*:/.test(head)) {
        return '';
    }
    if (s.length > 220) return `${s.slice(0, 220).trim()}…`;
    return s;
}

const EU_ADULT_SYNONYM_TAG_RE = /^(成人内容|18\+|18禁|R-?18|NSFW)$/i;

/** 全年龄过滤：adultContent 或成人向展示标签（与列表 18+ 角标一致）。 */
function rowIsAdultForSfw(row) {
    if (row?.adultContent === true) return true;
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    for (const t of tags) {
        const s = String(t || '').trim();
        if (!s || /^全年龄$/i.test(s)) continue;
        if (EU_ADULT_SYNONYM_TAG_RE.test(s)) return true;
        if (/成人向|工口|露骨色情/.test(s)) return true;
    }
    return false;
}

function rowHasFemaleOrientationTag(row) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    return tags.some((t) => /女性向/.test(String(t || '').trim()));
}

/** orientation: female | male | all；无「女性向」标签的条目归男性向。 */
function rowPassesOrientationFilter(row, orientation) {
    const o = String(orientation || '').trim().toLowerCase();
    if (!o || o === 'all') return true;
    const isFemale = rowHasFemaleOrientationTag(row);
    if (o === 'female' || o === '女性向') return isFemale;
    if (o === 'male' || o === '男性向') return !isFemale;
    return true;
}

function sanitizeMetaRow(row) {
    let thumb = String(row.thumb || '').trim() || null;
    /** 索引里若误存了发布者私有路径，其他用户拉清单会导图到 /user/images → 全 404；只保留公共 thumb URL。 */
    if (thumb && (/^\/user\//i.test(thumb) || /^user\/images\//i.test(thumb))) {
        thumb = null;
    }
    return {
        id: String(row.id || '').trim(),
        type: normalizeType(row.type),
        title: String(row.title || '').trim(),
        desc: String(row.desc || '').trim(),
        tags: normalizeTags(row.tags),
        thumb,
        adultContent: row.adultContent === true,
        owner: String(row.owner || '').trim() || 'unknown',
        updatedAt: Number(row.updatedAt) || Date.now(),
        createdAt: Number(row.createdAt) || Date.now(),
        version: Number(row.version) || VERSION,
    };
}

function resourceFile(id) {
    return path.join(RESOURCE_DIR(), `${sanitize(id)}.json`);
}

function publicThumbPath(filename) {
    return `/api/eu/mall/thumbs/${encodeURIComponent(filename)}`;
}

/** 清单里 thumb 为空但磁盘已有缩略图时，补全 URL（避免前端导图只有 id 没有图）。 */
function thumbUrlForIndexRow(row) {
    const id = String(row?.id || '').trim();
    if (!id) return null;
    const existing = row?.thumb && String(row.thumb).trim();
    if (existing) return existing;
    const fn = `${sanitize(id)}.jpg`;
    const full = path.join(THUMB_DIR(), fn);
    if (fs.existsSync(full)) return publicThumbPath(fn);
    return null;
}

/**
 * 将资源 JSON 里的封面字段规范为相对用户根目录的路径键 `user/images/...`，供读盘生成公共缩略图。
 * 历史数据常见：`http://127.0.0.1:8xxx/user/images/...`（仅 strip 后才会命中原逻辑，否则 maybePersistThumb 直接 return null → 永无 thumb）。
 */
function mallImgSrcToUserImagesRelKey(src) {
    let s = String(src || '').trim();
    if (!s || /^data:image\//i.test(s)) return '';
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            const h = String(u.hostname || '').toLowerCase();
            if (h !== '127.0.0.1' && h !== 'localhost' && h !== '0.0.0.0' && h !== '[::1]') return '';
            let pathname = u.pathname || '';
            if (!pathname.startsWith('/')) pathname = `/${pathname}`;
            s = pathname;
        } catch {
            return '';
        }
    }
    s = s.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s.startsWith('user/images/')) return '';
    return s;
}

/**
 * 生成公共缩略图并返回 `/api/eu/mall/thumbs/...`。
 * - 支持 dataURL（上架时直接贴图）
 * - 支持发布者已迁到本地的 `/user/images/...`（否则索引里 thumb 为空、JSON 里仍是他人无法访问的私有路径 → 404）
 */
async function maybePersistThumb(src, id, req) {
    const s = String(src || '').trim();
    if (!s) return null;
    let image = null;
    if (/^data:image\//i.test(s)) {
        const base64 = s.split(',')[1] || '';
        if (!base64) return null;
        const buf = Buffer.from(base64, 'base64');
        if (buf.length < 8) return null;
        image = await Jimp.read(buf);
    } else if (req?.user?.directories?.root && req?.user?.directories?.userImages) {
        const rel = mallImgSrcToUserImagesRelKey(s);
        if (!rel.startsWith('user/images/')) return null;
        const norm = rel.split('/').join(path.sep);
        const fullPath = path.join(req.user.directories.root, norm);
        const userImgRoot = req.user.directories.userImages;
        if (!isPathUnderParent(userImgRoot, path.resolve(fullPath))) return null;
        if (!fs.existsSync(fullPath)) return null;
        try {
            image = await Jimp.read(fullPath);
        } catch {
            return null;
        }
    } else {
        return null;
    }
    const longEdge = Math.max(image.bitmap.width, image.bitmap.height);
    if (longEdge > 360) {
        const scale = 360 / longEdge;
        image.resize({
            w: Math.max(1, Math.round(image.bitmap.width * scale)),
            h: Math.max(1, Math.round(image.bitmap.height * scale)),
            mode: ResizeStrategy.BILINEAR,
        });
    }
    const out = await image.getBuffer(JimpMime.jpeg, { quality: 78, jpegColorSpace: 'ycbcr' });
    const fn = `${sanitize(id)}.jpg`;
    writeFileAtomicSync(path.join(THUMB_DIR(), fn), new Uint8Array(out));
    return publicThumbPath(fn);
}

function requireMallPublisher(req, res) {
    if (isEuDevSuperUser(req)) {
        return true;
    }
    const user = req.user?.profile;
    if (!user || !hasAnyEuRole(user, [EU_ROLES.MALL_PUBLISHER, EU_ROLES.SUPER_ADMIN])) {
        res.status(403).json({ error: '需要 mall.publisher 权限' });
        return false;
    }
    return true;
}

router.get('/capabilities', (req, res) => {
    const user = req.user?.profile;
    const view = euRoleViewForRequest(req);
    const devSuper = isEuDevSuperUser(req);
    return res.json({
        canPublish: devSuper || hasAnyEuRole(user, [EU_ROLES.MALL_PUBLISHER, EU_ROLES.SUPER_ADMIN]),
        canModerateTieba: devSuper || hasAnyEuRole(user, [EU_ROLES.TIEBA_MODERATOR, EU_ROLES.SUPER_ADMIN]),
        isSuperAdmin: devSuper || hasEuRole(user, EU_ROLES.SUPER_ADMIN),
        isDevMode: devSuper,
        isStAdmin: user?.admin === true,
        handle: view.handle,
        roles: user ? [...getEuRoleSet(user)].sort() : [],
    });
});

router.get('/thumbs/:filename', (req, res) => {
    const fn = String(req.params.filename || '').trim();
    if (!/^[a-zA-Z0-9._-]+\.jpg$/i.test(fn)) return res.sendStatus(404);
    ensureMallDirs();
    const fullPath = path.join(THUMB_DIR(), fn);
    if (!fs.existsSync(fullPath)) return res.sendStatus(404);
    return res.sendFile(fn, { root: THUMB_DIR() });
});

router.post('/llm-tags/preflight', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    const apiKey = readXaiKeyForUser(req.user?.directories);
    if (!apiKey) {
        return res.status(400).json({ ok: false, error: '未在酒馆 API 设置中配置 xAI 密钥（api_key_xai）' });
    }
    return res.json({ ok: true, model: EU_LLM_TAG_DEFAULT_MODEL });
});

/** 导入草稿等：仅推断标签，不写磁盘。 */
router.post('/llm-tags/infer', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = body.raw && typeof body.raw === 'object' ? body.raw : body;
    const title = String(body.title || raw?.data?.name || raw?.name || '').trim();
    const hay = gatherInferTextFromCard(raw);
    if (!hay.trim()) {
        return res.status(400).json({ error: '正文过短，无法归纳标签' });
    }
    try {
        const apiKey = readXaiKeyForUser(req.user?.directories);
        const model = String(body.model || EU_LLM_TAG_DEFAULT_MODEL).trim();
        const out = await inferStorybookTagsWithXai(apiKey, { model, title, hay });
        return res.json({ ok: true, tags: out.tags, adultContent: out.adultContent === true });
    } catch (e) {
        return res.status(502).json({ error: e?.message || 'AI 归纳失败' });
    }
});

/** 公共商城单本：AI 归纳标签并写回 resources JSON + 索引。 */
router.post('/resource/:id/llm-tags', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    ensureMallDirs();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const fp = resourceFile(id);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
    let prev = {};
    try {
        prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
        return res.status(500).json({ error: 'resource read failed' });
    }
    if (!assertCanModifyMallResource(req, res, String(prev.owner || '').trim())) return;
    if (normalizeType(prev.type) !== 'storybook') {
        return res.status(400).json({ error: '仅支持故事书类型' });
    }
    const raw = prev.raw && typeof prev.raw === 'object' ? prev.raw : prev;
    const title = String(prev.title || raw?.data?.name || raw?.name || '').trim();
    const hay = gatherInferTextFromCard(raw);
    if (!hay.trim()) {
        return res.status(400).json({ error: '正文过短，无法归纳标签' });
    }
    try {
        const apiKey = readXaiKeyForUser(req.user?.directories);
        const model = String(req.body?.model || EU_LLM_TAG_DEFAULT_MODEL).trim();
        const out = await inferStorybookTagsWithXai(apiKey, { model, title, hay });
        const now = Date.now();
        const adultContent = out.adultContent === true;
        const listDesc = buildMallListDescFromRaw(raw);
        const payload = {
            ...prev,
            tags: applyAdultToTagList(out.tags, adultContent),
            adultContent,
            adultContentSource: 'llm',
            adultClassifiedAt: now,
            updatedAt: now,
            ...(listDesc ? { desc: listDesc } : {}),
        };
        const finalDesc = String(listDesc || payload.desc || '').trim();
        const descOk = !needsMallDescRepair(finalDesc);
        writeFileAtomicSync(fp, JSON.stringify(payload), 'utf8');
        const prevIndexRow = (await readIndex()).find((x) => String(x.id || '').trim() === id);
        let thumb = prevIndexRow?.thumb && String(prevIndexRow.thumb).trim() ? prevIndexRow.thumb : null;
        const thumbFn = `${sanitize(id)}.jpg`;
        if (fs.existsSync(path.join(THUMB_DIR(), thumbFn))) {
            thumb = publicThumbPath(thumbFn);
        }
        const index = (await readIndex()).filter((x) => String(x.id || '').trim() !== id);
        index.push(sanitizeMetaRow({
            id,
            type: payload.type,
            title: payload.title,
            desc: finalDesc,
            tags: payload.tags,
            thumb,
            adultContent: payload.adultContent,
            owner: payload.owner,
            updatedAt: now,
            createdAt: Number(payload.createdAt) || now,
            version: VERSION,
        }));
        await writeIndex(index);
        appendEuAuditLog(req.user?.profile?.handle, 'mall_resource_llm_tags', { id, tagCount: out.tags.length, descOk });
        return res.json({
            ok: true,
            id,
            tags: out.tags,
            adultContent: payload.adultContent,
            adultContentSource: 'llm',
            desc: finalDesc,
            descOk,
        });
    } catch (e) {
        return res.status(502).json({ error: e?.message || 'AI 归纳失败' });
    }
});

/** 公共商城单本：仅 AI 重判成人/全年龄（读正文，不依赖旧 tags 对齐）。 */
router.post('/resource/:id/llm-adult', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    ensureMallDirs();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const fp = resourceFile(id);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
    let prev = {};
    try {
        prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
        return res.status(500).json({ error: 'resource read failed' });
    }
    if (!assertCanModifyMallResource(req, res, String(prev.owner || '').trim())) return;
    if (normalizeType(prev.type) !== 'storybook') {
        return res.status(400).json({ error: '仅支持故事书类型' });
    }
    const raw = prev.raw && typeof prev.raw === 'object' ? prev.raw : prev;
    const title = String(prev.title || raw?.data?.name || raw?.name || '').trim();
    const hay = gatherInferTextFromCard(raw);
    if (!hay.trim()) {
        return res.status(400).json({ error: '正文过短，无法 AI 分级' });
    }
    try {
        const apiKey = readXaiKeyForUser(req.user?.directories);
        const model = String(req.body?.model || EU_LLM_TAG_DEFAULT_MODEL).trim();
        const out = await inferStorybookAdultWithXai(apiKey, { model, title, hay });
        const now = Date.now();
        const adultContent = out.adultContent === true;
        const prevTags = normalizeTags(prev.tags);
        const listDesc = buildMallListDescFromRaw(raw);
        const payload = {
            ...prev,
            tags: applyAdultToTagList(prevTags, adultContent),
            adultContent,
            adultContentSource: 'llm',
            adultClassifiedAt: now,
            updatedAt: now,
            ...(listDesc ? { desc: listDesc } : {}),
        };
        writeFileAtomicSync(fp, JSON.stringify(payload), 'utf8');
        const prevIndexRow = (await readIndex()).find((x) => String(x.id || '').trim() === id);
        let thumb = prevIndexRow?.thumb && String(prevIndexRow.thumb).trim() ? prevIndexRow.thumb : null;
        const thumbFn = `${sanitize(id)}.jpg`;
        if (fs.existsSync(path.join(THUMB_DIR(), thumbFn))) {
            thumb = publicThumbPath(thumbFn);
        }
        const index = (await readIndex()).filter((x) => String(x.id || '').trim() !== id);
        index.push(sanitizeMetaRow({
            id,
            type: payload.type,
            title: payload.title,
            desc: listDesc || payload.desc,
            tags: payload.tags,
            thumb,
            adultContent: payload.adultContent,
            owner: payload.owner,
            updatedAt: now,
            createdAt: Number(payload.createdAt) || now,
            version: VERSION,
        }));
        await writeIndex(index);
        appendEuAuditLog(req.user?.profile?.handle, 'mall_resource_llm_adult', { id, adultContent, reason: out.reason || '' });
        return res.json({ ok: true, id, adultContent, reason: out.reason || '', adultContentSource: 'llm' });
    } catch (e) {
        return res.status(502).json({ error: e?.message || 'AI 分级失败' });
    }
});

function needsMallDescRepair(desc) {
    const d = String(desc || '').trim();
    if (!d || d === '暂无简介') return true;
    if (/^从文件导入$/i.test(d) || /^PNG 导入/i.test(d)) return true;
    if (/^(?:SYSTEM|ANCHORING|HIGHEST_[A-Z_]+)\s*[:：]/im.test(d)) return true;
    return /KIMETSU_HUD|HUD_START|findRegex|角色需要更新状态栏|严格遵守以下格式|原文件.*数据/i.test(d);
}

/** 批量修复公共商城简介：从 first_mes / HTML 开场白生成 desc，同步索引。 */
router.post('/repair-descs', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    ensureMallDirs();
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const index = await readIndex();
    const indexById = new Map(index.map((r) => [String(r.id || '').trim(), r]));
    for (const fn of fs.readdirSync(RESOURCE_DIR()).filter((f) => f.endsWith('.json'))) {
        scanned += 1;
        const fp = path.join(RESOURCE_DIR(), fn);
        let j;
        try {
            j = JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch {
            failed += 1;
            continue;
        }
        if (!needsMallDescRepair(j.desc)) {
            skipped += 1;
            continue;
        }
        const raw = j.raw && typeof j.raw === 'object' ? j.raw : j;
        const built = buildMallListDescFromRaw(raw);
        if (!built) {
            failed += 1;
            continue;
        }
        const now = Date.now();
        j.desc = built;
        j.updatedAt = now;
        writeFileAtomicSync(fp, JSON.stringify(j), 'utf8');
        const id = String(j.id || fn.replace(/\.json$/i, '')).trim();
        const prev = indexById.get(id) || {};
        indexById.set(id, { ...prev, id, desc: built, updatedAt: now });
        updated += 1;
    }
    await writeIndex([...indexById.values()].map(sanitizeMetaRow));
    appendEuAuditLog(req.user?.profile?.handle, 'mall_repair_descs', { scanned, updated, skipped, failed });
    return res.json({ ok: true, scanned, updated, skipped, failed });
});

/** 商城资源在列表/详情中是否等同「暂无简介」（含从文件导入、无法从开场白生成等）。 */
function resourceHasNoUsableDesc(payload) {
    const raw = payload?.raw && typeof payload.raw === 'object' ? payload.raw : payload;
    const built = buildMallListDescFromRaw(raw);
    const displayDesc = built || String(payload?.desc || '').trim();
    return needsMallDescRepair(displayDesc);
}

/** 批量删除公共商城中简介不可用的故事书（默认 storybook）。body.dryRun=true 仅预览。 */
router.post('/purge-no-desc', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    ensureMallDirs();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const dryRun = body.dryRun === true;
    const typeFilter = normalizeType(body.type || 'storybook');
    let scanned = 0;
    const candidates = [];
    for (const fn of fs.readdirSync(RESOURCE_DIR()).filter((f) => f.endsWith('.json'))) {
        scanned += 1;
        const fp = path.join(RESOURCE_DIR(), fn);
        let j;
        try {
            j = JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch {
            continue;
        }
        if (normalizeType(j.type) !== typeFilter) continue;
        if (!resourceHasNoUsableDesc(j)) continue;
        const id = String(j.id || fn.replace(/\.json$/i, '')).trim();
        if (!id) continue;
        candidates.push({ id, title: String(j.title || '').trim(), desc: String(j.desc || '').trim().slice(0, 80) });
    }
    if (dryRun) {
        return res.json({ ok: true, dryRun: true, scanned, deleteCount: candidates.length, items: candidates.slice(0, 200) });
    }
    const deletedIds = new Set();
    for (const row of candidates) {
        const id = row.id;
        const fp = resourceFile(id);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        const thumbFile = path.join(THUMB_DIR(), `${sanitize(id)}.jpg`);
        if (fs.existsSync(thumbFile)) fs.unlinkSync(thumbFile);
        deletedIds.add(id);
    }
    const index = (await readIndex()).filter((x) => !deletedIds.has(String(x.id || '').trim()));
    await writeIndex(index);
    appendEuAuditLog(req.user?.profile?.handle, 'mall_purge_no_desc', {
        scanned,
        deleted: deletedIds.size,
        type: typeFilter,
    });
    return res.json({
        ok: true,
        dryRun: false,
        scanned,
        deleted: deletedIds.size,
        items: candidates.filter((x) => deletedIds.has(x.id)).slice(0, 200),
    });
});

router.get('/resources', async (req, res) => {
    ensureMallDirs();
    const q = String(req.query.q || '').trim().toLowerCase();
    const type = String(req.query.type || '').trim().toLowerCase();
    const ownerQ = String(req.query.owner || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(PAGE_SIZE_MAX, Number(req.query.pageSize) || 80));
    const index = (await readIndex()).map(sanitizeMetaRow).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    let rows = index;
    if (type && type !== 'all') rows = rows.filter((x) => normalizeType(x.type) === normalizeType(type));
    if (ownerQ) {
        rows = rows.filter((x) => String(x.owner || '').trim().toLowerCase() === ownerQ);
    }
    if (q) {
        rows = rows.filter((x) => `${x.title}\n${x.desc}\n${(x.tags || []).join(' ')}`.toLowerCase().includes(q));
    }
    const sfwOnly = ['1', 'true', 'yes'].includes(String(req.query.sfw || req.query.allAges || '').trim().toLowerCase());
    if (sfwOnly) {
        rows = rows.filter((x) => !rowIsAdultForSfw(x));
    }
    const orientation = String(req.query.orientation || req.query.orient || '').trim();
    if (orientation) {
        rows = rows.filter((x) => rowPassesOrientationFilter(x, orientation));
    }
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map((row) => {
        const r = row;
        const inferred = thumbUrlForIndexRow(r);
        const tags = Array.isArray(r.tags) ? r.tags.slice(0, 12) : [];
        const slim = {
            id: r.id,
            type: r.type,
            title: String(r.title || '').trim().slice(0, 200),
            desc: capMallListDesc(r.desc),
            tags,
            thumb: inferred || r.thumb || null,
            adultContent: r.adultContent === true,
            owner: r.owner,
            updatedAt: Number(r.updatedAt) || 0,
        };
        return slim;
    });
    return res.json({ items, total: rows.length, page, pageSize });
});

/** 全量元数据索引（无 raw/大图），供前端建资料库查询表，体量随条数线性增长、可支撑数千条。 */
router.get('/resources/index-meta', async (req, res) => {
    if (!req.user?.profile) {
        return res.status(401).json({ error: '未登录' });
    }
    ensureMallDirs();
    const index = (await readIndex()).map(sanitizeMetaRow).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    const items = index.map((row) => {
        const inferred = thumbUrlForIndexRow(row);
        return {
            id: String(row.id || '').trim(),
            uid: `public-${String(row.id || '').trim()}`,
            type: row.type,
            title: row.title,
            desc: capMallListDesc(row.desc),
            tags: Array.isArray(row.tags) ? row.tags.slice(0, 12) : [],
            thumb: inferred || row.thumb || null,
            owner: row.owner,
            adultContent: row.adultContent === true,
            updatedAt: Number(row.updatedAt) || 0,
        };
    });
    return res.json({ ok: true, total: items.length, items });
});

/** 导出完整索引（JSON/CSV），便于运营备份与客户侧资料库对接。 */
router.get('/resources/export', async (req, res) => {
    if (!req.user?.profile) {
        return res.status(401).json({ error: '未登录' });
    }
    ensureMallDirs();
    const format = String(req.query.format || 'json').toLowerCase();
    const index = (await readIndex()).map(sanitizeMetaRow).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    const rows = index.map((row) => {
        const inferred = thumbUrlForIndexRow(row);
        return {
            id: String(row.id || '').trim(),
            uid: `public-${String(row.id || '').trim()}`,
            type: row.type,
            title: row.title,
            desc: row.desc,
            tags: Array.isArray(row.tags) ? row.tags : [],
            thumb: inferred || row.thumb || '',
            owner: row.owner,
            adultContent: row.adultContent === true,
            updatedAt: Number(row.updatedAt) || 0,
            createdAt: Number(row.createdAt) || 0,
        };
    });
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
        const esc = (v) => {
            const s = String(v ?? '').replace(/"/g, '""');
            return `"${s}"`;
        };
        const header = 'id,uid,type,title,desc,tags,thumb,owner,adultContent,updatedAt\n';
        const body = rows
            .map((r) =>
                [
                    esc(r.id),
                    esc(r.uid),
                    esc(r.type),
                    esc(r.title),
                    esc(r.desc),
                    esc((r.tags || []).join(';')),
                    esc(r.thumb),
                    esc(r.owner),
                    esc(r.adultContent),
                    esc(r.updatedAt),
                ].join(','),
            )
            .join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="eu-mall-index-${stamp}.csv"`);
        return res.send(`\uFEFF${header}${body}`);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="eu-mall-index-${stamp}.json"`);
    return res.json({ exportedAt: Date.now(), total: rows.length, items: rows });
});

/** 轻量预览：服务端读盘解析 desc + 开场白，不返回整卡 raw（防浏览器 OOM）。 */
router.get('/resource/:id/preview', async (req, res) => {
    if (!req.user?.profile) {
        return res.status(401).json({ error: '未登录' });
    }
    ensureMallDirs();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const fp = resourceFile(id);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
    try {
        const payload = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : payload;
        const { desc, openingPlain } = buildMallResourcePreview(raw, payload);
        return res.json({
            ok: true,
            id,
            uid: `public-${id}`,
            title: String(payload.title || '').trim(),
            desc: desc || '',
            openingPlain: openingPlain || '',
        });
    } catch (e) {
        return res.status(500).json({ error: e?.message || 'preview failed' });
    }
});

router.get('/resource/:id', async (req, res) => {
    ensureMallDirs();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const fp = resourceFile(id);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
    try {
        const payload = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const thumbFn = `${sanitize(id)}.jpg`;
        const thumbDisk = path.join(THUMB_DIR(), thumbFn);
        if (fs.existsSync(thumbDisk)) {
            const pubUrl = publicThumbPath(thumbFn);
            const prevImg = String(payload.img || '');
            payload.img = pubUrl;
            if (prevImg !== pubUrl) {
                writeFileAtomicSync(fp, JSON.stringify(payload), 'utf8');
            }
        } else {
            const owner = String(payload.owner || '').trim();
            const imgSrc = typeof payload.img === 'string' ? payload.img.trim() : '';
            if (owner && owner !== 'unknown' && imgSrc) {
                let synth = null;
                try {
                    const dirs = getUserDirectories(owner);
                    synth = await maybePersistThumb(imgSrc, id, { user: { directories: dirs } });
                } catch {
                    synth = null;
                }
                if (synth) {
                    payload.img = synth;
                    writeFileAtomicSync(fp, JSON.stringify(payload), 'utf8');
                    const indexRaw = await readIndex();
                    const cleaned = indexRaw.map(sanitizeMetaRow);
                    const prev = cleaned.find((x) => String(x.id || '').trim() === id);
                    const rest = cleaned.filter((x) => String(x.id || '').trim() !== id);
                    if (prev) {
                        rest.push(sanitizeMetaRow({
                            ...prev,
                            thumb: synth,
                            updatedAt: Date.now(),
                        }));
                    } else {
                        rest.push(sanitizeMetaRow({
                            id,
                            type: payload.type,
                            title: payload.title,
                            desc: payload.desc,
                            tags: payload.tags,
                            thumb: synth,
                            adultContent: payload.adultContent === true,
                            owner,
                            updatedAt: Date.now(),
                            createdAt: Number(payload.createdAt) || Date.now(),
                            version: VERSION,
                        }));
                    }
                    await writeIndex(rest);
                }
            }
        }
        return res.json({ item: payload });
    } catch (e) {
        return res.status(500).json({ error: e?.message || 'resource read failed' });
    }
});

/**
 * 创建一条商城资源（与 POST /resource 行为一致）。
 * @returns {Promise<{ id: string, thumb: string | null }>}
 */
async function createMallResourceFromBody(req, body) {
    ensureMallDirs();
    const b = body && typeof body === 'object' ? body : {};
    const now = Date.now();
    const id = String(b.id || `mall_${now}_${Math.random().toString(36).slice(2, 8)}`).trim();
    const type = normalizeType(b.type);
    const title = String(b.title || '').trim();
    if (!title) {
        throw new Error('title required');
    }
    const dup = await findDuplicateMallResourceByTitle(type, title);
    if (dup) {
        throw new Error(`同名已上架，跳过：「${String(dup.title || title)}」`);
    }
    const desc = String(b.desc || '').trim();
    const tags = normalizeTags(b.tags);
    const owner = String(req.user?.profile?.handle || '').trim() || 'unknown';
    const adultContent = b.adultContent === true;
    const payload = {
        id,
        uid: `public-${id}`,
        type,
        resourceType: type,
        title,
        desc,
        tags,
        catalog: Array.isArray(b.catalog) ? b.catalog : [],
        regexRules: Array.isArray(b.regexRules) ? b.regexRules : [],
        first_mes: typeof b.first_mes === 'string' ? b.first_mes : '',
        raw: b.raw && typeof b.raw === 'object' ? b.raw : null,
        img: typeof b.img === 'string' ? b.img : null,
        adultContent,
        source: 'public',
        owner,
        updatedAt: now,
        createdAt: Number(b.createdAt) || now,
        version: VERSION,
    };
    let thumb = null;
    try {
        thumb = await maybePersistThumb(payload.img, id, req);
    } catch {
        thumb = null;
    }
    if (thumb) {
        payload.img = thumb;
    }
    writeFileAtomicSync(resourceFile(id), JSON.stringify(payload), 'utf8');
    const index = (await readIndex()).filter((x) => String(x.id || '').trim() !== id);
    index.push(sanitizeMetaRow({ id, type, title, desc, tags, thumb, adultContent, owner, updatedAt: now, createdAt: payload.createdAt, version: VERSION }));
    await writeIndex(index);
    appendEuAuditLog(owner, 'mall_resource_create', { id, title, type });
    return { id, thumb };
}

router.post('/resource', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    try {
        const { id, thumb } = await createMallResourceFromBody(req, req.body);
        return res.json({ ok: true, id, thumb });
    } catch (e) {
        return res.status(400).json({ error: e?.message || 'create failed' });
    }
});

router.post('/resources/batch', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
        return res.status(400).json({ error: 'items required (array)' });
    }
    if (items.length > 200) {
        return res.status(400).json({ error: 'max 200 items per request' });
    }
    const results = [];
    const batchSeen = new Set();
    for (const it of items) {
        try {
            const title = String(it?.title || '').trim();
            const type = normalizeType(it?.type);
            const dedupKey = normalizeUploadDedupKey(title);
            const batchKey = dedupKey ? `${type}\0${dedupKey}` : '';
            if (batchKey) {
                if (batchSeen.has(batchKey)) {
                    results.push({
                        ok: false,
                        skipped: true,
                        duplicate: true,
                        error: `同名已上架，跳过：「${title}」`,
                    });
                    continue;
                }
                batchSeen.add(batchKey);
            }
            // eslint-disable-next-line no-await-in-loop
            const dup = await findDuplicateMallResourceByTitle(type, title);
            if (dup) {
                results.push({
                    ok: false,
                    skipped: true,
                    duplicate: true,
                    error: `同名已上架，跳过：「${String(dup.title || title)}」`,
                    existingId: String(dup.id || '').trim(),
                });
                continue;
            }
            // eslint-disable-next-line no-await-in-loop
            const { id, thumb } = await createMallResourceFromBody(req, it);
            results.push({ ok: true, id, thumb });
        } catch (e) {
            const msg = String(e?.message || e);
            results.push({
                ok: false,
                error: msg,
                skipped: /同名已上架/.test(msg),
                duplicate: /同名已上架/.test(msg),
            });
        }
    }
    const okCount = results.filter((x) => x.ok).length;
    appendEuAuditLog(req.user?.profile?.handle, 'mall_resource_batch', { total: items.length, ok: okCount });
    return res.json({ ok: true, results, okCount, failCount: items.length - okCount });
});

router.put('/resource/:id', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    ensureMallDirs();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const fp = resourceFile(id);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
    let prev = {};
    try {
        prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
        prev = {};
    }
    if (!assertCanModifyMallResource(req, res, String(prev.owner || '').trim())) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const now = Date.now();
    const type = normalizeType(body.type || prev.type);
    const prevIndexRow = (await readIndex()).find((x) => String(x.id || '').trim() === id);
    const payload = {
        ...prev,
        id,
        uid: `public-${id}`,
        type,
        resourceType: type,
        title: String(body.title ?? prev.title ?? '').trim(),
        desc: String(body.desc ?? prev.desc ?? '').trim(),
        tags: normalizeTags(body.tags ?? prev.tags),
        catalog: Array.isArray(body.catalog) ? body.catalog : (Array.isArray(prev.catalog) ? prev.catalog : []),
        regexRules: Array.isArray(body.regexRules) ? body.regexRules : (Array.isArray(prev.regexRules) ? prev.regexRules : []),
        first_mes: typeof body.first_mes === 'string' ? body.first_mes : String(prev.first_mes || ''),
        raw: body.raw && typeof body.raw === 'object' ? body.raw : (prev.raw && typeof prev.raw === 'object' ? prev.raw : null),
        img: typeof body.img === 'string' ? body.img : (typeof prev.img === 'string' ? prev.img : null),
        adultContent: Object.prototype.hasOwnProperty.call(body, 'adultContent')
            ? body.adultContent === true
            : prev.adultContent === true,
        source: 'public',
        owner: String(prev.owner || req.user?.profile?.handle || 'unknown'),
        updatedAt: now,
        createdAt: Number(prev.createdAt) || now,
        version: VERSION,
    };
    let thumb = null;
    try {
        thumb = await maybePersistThumb(payload.img, id, req);
    } catch {
        thumb = null;
    }
    if (!thumb && prevIndexRow && typeof prevIndexRow.thumb === 'string' && prevIndexRow.thumb.trim()) {
        thumb = prevIndexRow.thumb.trim();
    }
    if (thumb) {
        payload.img = thumb;
    }
    writeFileAtomicSync(fp, JSON.stringify(payload), 'utf8');
    const index = (await readIndex()).filter((x) => String(x.id || '').trim() !== id);
    index.push(sanitizeMetaRow({
        id,
        type: payload.type,
        title: payload.title,
        desc: payload.desc,
        tags: payload.tags,
        thumb,
        adultContent: payload.adultContent,
        owner: payload.owner,
        updatedAt: payload.updatedAt,
        createdAt: payload.createdAt,
        version: VERSION,
    }));
    await writeIndex(index);
    appendEuAuditLog(req.user?.profile?.handle, 'mall_resource_update', { id });
    return res.json({ ok: true, id, thumb });
});

router.delete('/resource/:id', async (req, res) => {
    if (!requireMallPublisher(req, res)) return;
    ensureMallDirs();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const fp = resourceFile(id);
    let prev = {};
    if (fs.existsSync(fp)) {
        try {
            prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch {
            prev = {};
        }
    }
    const meta = (await readIndex()).find((x) => String(x.id || '').trim() === id);
    const effectiveOwner = String(prev.owner || meta?.owner || '').trim();
    if (!assertCanModifyMallResource(req, res, effectiveOwner)) return;
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    const thumbFile = path.join(THUMB_DIR(), `${sanitize(id)}.jpg`);
    if (fs.existsSync(thumbFile)) fs.unlinkSync(thumbFile);
    const index = (await readIndex()).filter((x) => String(x.id || '').trim() !== id);
    await writeIndex(index);
    appendEuAuditLog(req.user?.profile?.handle, 'mall_resource_delete', { id });
    return res.json({ ok: true, id });
});

router.post('/migrate/browser-state', async (req, res) => {
    const actor = req.user?.profile;
    if (!actor || (!isEuDevSuperUser(req) && !hasEuRole(actor, EU_ROLES.SUPER_ADMIN))) {
        return res.status(403).json({ error: '需要 super.admin 权限' });
    }
    ensureMallDirs();
    const handles = await getAllUserHandles();
    const imported = [];
    const skipped = [];
    const backup = [];
    for (const handle of handles) {
        const fp = path.join(getUserDirectories(handle).root, 'eu-mall-browser-state.json');
        if (!fs.existsSync(fp)) continue;
        let items = {};
        try {
            const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
            items = raw?.items && typeof raw.items === 'object' ? raw.items : {};
        } catch {
            continue;
        }
        const devRaw = items.eu_demo_dev_items;
        if (typeof devRaw !== 'string' || !devRaw.trim()) continue;
        let parsed = [];
        try {
            parsed = JSON.parse(devRaw);
        } catch {
            parsed = [];
        }
        if (!Array.isArray(parsed) || !parsed.length) continue;
        backup.push({ handle, count: parsed.length });
        for (const row of parsed) {
            const type = normalizeType(row?.type);
            const title = String(row?.title || '').trim();
            if (!title) {
                skipped.push({ handle, reason: 'empty title' });
                continue;
            }
            const existing = (await readIndex()).find((x) =>
                String(x.title || '').trim() === title &&
                normalizeType(x.type) === type);
            if (existing) {
                skipped.push({ handle, title, reason: 'duplicate by title+type' });
                continue;
            }
            const id = `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const payload = {
                id,
                uid: `public-${id}`,
                type,
                resourceType: type,
                title,
                desc: String(row?.desc || '').trim(),
                tags: normalizeTags(row?.tags),
                catalog: Array.isArray(row?.catalog) ? row.catalog : [],
                regexRules: Array.isArray(row?.regexRules) ? row.regexRules : [],
                first_mes: typeof row?.first_mes === 'string' ? row.first_mes : '',
                raw: row?.raw && typeof row.raw === 'object' ? row.raw : null,
                img: typeof row?.img === 'string' ? row.img : null,
                adultContent: row?.adultContent === true,
                source: 'migrated-browser-state',
                owner: handle,
                updatedAt: Date.now(),
                createdAt: Date.now(),
                version: VERSION,
            };
            writeFileAtomicSync(resourceFile(id), JSON.stringify(payload), 'utf8');
            let thumb = null;
            try {
                // eslint-disable-next-line no-await-in-loop
                thumb = await maybePersistThumb(payload.img, id);
            } catch {
                thumb = null;
            }
            const index = await readIndex();
            index.push(sanitizeMetaRow({
                id,
                type,
                title,
                desc: payload.desc,
                tags: payload.tags,
                thumb,
                adultContent: payload.adultContent,
                owner: handle,
                updatedAt: payload.updatedAt,
                createdAt: payload.createdAt,
                version: VERSION,
            }));
            await writeIndex(index);
            imported.push({ id, handle, title, type });
        }
    }
    const backupFp = path.join(MIGRATION_DIR(), `browser-state-import-${Date.now()}.json`);
    writeFileAtomicSync(backupFp, JSON.stringify({ imported, skipped, backup }, null, 2), 'utf8');
    appendEuAuditLog(actor.handle, 'mall_migrate_browser_state', { imported: imported.length, skipped: skipped.length });
    return res.json({ ok: true, imported: imported.length, skipped: skipped.length, backupFile: backupFp });
});
