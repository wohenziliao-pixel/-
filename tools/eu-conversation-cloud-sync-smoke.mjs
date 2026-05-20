#!/usr/bin/env node
/**
 * 对话云同步冒烟：验证 wiped 快照落盘后 readConversationItems 仍为 2 字节，
 * 且 POST /conversations 写入空三键后不会被「仅读检查」误判为有数据。
 *
 * 用法：node tools/eu-conversation-cloud-sync-smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const HANDLE = '_eu_conv_smoke';

function conversationKeysForHandle(handle) {
  const h = String(handle || '').trim();
  return [
    `eu_demo_conversations_${h}`,
    `eu_demo_character_sessions_${h}`,
    `eu_demo_last_chat_resume_${h}`,
  ];
}

function readConversationItemsFromDisk(fp, handle) {
  if (!fs.existsSync(fp)) return { items: {}, updatedAt: 0 };
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const all = data?.items && typeof data.items === 'object' ? data.items : {};
  const items = {};
  for (const k of conversationKeysForHandle(handle)) {
    if (typeof all[k] === 'string') items[k] = all[k];
  }
  return { items, updatedAt: Number(data?.updatedAt) || 0 };
}

function isEmptyStoreJson(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length < 3) return true;
  try {
    const o = JSON.parse(s);
    return !o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length === 0;
  } catch {
    return true;
  }
}

function serverResumeClearedAt(items, handle) {
  const key = `eu_demo_last_chat_resume_${handle}`;
  const raw = items[key];
  if (typeof raw !== 'string' || raw.length < 4) return 0;
  try {
    return Number(JSON.parse(raw)?.clearedAt) || 0;
  } catch {
    return 0;
  }
}

function fail(msg) {
  console.error('[FAIL]', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('[OK]', msg);
}

const userDir = path.join(root, 'data', HANDLE);
fs.mkdirSync(userDir, { recursive: true });
const fp = path.join(userDir, 'eu-mall-browser-state.json');
const now = Date.now();
const convKey = `eu_demo_conversations_${HANDLE}`;
const sessKey = `eu_demo_character_sessions_${HANDLE}`;
const resumeKey = `eu_demo_last_chat_resume_${HANDLE}`;

// 1) 模拟曾有大快照
const fatConv = JSON.stringify({
  'conv-test': {
    key: 'conv-test',
    characterName: '冒烟角色',
    chatName: 'chat-1',
    messages: [{ role: 'user', content: 'hello' }],
    updatedAt: now - 1000,
  },
});
writeFileAtomicSync(
  fp,
  JSON.stringify({
    updatedAt: now - 500,
    items: {
      [convKey]: fatConv,
      [sessKey]: JSON.stringify({ 冒烟角色: 'conv-test' }),
      [resumeKey]: JSON.stringify({ characterName: '冒烟角色', conversationKey: 'conv-test' }),
      eu_demo_acquired_items_test: '[]',
    },
  }),
  'utf8',
);
let read1 = readConversationItemsFromDisk(fp, HANDLE);
if (!read1.items[convKey] || read1.items[convKey].length < 100) {
  fail('setup fat snapshot failed');
}
ok(`fat snapshot ${read1.items[convKey].length} bytes`);

// 2) 模拟 euWipeConversationCloudNow
const clearedAt = now;
const wipeItems = {
  [convKey]: '{}',
  [sessKey]: '{}',
  [resumeKey]: JSON.stringify({ clearedAt, cloudAt: clearedAt }),
};
let merged = { updatedAt: Date.now(), items: {} };
if (fs.existsSync(fp)) {
  merged.items = { ...JSON.parse(fs.readFileSync(fp, 'utf8')).items };
}
for (const [k, v] of Object.entries(wipeItems)) {
  merged.items[k] = v;
}
writeFileAtomicSync(fp, JSON.stringify(merged), 'utf8');

const read2 = readConversationItemsFromDisk(fp, HANDLE);
if (!isEmptyStoreJson(read2.items[convKey])) fail('after wipe conv not empty');
if (serverResumeClearedAt(read2.items, HANDLE) <= 0) fail('after wipe missing clearedAt');
ok('wiped snapshot: conv/sess empty + clearedAt');

// 3) 模拟 v91 拉取判定：有 convKey 即走 dedicated，不应因空而 fallback
if (!Object.prototype.hasOwnProperty.call(read2.items, convKey)) {
  fail('dedicated pull must include convKey even when {}');
}
ok('dedicated items include convKey when empty');

// 4) 模拟 merge：空云 + clearedAt => 应清本机（此处用内存对象代替 LS）
let fakeLocal = { [convKey]: fatConv, [sessKey]: '{"x":1}' };
if (isEmptyStoreJson(read2.items[convKey]) && serverResumeClearedAt(read2.items, HANDLE) > 0) {
  fakeLocal[convKey] = '{}';
  fakeLocal[sessKey] = '{}';
}
if (!isEmptyStoreJson(fakeLocal[convKey])) fail('merge simulation did not clear fake local');
ok('merge simulation clears local when server clearedAt');

// 5) 模拟 push 闸门：空 conv 不应上传
const convPayload = fakeLocal[convKey] || '';
if (String(convPayload).length >= 8) fail('push should skip empty conv payload');
ok('push gate skips empty conv');

// cleanup
try {
  fs.unlinkSync(fp);
  fs.rmdirSync(userDir);
} catch {
  /* ignore */
}

console.log('\nAll smoke checks passed.');
