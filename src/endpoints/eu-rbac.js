import fs from 'node:fs';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const EU_ROLES = Object.freeze({
    SUPER_ADMIN: 'super.admin',
    MALL_PUBLISHER: 'mall.publisher',
    TIEBA_MODERATOR: 'tieba.moderator',
});

/**
 * @param {import('../users.js').User | null | undefined} user
 * @returns {Set<string>}
 */
export function getEuRoleSet(user) {
    const roles = new Set();
    const list = Array.isArray(user?.euRoles) ? user.euRoles : [];
    for (const r of list) {
        const v = String(r || '').trim();
        if (v) roles.add(v);
    }
    if (user?.admin === true) {
        roles.add(EU_ROLES.SUPER_ADMIN);
        roles.add(EU_ROLES.MALL_PUBLISHER);
        roles.add(EU_ROLES.TIEBA_MODERATOR);
    }
    return roles;
}

/**
 * @param {import('../users.js').User | null | undefined} user
 * @param {string} role
 * @returns {boolean}
 */
export function hasEuRole(user, role) {
    return getEuRoleSet(user).has(String(role || '').trim());
}

/**
 * @param {import('../users.js').User | null | undefined} user
 * @param {string[]} roles
 * @returns {boolean}
 */
export function hasAnyEuRole(user, roles) {
    const roleSet = getEuRoleSet(user);
    return (Array.isArray(roles) ? roles : []).some((r) => roleSet.has(String(r || '').trim()));
}

/**
 * @param {import('express').Request} request
 * @returns {{handle: string, roles: string[]}}
 */
export function euRoleViewForRequest(request) {
    const handle = String(request.user?.profile?.handle || '').trim();
    const roles = [...getEuRoleSet(request.user?.profile)].sort();
    return { handle, roles };
}

/**
 * @param {string} actorHandle
 * @param {string} action
 * @param {Record<string, unknown>} payload
 */
export function appendEuAuditLog(actorHandle, action, payload = {}) {
    try {
        const dir = path.join(globalThis.DATA_ROOT, 'eu-audit');
        fs.mkdirSync(dir, { recursive: true });
        const fp = path.join(dir, 'eu-rbac-audit.log');
        const line = JSON.stringify({
            ts: Date.now(),
            actorHandle: String(actorHandle || '').trim() || 'unknown',
            action: String(action || '').trim() || 'unknown',
            payload: payload && typeof payload === 'object' ? payload : {},
        });
        fs.appendFileSync(fp, `${line}\n`, 'utf8');
    } catch (e) {
        console.warn('[eu-rbac] appendEuAuditLog failed', e?.message || e);
    }
}

/**
 * @param {import('../users.js').User} user
 * @param {string[]} nextRoles
 * @returns {import('../users.js').User}
 */
export function setEuRoles(user, nextRoles) {
    const normalized = [...new Set((Array.isArray(nextRoles) ? nextRoles : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean))];
    return {
        ...user,
        euRoles: normalized,
    };
}

/** 移除可委托的次级管理角色（商城/贴吧）；不改动 super.admin 与酒馆 admin 标志。 */
export function stripDelegatedEuRoles(user) {
    const current = Array.isArray(user?.euRoles) ? user.euRoles : [];
    const next = current.filter((r) => {
        const v = String(r || '').trim();
        return v !== EU_ROLES.MALL_PUBLISHER && v !== EU_ROLES.TIEBA_MODERATOR;
    });
    return setEuRoles(user, next);
}
