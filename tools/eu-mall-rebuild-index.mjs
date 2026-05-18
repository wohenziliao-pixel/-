#!/usr/bin/env node
/**
 * 从 data/eu-public/mall/resources 重建 node-persist 商城索引 eu:mall:index:v1。
 * 上传 JSON/thumbs 到服务器后执行：node tools/eu-mall-rebuild-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import storage from 'node-persist';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_KEY = 'eu:mall:index:v1';

function normalizeType(t) {
  const v = String(t || 'storybook').toLowerCase();
  if (v === 'character' || v === 'char') return 'character';
  if (v === 'setting' || v === 'world') return 'setting';
  return 'storybook';
}

function normalizeTags(v) {
  const arr = Array.isArray(v) ? v : [v];
  return [...new Set(arr.flatMap((x) => String(x || '').split(/[;；,，、\n\r]+/).map((t) => t.trim())).filter(Boolean))];
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const resDir = path.join(repoRoot, 'data', 'eu-public', 'mall', 'resources');
  if (!fs.existsSync(resDir)) {
    console.error('[EU rebuild-index] 目录不存在:', resDir);
    process.exit(1);
  }
  const rows = [];
  for (const fn of fs.readdirSync(resDir).filter((f) => f.endsWith('.json'))) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(resDir, fn), 'utf8'));
      const id = String(j.id || fn.replace(/\.json$/i, '')).trim();
      if (!id) continue;
      let thumb = null;
      if (typeof j.img === 'string' && j.img.startsWith('/api/eu/mall/thumbs/')) thumb = j.img;
      rows.push({
        id,
        type: normalizeType(j.type),
        title: String(j.title || '').trim(),
        desc: String(j.desc || '').trim(),
        tags: normalizeTags(j.tags),
        thumb,
        adultContent: j.adultContent === true,
        owner: String(j.owner || '').trim() || 'unknown',
        updatedAt: Number(j.updatedAt) || Date.now(),
        createdAt: Number(j.createdAt) || Date.now(),
        version: Number(j.version) || 1,
      });
    } catch {
      /* ignore */
    }
  }
  rows.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  await storage.init({ dir: path.join(repoRoot, 'data', '_storage'), ttl: false, expiredInterval: 0 });
  await storage.setItem(INDEX_KEY, rows);
  console.log(`[EU rebuild-index] 已写入索引 ${rows.length} 条 → ${INDEX_KEY}`);
}

main().catch((e) => {
  console.error('[EU rebuild-index] 失败:', e?.message || e);
  process.exit(1);
});
