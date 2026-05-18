/**
 * EU 多用户：公开注册（写入与酒馆一致的用户存储与目录）。
 * 需在 config.yaml 同时开启 enableUserAccounts 与 euPublicRegistration。
 */
import lodash from 'lodash';
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpFromRequest, getRealIpFromHeader } from '../express-common.js';
import { getConfigValue, color } from '../util.js';
import {
    toKey,
    getPasswordSalt,
    getPasswordHash,
    getUserDirectories,
    ensurePublicDirectoriesExist,
    getAllUserHandles,
} from '../users.js';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import { applyEuSharedApiProfile } from './eu-shared-api.js';
import storage from 'node-persist';

const PREFER_REAL_IP_HEADER = getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');
const getIpAddress = (request) => (PREFER_REAL_IP_HEADER ? getRealIpFromHeader(request) : getIpFromRequest(request));

const registerLimiter = new RateLimiterMemory({
    points: 5,
    duration: 3600,
});

function slugify(text) {
    return lodash.deburr(String(text ?? '').toLowerCase().trim()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const router = express.Router();

router.post('/register', async (request, response) => {
    try {
        const accountsEnabled = getConfigValue('enableUserAccounts', false, 'boolean');
        const publicReg = getConfigValue('euPublicRegistration', false, 'boolean');
        if (!accountsEnabled) {
            return response.status(403).json({
                error: '未开启多用户：请在 config.yaml 设置 enableUserAccounts: true',
            });
        }
        if (!publicReg) {
            return response.status(403).json({
                error: '未开启 EU 自助注册：请在 config.yaml 设置 euPublicRegistration: true',
            });
        }

        const ip = getIpAddress(request);
        await registerLimiter.consume(ip);

        const rawHandle = request.body?.handle ?? request.body?.username;
        const name = request.body?.name ?? request.body?.displayName;
        const password = request.body?.password;
        const email = request.body?.email;

        const handle = slugify(rawHandle);
        if (!handle || !/^[a-z0-9-]+$/.test(handle)) {
            console.warn(color.yellow('[EU register] invalid handle'));
            return response.status(400).json({
                error: '用户标识无效：请使用小写字母、数字与短横线（可先输入英文昵称再自动规范化）。',
            });
        }
        if (!password || String(password).length < 8) {
            return response.status(400).json({ error: '密码至少 8 位。' });
        }

        const handles = await getAllUserHandles();
        if (handles.some((x) => x === handle)) {
            return response.status(409).json({ error: '该用户标识已被注册。' });
        }

        const salt = getPasswordSalt();
        const passwordHash = getPasswordHash(String(password), salt);
        const newUser = {
            handle,
            name: String(name || handle).slice(0, 120),
            created: Date.now(),
            password: passwordHash,
            salt,
            admin: false,
            enabled: true,
        };
        if (email && String(email).trim().includes('@')) {
            newUser.email = String(email).trim().slice(0, 200);
        }

        await storage.setItem(toKey(handle), newUser);
        console.info(color.green('[EU register]'), 'created user', handle, 'from', ip);
        await ensurePublicDirectoriesExist();
        const directories = getUserDirectories(handle);
        await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);
        const sharedApi = applyEuSharedApiProfile(directories);
        if (sharedApi.applied) {
            console.info(color.green('[EU register] shared API from'), sharedApi.from, '→', handle);
        }
        await registerLimiter.delete(ip);
        return response.json({ handle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.warn('[EU register] rate limited', getIpAddress(request));
            return response.status(429).json({ error: '注册过于频繁，请稍后再试。' });
        }
        console.error('[EU register] failed:', error);
        return response.status(500).json({ error: '注册失败，请查看服务端日志。' });
    }
});
