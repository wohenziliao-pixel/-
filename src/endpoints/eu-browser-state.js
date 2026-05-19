/**
 * EU 商城 / 故事书相关浏览器状态：按酒馆登录用户落盘到 DATA_ROOT/<handle>/eu-mall-browser-state.json，
 * 便于换设备或部署到线上后同一账号自动拉取（与 eu-demo localStorage 中 eu_demo_dev_items / 已获取列表 / 个人资料 JSON 等对应）。
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
function isAllowedKey(handle, key) {
    const h = String(handle || '').trim();
    const k = String(key || '').trim();
    if (!h || !k) {
        return false;
    }
    if (
        k === 'eu_demo_dev_items' ||
        k === 'eu_demo_dev_heavy' ||
        k === 'eu_demo_dev_items_manifest' ||
        k === 'eu_demo_dev_items_storybook' ||
        k === 'eu_demo_dev_items_setting' ||
        k === 'eu_demo_dev_items_character'
    ) {
        return true;
    }
    if (k === `eu_demo_acquired_items_${h}`) {
        return true;
    }
    if (k === `eu_demo_acquired_meta_v1_${h}`) {
        return true;
    }
    if (k === `eu_demo_mall_hidden_uids_${h}`) {
        return true;
    }
    if (k === `eu_demo_account_profile_${h}`) {
        return true;
    }
    if (k === `eu_demo_conversations_${h}`) {
        return true;
    }
    if (k === `eu_demo_character_sessions_${h}`) {
        return true;
    }
    if (k === `eu_demo_last_chat_resume_${h}`) {
        return true;
    }
    return false;
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
        for (const [key, val] of Object.entries(incoming)) {
            if (!isAllowedKey(handle, key)) {
                continue;
            }
            if (typeof val !== 'string') {
                continue;
            }
            const maxBytes = maxValueBytesForKey(key, val);
            if (!maxBytes || val.length > maxBytes) {
                continue;
            }
            merged.items[key] = val;
        }
        merged.updatedAt = Date.now();
        writeFileAtomicSync(fp, JSON.stringify(merged), 'utf8');
        return res.json({ ok: true, updatedAt: merged.updatedAt });
    } catch (e) {
        console.error('[eu-browser-state] POST', e);
        return res.status(500).json({ error: '保存失败' });
    }
});
