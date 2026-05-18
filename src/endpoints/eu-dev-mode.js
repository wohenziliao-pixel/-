/**
 * EU 开发者模式：口令校验后写入酒馆 session，商城/贴吧/RBAC 按网站最高权限处理。
 */
import express from 'express';
import { appendEuAuditLog } from './eu-rbac.js';

export const EU_DEV_MODE_PASSPHRASE = '#开发者模式404945859';
const EU_DEV_SESSION_KEY = 'euDevModeActive';

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isEuDevModeSessionActive(req) {
    return req?.session?.[EU_DEV_SESSION_KEY] === true;
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function readEuDevClientFlag(req) {
    if (isEuDevModeSessionActive(req)) {
        return true;
    }
    const h = String(req.get('x-eu-dev-mode') || '').trim();
    return h === '1';
}

/**
 * 开发者模式已激活（须先 POST /activate 写入 session，且请求已识别登录用户）。
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isEuDevSuperUser(req) {
    if (!isEuDevModeSessionActive(req)) {
        return false;
    }
    return Boolean(req?.user?.profile?.handle || req?.tiebaActorHandle);
}

/**
 * @param {string} passphrase
 * @returns {boolean}
 */
export function validateEuDevPassphrase(passphrase) {
    return String(passphrase || '').trim() === EU_DEV_MODE_PASSPHRASE;
}

/**
 * @param {import('express').Request} req
 */
export function activateEuDevModeSession(req) {
    if (req.session) {
        req.session[EU_DEV_SESSION_KEY] = true;
    }
}

/**
 * @param {import('express').Request} req
 */
export function deactivateEuDevModeSession(req) {
    if (req.session) {
        req.session[EU_DEV_SESSION_KEY] = false;
    }
}

export const router = express.Router();

router.get('/status', (req, res) => {
    const active = isEuDevModeSessionActive(req);
    return res.json({ active, devMode: active });
});

router.post('/activate', (req, res) => {
    const profile = req.user?.profile;
    if (!profile) {
        return res.status(401).json({ error: '请先登录 EU 账号后再进入开发者模式' });
    }
    if (!validateEuDevPassphrase(req.body?.passphrase)) {
        return res.status(403).json({ error: '开发者模式口令无效' });
    }
    activateEuDevModeSession(req);
    appendEuAuditLog(profile.handle, 'eu_dev_mode_activate', { via: 'eu-dev-mode' });
    return res.json({ ok: true, devMode: true });
});

router.post('/deactivate', (req, res) => {
    const profile = req.user?.profile;
    deactivateEuDevModeSession(req);
    if (profile?.handle) {
        appendEuAuditLog(profile.handle, 'eu_dev_mode_deactivate', { via: 'eu-dev-mode' });
    }
    return res.json({ ok: true, devMode: false });
});
