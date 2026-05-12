/**
 * 灌水吧专用 API 令牌（与酒馆 Cookie/CSRF 解耦）：仅用于 /api/eu/tieba 下的写操作跳过 CSRF 校验。
 * 令牌存内存，进程重启即失效；须开启 enableUserAccounts 后由 POST /api/eu/tieba/auth/session 签发。
 */
import { randomBytes } from 'node:crypto';

const PREFIX = 'eu_tb_';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, { handle: string, exp: number }>} */
const tokenMap = new Map();

/**
 * @param {string} handle
 * @returns {{ token: string, expiresAt: number }}
 */
export function issueEuTiebaApiToken(handle) {
    const h = String(handle || '').trim().toLowerCase();
    if (!h) {
        throw new Error('empty handle');
    }
    for (const [t, v] of tokenMap) {
        if (v.handle === h) {
            tokenMap.delete(t);
        }
    }
    const raw = randomBytes(24).toString('hex');
    const token = `${PREFIX}${raw}`;
    const expiresAt = Date.now() + TTL_MS;
    tokenMap.set(token, { handle: h, exp: expiresAt });
    return { token, expiresAt };
}

/**
 * @param {string} token
 */
export function revokeEuTiebaApiToken(token) {
    tokenMap.delete(String(token || '').trim());
}

/**
 * @param {string} token
 * @returns {string | null} handle
 */
export function getHandleFromEuTiebaApiToken(token) {
    const t = String(token || '').trim();
    if (!t.startsWith(PREFIX)) {
        return null;
    }
    const rec = tokenMap.get(t);
    if (!rec) {
        return null;
    }
    if (rec.exp < Date.now()) {
        tokenMap.delete(t);
        return null;
    }
    return rec.handle;
}

/**
 * csrf-sync：仅跳过灌水路由下「带有效令牌」或「令牌登录首请求」的校验，其它请求仍走酒馆 CSRF。
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function skipEuTiebaCsrf(req) {
    const p = String(req.path || '');
    if (req.method === 'POST' && p === '/api/eu/tieba/auth/session') {
        return true;
    }
    if (!p.startsWith('/api/eu/tieba/')) {
        return false;
    }
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        return false;
    }
    const tok = String(req.headers['x-eu-tieba-api'] || '').trim();
    if (tok && getHandleFromEuTiebaApiToken(tok)) {
        return true;
    }
    return false;
}
