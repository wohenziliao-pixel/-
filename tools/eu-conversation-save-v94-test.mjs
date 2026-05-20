#!/usr/bin/env node
/**
 * v94 服务端「清锁后新会话可写」逻辑自测（不依赖登录）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu-v94-'));
const handle = '_v94_test_user';
const fp = path.join(tmp, 'eu-mall-browser-state.json');

function isEmptyConversationStoreJson(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length < 3) return true;
  try {
    const o = JSON.parse(s);
    return !o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length === 0;
  } catch {
    return true;
  }
}

function resumeClearedAtFromItems(items, h) {
  const raw = items?.[`eu_demo_last_chat_resume_${h}`];
  if (typeof raw !== 'string' || raw.length < 4) return 0;
  try {
    return Number(JSON.parse(raw)?.clearedAt) || 0;
  } catch {
    return 0;
  }
}

function incomingIsNewSessionAfterServerClear(existingItems, incoming, h) {
  if (resumeClearedAtFromItems(existingItems, h) <= 0) return false;
  const convKey = `eu_demo_conversations_${h}`;
  const resumeKey = `eu_demo_last_chat_resume_${h}`;
  if (isEmptyConversationStoreJson(incoming[convKey])) return false;
  const raw = incoming[resumeKey];
  if (typeof raw === 'string' && raw.length > 4) {
    try {
      const snap = JSON.parse(raw);
      if (Number(snap?.clearedAt) > 0) return false;
      if (String(snap?.conversationKey || snap?.characterName || '').trim()) return true;
    } catch {
      /* fall through */
    }
  }
  const sessKey = `eu_demo_character_sessions_${h}`;
  const sessRaw = incoming[sessKey];
  if (typeof sessRaw !== 'string' || sessRaw.length < 4 || sessRaw.trim() === '{}') return false;
  try {
    const sess = JSON.parse(sessRaw);
    return Boolean(sess && typeof sess === 'object' && !Array.isArray(sess) && Object.keys(sess).length > 0);
  } catch {
    return false;
  }
}

function shouldRejectIncomingConversationKey(existingItems, incoming, h, key) {
  if (incomingIsNewSessionAfterServerClear(existingItems, incoming, h)) return false;
  const cleared = resumeClearedAtFromItems(existingItems, h);
  if (cleared <= 0) return false;
  const k = String(key || '');
  if (k.includes('eu_demo_conversations_') && !isEmptyConversationStoreJson(incoming[k])) return true;
  if (k.includes('eu_demo_character_sessions_') && String(incoming[k] || '').length > 4) return true;
  return false;
}

function unlockServerClearLockOnMergedResume(items, h) {
  const convKey = `eu_demo_conversations_${h}`;
  const resumeKey = `eu_demo_last_chat_resume_${h}`;
  if (isEmptyConversationStoreJson(items[convKey])) return;
  const raw = items[resumeKey];
  if (typeof raw !== 'string' || raw.length < 4) return;
  try {
    const snap = JSON.parse(raw);
    if (!Number(snap?.clearedAt)) return;
    delete snap.clearedAt;
    if (!Number(snap.cloudAt)) snap.cloudAt = Date.now();
    items[resumeKey] = JSON.stringify(snap);
  } catch {
    /* ignore */
  }
}

function mergePost(existing, incoming, h) {
  const merged = { ...existing };
  const saved = [];
  const skipped = [];
  for (const key of [
    `eu_demo_conversations_${h}`,
    `eu_demo_character_sessions_${h}`,
    `eu_demo_last_chat_resume_${h}`,
  ]) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    if (shouldRejectIncomingConversationKey(merged, incoming, h, key)) {
      skipped.push(key);
      continue;
    }
    merged[key] = incoming[key];
    saved.push(key);
  }
  unlockServerClearLockOnMergedResume(merged, h);
  return { merged, saved, skipped };
}

// 1) 模拟 wipe
const clearedAt = Date.now() - 60000;
writeFileAtomicSync(
  fp,
  JSON.stringify({
    updatedAt: clearedAt,
    items: {
      [`eu_demo_conversations_${handle}`]: '{}',
      [`eu_demo_character_sessions_${handle}`]: '{}',
      [`eu_demo_last_chat_resume_${handle}`]: JSON.stringify({ clearedAt, cloudAt: clearedAt }),
    },
  }),
  'utf8',
);

const disk1 = JSON.parse(fs.readFileSync(fp, 'utf8'));
let fail = 0;

// 2) 旧客户端：resume 仍带 clearedAt 却推非空 conv → 应拒写
const staleIncoming = {
  [`eu_demo_conversations_${handle}`]: JSON.stringify({
    k1: { key: 'k1', characterName: '测试书', messages: [{ role: 'user', content: 'hi' }], updatedAt: Date.now() },
  }),
  [`eu_demo_character_sessions_${handle}`]: JSON.stringify({ 测试书: 'k1' }),
  [`eu_demo_last_chat_resume_${handle}`]: JSON.stringify({
    clearedAt,
    cloudAt: clearedAt,
    conversationKey: 'k1',
    characterName: '测试书',
    updatedAt: Date.now(),
  }),
};
const stale = mergePost(disk1.items, staleIncoming, handle);
if (!stale.skipped.includes(`eu_demo_conversations_${handle}`)) {
  console.error('[FAIL] stale session should reject conv under cleared lock');
  fail++;
} else {
  console.log('[OK] cleared lock rejects stale cloudAt conv');
}

// 3) v94 新会话：无 clearedAt、有 conversationKey → 三键应写入
const now = Date.now();
const freshIncoming = {
  [`eu_demo_conversations_${handle}`]: JSON.stringify({
    k1: { key: 'k1', characterName: '测试书', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }], updatedAt: now },
  }),
  [`eu_demo_character_sessions_${handle}`]: JSON.stringify({ 测试书: 'k1' }),
  [`eu_demo_last_chat_resume_${handle}`]: JSON.stringify({
    conversationKey: 'k1',
    characterName: '测试书',
    cloudAt: now,
    updatedAt: now,
  }),
};
const fresh = mergePost(disk1.items, freshIncoming, handle);
const convKey = `eu_demo_conversations_${handle}`;
const resumeKey = `eu_demo_last_chat_resume_${handle}`;
if (fresh.skipped.length) {
  console.error('[FAIL] fresh session skipped', fresh.skipped);
  fail++;
} else if (isEmptyConversationStoreJson(fresh.merged[convKey])) {
  console.error('[FAIL] fresh conv empty on disk merge');
  fail++;
} else if (resumeClearedAtFromItems(fresh.merged, handle) > 0) {
  console.error('[FAIL] clearedAt not unlocked after save');
  fail++;
} else {
  console.log('[OK] v94 new session saves conv + unlocks clearedAt');
}

// 4) v95：无 resume 但有 conv+sessions → 应放行写入
const noResumeIncoming = {
  [`eu_demo_conversations_${handle}`]: JSON.stringify({
    k2: { key: 'k2', characterName: '无resume书', messages: [{ role: 'user', content: 'x' }], updatedAt: now },
  }),
  [`eu_demo_character_sessions_${handle}`]: JSON.stringify({ 无resume书: 'k2' }),
};
const disk2 = JSON.parse(fs.readFileSync(fp, 'utf8'));
const noResume = mergePost(disk2.items, noResumeIncoming, handle);
if (noResume.skipped.includes(convKey)) {
  console.error('[FAIL] v95 conv+sess without resume should save');
  fail++;
} else {
  console.log('[OK] v95 conv+sess without resume saves under cleared lock');
}

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(fail ? '\n[FAIL] v94 server logic test' : '\n[PASS] v94 server save logic');
process.exit(fail ? 1 : 0);
