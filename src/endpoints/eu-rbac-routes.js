import express from 'express';
import lodash from 'lodash';
import storage from 'node-persist';
import { toKey } from '../users.js';
import { isEuDevSuperUser } from './eu-dev-mode.js';
import { appendEuAuditLog, EU_ROLES, getEuRoleSet, hasEuRole, setEuRoles, stripDelegatedEuRoles } from './eu-rbac.js';

export const router = express.Router();

const DELEGATABLE = new Set([EU_ROLES.MALL_PUBLISHER, EU_ROLES.TIEBA_MODERATOR]);

function slugify(text) {
    return lodash.deburr(String(text ?? '').toLowerCase().trim()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * @param {import('../users.js').User | null | undefined} profile
 * @param {string} roleToGrant
 */
function canGrantDelegatedRole(profile, roleToGrant, request) {
    if (!profile) return false;
    if (request && isEuDevSuperUser(request)) return true;
    if (profile.admin === true) return true;
    if (hasEuRole(profile, EU_ROLES.SUPER_ADMIN)) return true;
    if (roleToGrant === EU_ROLES.MALL_PUBLISHER && hasEuRole(profile, EU_ROLES.MALL_PUBLISHER)) return true;
    if (roleToGrant === EU_ROLES.TIEBA_MODERATOR && hasEuRole(profile, EU_ROLES.TIEBA_MODERATOR)) return true;
    return false;
}

function canRevokeDelegatedRoles(profile, request) {
    if (!profile) return false;
    if (request && isEuDevSuperUser(request)) return true;
    if (profile.admin === true) return true;
    return hasEuRole(profile, EU_ROLES.SUPER_ADMIN);
}

/**
 * 登录用户为其他账号追加 EU 角色（仅限 mall.publisher / tieba.moderator）。
 * 酒馆管理员、EU super.admin，或已持有对应角色的账号可向下授权。
 */
router.post('/grant', async (request, response) => {
    try {
        const role = String(request.body?.role || '').trim();
        const rawHandle = String(request.body?.handle || '').trim();
        if (!role || !rawHandle) {
            return response.status(400).json({ error: 'Missing handle or role' });
        }
        if (!DELEGATABLE.has(role)) {
            return response.status(400).json({ error: 'Role cannot be granted via this endpoint' });
        }
        const profile = request.user?.profile;
        if (!canGrantDelegatedRole(profile, role, request)) {
            return response.status(403).json({ error: '无权授权：需要酒馆管理员、EU super.admin，或已持有同种权限' });
        }
        const handle = slugify(rawHandle);
        if (!handle) {
            return response.status(400).json({ error: 'Invalid handle' });
        }
        /** @type {import('../users.js').User | undefined} */
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }
        const nextRoles = [...getEuRoleSet(user), role];
        const updated = setEuRoles(user, nextRoles);
        await storage.setItem(toKey(handle), updated);
        appendEuAuditLog(request.user?.profile?.handle, 'eu_role_grant', { handle, role, via: 'eu-rbac-routes' });
        return response.json({ handle, roles: [...getEuRoleSet(updated)].sort() });
    } catch (error) {
        console.error('EU rbac grant failed:', error);
        return response.sendStatus(500);
    }
});

/**
 * 取消账号的商城/贴吧管理权限（移除 mall.publisher 与 tieba.moderator）。
 * 仅网站管理者 / 开发者模式 / 酒馆管理员可执行；不撤销 super.admin。
 */
router.post('/revoke-delegated', async (request, response) => {
    try {
        const rawHandle = String(request.body?.handle || '').trim();
        if (!rawHandle) {
            return response.status(400).json({ error: 'Missing handle' });
        }
        const profile = request.user?.profile;
        if (!canRevokeDelegatedRoles(profile, request)) {
            return response.status(403).json({ error: '无权取消授权：需要网站管理者或开发者模式' });
        }
        const handle = slugify(rawHandle);
        if (!handle) {
            return response.status(400).json({ error: 'Invalid handle' });
        }
        /** @type {import('../users.js').User | undefined} */
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }
        const before = [...getEuRoleSet(user)];
        const updated = stripDelegatedEuRoles(user);
        await storage.setItem(toKey(handle), updated);
        appendEuAuditLog(request.user?.profile?.handle, 'eu_role_revoke_delegated', { handle, via: 'eu-rbac-routes' });
        return response.json({
            handle,
            roles: [...getEuRoleSet(updated)].sort(),
            removed: before.filter(
                (r) => r === EU_ROLES.MALL_PUBLISHER || r === EU_ROLES.TIEBA_MODERATOR,
            ),
        });
    } catch (error) {
        console.error('EU rbac revoke-delegated failed:', error);
        return response.sendStatus(500);
    }
});
