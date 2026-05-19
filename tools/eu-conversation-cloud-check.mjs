#!/usr/bin/env node
/**
 * 检查某账号云端对话快照是否落盘（data/<handle>/eu-mall-browser-state.json）。
 * 用法：node tools/eu-conversation-cloud-check.mjs wohenziliao
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const handle = String(process.argv[2] || '').trim();
if (!handle) {
  console.error('用法: node tools/eu-conversation-cloud-check.mjs <handle>');
  process.exit(1);
}

function resolveUserRoot(h) {
  const direct = path.join(root, 'data', h);
  if (fs.existsSync(direct)) return direct;
  const storage = path.join(root, 'data', '_storage', h);
  if (fs.existsSync(storage)) return storage;
  return direct;
}

const fp = path.join(resolveUserRoot(handle), 'eu-mall-browser-state.json');
if (!fs.existsSync(fp)) {
  console.log(`[EU] 无快照文件: ${fp}`);
  process.exit(0);
}

const raw = fs.readFileSync(fp, 'utf8');
const data = JSON.parse(raw);
const items = data?.items && typeof data.items === 'object' ? data.items : {};
const updatedAt = Number(data?.updatedAt) || 0;
const convKey = `eu_demo_conversations_${handle}`;
const sessKey = `eu_demo_character_sessions_${handle}`;
const resumeKey = `eu_demo_last_chat_resume_${handle}`;

for (const k of [convKey, sessKey, resumeKey]) {
  const v = items[k];
  const len = typeof v === 'string' ? v.length : 0;
  let convCount = 0;
  let msgCount = 0;
  if (k === convKey && len > 4) {
    try {
      const store = JSON.parse(v);
      if (store && typeof store === 'object') {
        convCount = Object.keys(store).length;
        for (const c of Object.values(store)) {
          if (c && Array.isArray(c.messages)) msgCount += c.messages.length;
        }
      }
    } catch {
      /* ignore */
    }
  }
  console.log(`${k}: ${len} bytes${k === convKey && convCount ? ` (${convCount} conv, ${msgCount} msgs)` : ''}`);
}

console.log(`updatedAt: ${updatedAt} (${updatedAt ? new Date(updatedAt).toISOString() : 'n/a'})`);
console.log(`file: ${fp} (${raw.length} bytes total)`);
