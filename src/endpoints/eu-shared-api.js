/**
 * 全站共用 API：新用户目录从 config.euSharedApiFromHandle 复制 secrets 与 xAI/oai 配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfigValue, color } from '../util.js';
import { getUserDirectories } from '../users.js';
import { writeFileAtomicSync } from 'write-file-atomic';

const SETTINGS_FILE = 'settings.json';
const PRESET_DIR = 'OpenAI Settings';

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
    }

    const srcSettingsPath = path.join(srcDirs.root, SETTINGS_FILE);
    const tgtSettingsPath = path.join(tgtRoot, SETTINGS_FILE);
    if (fs.existsSync(srcSettingsPath) && fs.existsSync(tgtSettingsPath)) {
        try {
            const srcJ = JSON.parse(fs.readFileSync(srcSettingsPath, 'utf8'));
            const tgtJ = JSON.parse(fs.readFileSync(tgtSettingsPath, 'utf8'));
            if (srcJ.oai_settings && typeof srcJ.oai_settings === 'object') {
                tgtJ.oai_settings = { ...(tgtJ.oai_settings || {}), ...srcJ.oai_settings };
                writeFileAtomicSync(tgtSettingsPath, JSON.stringify(tgtJ, null, 4));
            }
        } catch (e) {
            console.warn('[EU shared-api] merge oai_settings failed:', e);
        }
    }

    return { applied: true, from: srcHandle };
}
