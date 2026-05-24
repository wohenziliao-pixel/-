/**
 * 全站共用 API：新用户目录从 config.euSharedApiFromHandle 复制 secrets 与 xAI/oai 配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { getConfigValue, color } from '../util.js';
import { getUserDirectories } from '../users.js';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { SECRET_KEYS } from './secrets.js';

const SETTINGS_FILE = 'settings.json';
const PRESET_DIR = 'OpenAI Settings';
const DEFAULT_XAI_MODEL = 'grok-4.3';

/**
 * @returns {string} 源账号 handle，空表示未启用
 */
export function getEuSharedApiSourceHandle() {
    const h = String(getConfigValue('euSharedApiFromHandle', '', 'string') ?? '').trim().toLowerCase();
    if (!h || !/^[a-z0-9-]+$/.test(h)) {
        return '';
    }
    return h;
}

function looksLikeGrokModelId(modelId = '') {
    const m = String(modelId || '').trim().toLowerCase();
    return /^grok(?:[-._]|$)/.test(m) || m.includes('grok-');
}

function readJsonFile(fp) {
    try {
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
        return null;
    }
}

function hasXaiSecretInRoot(userRoot) {
    const secrets = readJsonFile(path.join(userRoot, 'secrets.json'));
    if (!secrets || typeof secrets !== 'object') {
        return false;
    }
    const key = String(secrets[SECRET_KEYS.XAI] || secrets.api_key_xai || '').trim();
    return key.length > 0;
}

/**
 * 解析 settings.json 内 extension_settings（可能是对象或 JSON 字符串）。
 * @param {object} settings
 */
function getExtensionSettingsObject(settings) {
    if (!settings || typeof settings !== 'object') {
        return null;
    }
    const ext = settings.extension_settings;
    if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
        return ext;
    }
    if (typeof ext === 'string' && ext.trim()) {
        try {
            const parsed = JSON.parse(ext);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * 从站长模板合并 Connection Manager（五条文风 ↔ DEEPSEEKV3 等 + secret-id），否则仅 secrets.json 无法轮换 OpenRouter/xAI。
 * @param {string} tgtSettingsPath
 * @param {object|null} srcJ
 */
function mergeConnectionManagerFromSource(tgtSettingsPath, srcJ) {
    const srcExt = getExtensionSettingsObject(srcJ);
    const profiles = srcExt?.connectionManager?.profiles;
    if (!Array.isArray(profiles) || !profiles.length) {
        return false;
    }
    let tgtJ = readJsonFile(tgtSettingsPath) || {};
    if (!tgtJ || typeof tgtJ !== 'object') {
        tgtJ = {};
    }
    let tgtExt = getExtensionSettingsObject(tgtJ);
    if (!tgtExt) {
        tgtExt = {};
    }
    tgtExt.connectionManager = tgtExt.connectionManager || {};
    tgtExt.connectionManager.profiles = JSON.parse(JSON.stringify(profiles));
    tgtJ.extension_settings = tgtExt;
    writeFileAtomicSync(tgtSettingsPath, JSON.stringify(tgtJ, null, 4));
    return true;
}

/**
 * 预设 JSON 若仍为 openai，新用户 EU 会误走 OpenAI 密钥分支。
 * @param {string} presetDir
 */
function patchOpenAiPresetSourcesToXai(presetDir) {
    if (!fs.existsSync(presetDir)) {
        return;
    }
    for (const name of fs.readdirSync(presetDir)) {
        if (!name.endsWith('.json')) {
            continue;
        }
        const fp = path.join(presetDir, name);
        const j = readJsonFile(fp);
        if (!j || typeof j !== 'object') {
            continue;
        }
        const cur = String(j.chat_completion_source || '').trim().toLowerCase();
        if (cur && cur !== 'openai') {
            continue;
        }
        j.chat_completion_source = 'xai';
        const oaiM = String(j.openai_model || '').trim();
        if (!String(j.xai_model || '').trim()) {
            j.xai_model = looksLikeGrokModelId(oaiM) ? oaiM : DEFAULT_XAI_MODEL;
        }
        writeFileAtomicSync(fp, JSON.stringify(j, null, 4));
    }
}

/**
 * @param {string} tgtRoot
 * @param {object|null} srcOai
 */
function forceXaiOaiSettings(tgtRoot, srcOai = null) {
    const settingsPath = path.join(tgtRoot, SETTINGS_FILE);
    let settings = readJsonFile(settingsPath) || {};
    if (!settings.oai_settings || typeof settings.oai_settings !== 'object') {
        settings.oai_settings = {};
    }
    const oai = settings.oai_settings;
    const src = srcOai && typeof srcOai === 'object' ? srcOai : {};
    oai.chat_completion_source = 'xai';
    const xaiM = String(src.xai_model ?? oai.xai_model ?? '').trim();
    const oaiM = String(src.openai_model ?? oai.openai_model ?? '').trim();
    if (xaiM) {
        oai.xai_model = xaiM;
    } else if (looksLikeGrokModelId(oaiM)) {
        oai.xai_model = oaiM;
    } else if (!String(oai.xai_model || '').trim()) {
        oai.xai_model = DEFAULT_XAI_MODEL;
    }
    writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4));
}

/**
 * @param {import('../users.js').UserDirectoryList} targetDirectories
 * @returns {{ applied: boolean, from?: string, reason?: string }}
 */
export function applyEuSharedApiProfile(targetDirectories) {
    const srcHandle = getEuSharedApiSourceHandle();
    if (!srcHandle) {
        return { applied: false, reason: 'euSharedApiFromHandle not set' };
    }

    const srcDirs = getUserDirectories(srcHandle);
    const tgtRoot = targetDirectories.root;
    const tgtHandle = path.basename(tgtRoot);

    if (tgtHandle === srcHandle) {
        return { applied: false, reason: 'source is self' };
    }

    if (!fs.existsSync(srcDirs.root)) {
        console.warn(color.yellow(`[EU shared-api] source handle missing: ${srcHandle}`));
        return { applied: false, reason: 'source missing' };
    }

    const srcSecrets = path.join(srcDirs.root, 'secrets.json');
    if (fs.existsSync(srcSecrets)) {
        fs.cpSync(srcSecrets, path.join(tgtRoot, 'secrets.json'), { force: true });
    } else {
        console.warn(color.yellow(`[EU shared-api] no secrets.json on source ${srcHandle}`));
    }

    const srcPreset = path.join(srcDirs.root, PRESET_DIR);
    const tgtPreset = path.join(tgtRoot, PRESET_DIR);
    if (fs.existsSync(srcPreset)) {
        fs.rmSync(tgtPreset, { recursive: true, force: true });
        fs.cpSync(srcPreset, tgtPreset, { recursive: true });
        patchOpenAiPresetSourcesToXai(tgtPreset);
    }

    const srcSettingsPath = path.join(srcDirs.root, SETTINGS_FILE);
    const tgtSettingsPath = path.join(tgtRoot, SETTINGS_FILE);
    const srcJ = fs.existsSync(srcSettingsPath) ? readJsonFile(srcSettingsPath) : null;

    if (srcJ && !fs.existsSync(tgtSettingsPath)) {
        fs.cpSync(srcSettingsPath, tgtSettingsPath);
    } else if (srcJ && fs.existsSync(tgtSettingsPath)) {
        try {
            const tgtJ = readJsonFile(tgtSettingsPath) || {};
            if (srcJ.oai_settings && typeof srcJ.oai_settings === 'object') {
                tgtJ.oai_settings = { ...(tgtJ.oai_settings || {}), ...srcJ.oai_settings };
                writeFileAtomicSync(tgtSettingsPath, JSON.stringify(tgtJ, null, 4));
            }
            mergeConnectionManagerFromSource(tgtSettingsPath, srcJ);
        } catch (e) {
            console.warn('[EU shared-api] merge oai_settings failed:', e);
        }
    }

    // 模板账号若已用 OpenRouter（如「文风转换-现代文」），勿再强制改回 xAI，否则新注册用户无法沿用同一套 API。
    const srcChatSource = String(srcJ?.oai_settings?.chat_completion_source || '').trim().toLowerCase();
    if (hasXaiSecretInRoot(tgtRoot) && srcChatSource !== 'openrouter') {
        forceXaiOaiSettings(tgtRoot, srcJ?.oai_settings);
    }

    return { applied: true, from: srcHandle };
}

export const syncRouter = express.Router();

/** 已登录用户重新套用站长 API（修复注册早于部署共用逻辑等）。 */
syncRouter.post('/sync', (request, response) => {
    try {
        const handle = String(request.user?.profile?.handle || '').trim();
        if (!handle) {
            return response.status(401).json({ error: '未登录' });
        }
        const directories = getUserDirectories(handle);
        const result = applyEuSharedApiProfile(directories);
        return response.json({ ok: true, ...result });
    } catch (error) {
        console.error('[EU shared-api] sync failed:', error);
        return response.status(500).json({ error: '同步失败' });
    }
});
