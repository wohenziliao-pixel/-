/**
 * EU 账号云快照：按酒馆登录用户落盘到 DATA_ROOT/<handle>/eu-mall-browser-state.json。
 * 仅同步「已获取索引 / 个人资料 / 上传索引」等轻量键；故事书正文在 data/eu-public/mall；
 * 对话三键走 POST/GET /conversations；贴吧独立 data/eu-tieba-board.json。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { getUserDirectories } from '../users.js';

export const router = express.Router();

const jsonBody = express.json({ limit: '48mb' });

/**
 * @param {string} handle
 * @param {string} key
 * @returns {boolean}
 */
/** @param {string} key */
function isDeprecatedBrowserStateKey(key) {
    const k = String(key || '').trim();
    if (!k) {
        return false;
    }
    if (
        k === 'eu_demo_dev_items' ||
        k === 'eu_demo_dev_heavy' ||
        k === 'eu_demo_dev_items_manifest' ||
        k === 'eu_demo_dev_public_overflow_v1'
    ) {
        return true;
    }
    if (k.startsWith('eu_demo_dev_items_')) {
        return true;
    }
    return false;
}

/**
 * @param {string} handle
 * @param {string} key
 * @returns {boolean}
 */
function isAllowedKey(handle, key) {
    const h = String(handle || '').trim();
    const k = String(key || '').trim();
    if (!h || !k || isDeprecatedBrowserStateKey(k)) {
        return false;
    }
    if (k === `eu_demo_acquired_items_${h}`) {
        return true;
    }
    if (k === `eu_demo_acquired_meta_v1_${h}`) {
        return true;
    }
    if (k === `eu_demo_acquired_gen_${h}`) {
        return true;
    }
    if (k === `eu_demo_mall_hidden_uids_${h}`) {
        return true;
    }
    if (k === `eu_demo_account_profile_${h}`) {
        return true;
    }
    if (k === `eu_demo_upload_index_${h}`) {
        return true;
    }
    return false;
}

/**
 * @param {Record<string, string>} items
 */
function purgeDeprecatedBrowserStateKeys(items) {
    if (!items || typeof items !== 'object') {
        return;
    }
    for (const key of Object.keys(items)) {
        if (isDeprecatedBrowserStateKey(key)) {
            delete items[key];
        }
    }
}

/** @param {string} key @param {string} val */
function maxValueBytesForKey(key, val) {
    if (String(key || '').includes('eu_demo_conversations_')) {
        return 4_000_000;
    }
    if (String(key || '').startsWith('eu_demo_account_profile_') && String(val || '').length > 120_000) {
        return 0;
    }
    return 400_000;
}

/**
 * @param {string} handle
 * @returns {string}
 */
function stateFilePath(handle) {
    return path.join(getUserDirectories(handle).root, 'eu-mall-browser-state.json');
}

/** @param {string} raw */
function isEmptyConversationStoreJson(raw) {
    const s = String(raw ?? '').trim();
    if (!s || s.length < 3) {
        return true;
    }
    try {
        const o = JSON.parse(s);
        return !o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length === 0;
    } catch {
        return true;
    }
}

/**
 * @param {Record<string, string>} items
 * @param {string} handle
 */
function resumeClearedAtFromItems(items, handle) {
    const k = `eu_demo_last_chat_resume_${String(handle || '').trim()}`;
    const raw = items?.[k];
    if (typeof raw !== 'string' || raw.length < 4) {
        return 0;
    }
    try {
        return Number(JSON.parse(raw)?.clearedAt) || 0;
    } catch {
        return 0;
    }
}

/**
 * 云端曾 wipe（磁盘 resume 含 clearedAt）后，客户端上传的非空新会话（resume 无 clearedAt、有会话目标）。
 * @param {Record<string, string>} existingItems
 * @param {Record<string, string>} incoming
 * @param {string} handle
 */
function incomingIsNewSessionAfterServerClear(existingItems, incoming, handle) {
    const h = String(handle || '').trim();
    if (!h) {
        return false;
    }
    if (resumeClearedAtFromItems(existingItems, h) <= 0) {
        return false;
    }
    const convKey = `eu_demo_conversations_${h}`;
    const resumeKey = `eu_demo_last_chat_resume_${h}`;
    if (isEmptyConversationStoreJson(incoming[convKey])) {
        return false;
    }
    const raw = incoming[resumeKey];
    if (typeof raw === 'string' && raw.length > 4) {
        try {
            const snap = JSON.parse(raw);
            if (Number(snap?.clearedAt) > 0) {
                return false;
            }
            if (String(snap?.conversationKey || snap?.characterName || '').trim()) {
                return true;
            }
        } catch {
            /* fall through */
        }
    }
    const sessKey = `eu_demo_character_sessions_${h}`;
    const sessRaw = incoming[sessKey];
    if (typeof sessRaw !== 'string' || sessRaw.length < 4 || sessRaw.trim() === '{}') {
        return false;
    }
    try {
        const sess = JSON.parse(sessRaw);
        return Boolean(sess && typeof sess === 'object' && !Array.isArray(sess) && Object.keys(sess).length > 0);
    } catch {
        return false;
    }
}

/** 写入非空会话后解除磁盘上的 clearedAt 锁，避免下次 pull 仍当「已清理」。 */
function unlockServerClearLockOnMergedResume(mergedItems, handle) {
    const h = String(handle || '').trim();
    if (!h) {
        return;
    }
    const convKey = `eu_demo_conversations_${h}`;
    const resumeKey = `eu_demo_last_chat_resume_${h}`;
    if (isEmptyConversationStoreJson(mergedItems[convKey])) {
        return;
    }
    const raw = mergedItems[resumeKey];
    if (typeof raw !== 'string' || raw.length < 4) {
        return;
    }
    try {
        const snap = JSON.parse(raw);
        if (!Number(snap?.clearedAt)) {
            return;
        }
        delete snap.clearedAt;
        if (!Number(snap.cloudAt)) {
            snap.cloudAt = Date.now();
        }
        mergedItems[resumeKey] = JSON.stringify(snap);
    } catch {
        /* ignore */
    }
}

/**
 * 云端已 cleared 且 incoming 试图写回非空会话时拒绝（防旧客户端整包 mall push 覆盖 wipe）。
 * @param {string} handle
 * @param {Record<string, string>} existingItems
 * @param {Record<string, string>} incoming
 * @param {string} key
 */
function shouldRejectIncomingConversationKey(handle, existingItems, incoming, key) {
    const h = String(handle || '').trim();
    const k = String(key || '');
    if (!h || !conversationKeysForHandle(h).includes(k)) {
        return false;
    }
    if (incomingIsNewSessionAfterServerClear(existingItems, incoming, h)) {
        return false;
    }
    if (k.includes('eu_demo_conversations_') && isEmptyConversationStoreJson(incoming[k])) {
        const existingConv = existingItems[k];
        if (!isEmptyConversationStoreJson(existingConv)) {
            const resumeKey = `eu_demo_last_chat_resume_${h}`;
            const incomingResume = incoming[resumeKey];
            if (typeof incomingResume === 'string' && incomingResume.length > 4) {
                try {
                    const inCleared = Number(JSON.parse(incomingResume)?.clearedAt) || 0;
                    if (inCleared > 0) {
                        return false;
                    }
                } catch {
                    /* ignore */
                }
            }
            return true;
        }
        return false;
    }
    const cleared = resumeClearedAtFromItems(existingItems, h);
    if (cleared <= 0) {
        return false;
    }
    const resumeKey = `eu_demo_last_chat_resume_${h}`;
    const incomingResume = incoming[resumeKey];
    if (typeof incomingResume === 'string' && incomingResume.length > 4) {
        try {
            const inCleared = Number(JSON.parse(incomingResume)?.clearedAt) || 0;
            if (inCleared >= cleared) {
                return false;
            }
        } catch {
            /* ignore */
        }
    }
    if (k.includes('eu_demo_conversations_') && !isEmptyConversationStoreJson(incoming[k])) {
        return true;
    }
    if (k.includes('eu_demo_character_sessions_') && String(incoming[k] || '').length > 4) {
        return true;
    }
    if (k === resumeKey && String(incoming[k] || '').length > 4) {
        try {
            const snap = JSON.parse(incoming[k]);
            if (!Number(snap?.clearedAt)) {
                return true;
            }
        } catch {
            return true;
        }
    }
    return false;
}

/** @param {string} handle */
function conversationKeysForHandle(handle) {
    const h = String(handle || '').trim();
    if (!h) {
        return [];
    }
    return [
        `eu_demo_conversations_${h}`,
        `eu_demo_character_sessions_${h}`,
        `eu_demo_last_chat_resume_${h}`,
    ];
}

/**
 * @param {string} handle
 * @returns {{ items: Record<string, string>, updatedAt: number }}
 */
function readConversationItemsFromDisk(handle) {
    const fp = stateFilePath(handle);
    if (!fs.existsSync(fp)) {
        return { items: {}, updatedAt: 0 };
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    const all = data?.items && typeof data.items === 'object' && !Array.isArray(data.items) ? data.items : {};
    /** @type {Record<string, string>} */
    const items = {};
    for (const k of conversationKeysForHandle(handle)) {
        if (typeof all[k] === 'string') {
            items[k] = all[k];
        }
    }
    return { items, updatedAt: Number(data?.updatedAt) || 0 };
}

router.get('/', (req, res) => {
    try {
        const handle = String(req.user?.profile?.handle || '').trim();
        if (!handle) {
            return res.status(401).json({ error: '未登录' });
        }
        const fp = stateFilePath(handle);
        if (!fs.existsSync(fp)) {
            return res.json({ ok: true, items: {}, updatedAt: 0 });
        }
        const raw = fs.readFileSync(fp, 'utf8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') {
            return res.json({ ok: true, items: {}, updatedAt: 0 });
        }
        const items = data.items && typeof data.items === 'object' && !Array.isArray(data.items) ? data.items : {};
        const updatedAt = Number(data.updatedAt) || 0;
        return res.json({ ok: true, items, updatedAt });
    } catch (e) {
        console.error('[eu-browser-state] GET', e);
        return res.status(500).json({ error: '读取失败' });
    }
});

/** 仅返回对话云快照三键，避免整包 browser-state 过大时前端 partial 解析漏掉会话。 */
router.get('/conversations', (req, res) => {
    try {
        const handle = String(req.user?.profile?.handle || '').trim();
        if (!handle) {
            return res.status(401).json({ error: '未登录' });
        }
        const { items, updatedAt } = readConversationItemsFromDisk(handle);
        return res.json({ ok: true, items, updatedAt });
    } catch (e) {
        console.error('[eu-browser-state] GET /conversations', e);
        return res.status(500).json({ error: '读取对话快照失败' });
    }
});

router.post('/', jsonBody, (req, res) => {
    try {
        const handle = String(req.user?.profile?.handle || '').trim();
        if (!handle) {
            return res.status(401).json({ error: '未登录' });
        }
        const incoming = req.body?.items;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return res.status(400).json({ error: '缺少 items 对象' });
        }
        const fp = stateFilePath(handle);
        let merged = { updatedAt: Date.now(), items: {} };
        if (fs.existsSync(fp)) {
            try {
                const prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
                if (prev && typeof prev === 'object' && prev.items && typeof prev.items === 'object' && !Array.isArray(prev.items)) {
                    merged.items = { ...prev.items };
                }
            } catch {
                merged.items = {};
            }
        }
        const savedKeys = [];
        const skippedKeys = [];
        for (const [key, val] of Object.entries(incoming)) {
            if (!isAllowedKey(handle, key)) {
                skippedKeys.push(key);
                continue;
            }
            if (typeof val !== 'string') {
                skippedKeys.push(key);
                continue;
            }
            if (shouldRejectIncomingConversationKey(handle, merged.items, incoming, key)) {
                skippedKeys.push(key);
                continue;
            }
            const maxBytes = maxValueBytesForKey(key, val);
            if (!maxBytes || val.length > maxBytes) {
                skippedKeys.push(key);
                continue;
            }
            merged.items[key] = val;
            savedKeys.push(key);
        }
        purgeDeprecatedBrowserStateKeys(merged.items);
        merged.updatedAt = Date.now();
        writeFileAtomicSync(fp, JSON.stringify(merged), 'utf8');
        return res.json({ ok: true, updatedAt: merged.updatedAt, savedKeys, skippedKeys });
    } catch (e) {
        console.error('[eu-browser-state] POST', e);
        return res.status(500).json({ error: '保存失败' });
    }
});

/** 仅合并对话相关键（关页前 keepalive 推送用，payload 更小）。 */
router.post('/conversations', jsonBody, (req, res) => {
    try {
        const handle = String(req.user?.profile?.handle || '').trim();
        if (!handle) {
            return res.status(401).json({ error: '未登录' });
        }
        const incoming = req.body?.items;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return res.status(400).json({ error: '缺少 items 对象' });
        }
        const fp = stateFilePath(handle);
        let merged = { updatedAt: Date.now(), items: {} };
        if (fs.existsSync(fp)) {
            try {
                const prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
                if (prev && typeof prev === 'object' && prev.items && typeof prev.items === 'object' && !Array.isArray(prev.items)) {
                    merged.items = { ...prev.items };
                }
            } catch {
                merged.items = {};
            }
        }
        const savedKeys = [];
        const skippedKeys = [];
        for (const key of conversationKeysForHandle(handle)) {
            if (!Object.prototype.hasOwnProperty.call(incoming, key)) {
                continue;
            }
            const val = incoming[key];
            if (typeof val !== 'string') {
                skippedKeys.push(key);
                continue;
            }
            if (shouldRejectIncomingConversationKey(handle, merged.items, incoming, key)) {
                skippedKeys.push(key);
                continue;
            }
            const maxBytes = maxValueBytesForKey(key, val);
            if (!maxBytes || val.length > maxBytes) {
                skippedKeys.push(key);
                continue;
            }
            merged.items[key] = val;
            savedKeys.push(key);
        }
        unlockServerClearLockOnMergedResume(merged.items, handle);
        merged.updatedAt = Date.now();
        writeFileAtomicSync(fp, JSON.stringify(merged), 'utf8');
        return res.json({ ok: true, updatedAt: merged.updatedAt, savedKeys, skippedKeys });
    } catch (e) {
        console.error('[eu-browser-state] POST /conversations', e);
        return res.status(500).json({ error: '保存对话快照失败' });
    }
});
