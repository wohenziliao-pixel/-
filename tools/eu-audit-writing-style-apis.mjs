#!/usr/bin/env node
/**
 * 服务器侧核对五条文风 Connection Manager（不调用上游 API）。
 * 用法：node tools/eu-audit-writing-style-apis.mjs [handle]
 * 默认 handle=wohenziliao；DATA_ROOT 来自 config.yaml 或环境变量 SILLYTAVERN_DATA_ROOT。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STYLE_ROWS = [
  { id: 'modern', label: '现代风', conn: 'DEEPSEEKV3', src: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324' },
  { id: 'literary', label: '文学风', conn: 'Euryale 70B', src: 'openrouter', model: 'sao10k/l3.1-euryale-70b' },
  { id: 'gentle', label: '温柔风', conn: 'GLM5.1', src: 'custom', model: 'glm-5.1' },
  { id: 'creative', label: '创意风', conn: 'GROK4.3', src: 'xai', model: 'grok-4.3' },
  { id: 'explicit', label: '重口风', conn: 'VENICE', src: 'custom', model: 'venice-uncensored-role-play' },
];

function readDataRoot() {
  if (process.env.SILLYTAVERN_DATA_ROOT) {
    return path.resolve(process.env.SILLYTAVERN_DATA_ROOT);
  }
  const cfgPath = path.join(ROOT, 'config.yaml');
  if (!fs.existsSync(cfgPath)) return path.join(ROOT, 'data');
  const cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dr = String(cfg?.dataRoot || './data').trim();
  return path.isAbsolute(dr) ? dr : path.join(ROOT, dr);
}

function normConnKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

function findProfile(profiles, name) {
  const key = String(name || '').trim();
  if (!key || !Array.isArray(profiles)) return null;
  let hit = profiles.find((p) => String(p?.name || '').trim() === key);
  if (hit) return hit;
  const lower = key.toLowerCase();
  hit = profiles.find((p) => String(p?.name || '').trim().toLowerCase() === lower);
  if (hit) return hit;
  const norm = normConnKey(key);
  return profiles.find((p) => normConnKey(p?.name) === norm) || null;
}

function main() {
  const handle = String(process.argv[2] || 'wohenziliao').trim().toLowerCase();
  const dataRoot = readDataRoot();
  const settingsPath = path.join(dataRoot, handle, 'settings.json');
  const secretsPath = path.join(dataRoot, handle, 'secrets.json');
  if (!fs.existsSync(settingsPath)) {
    console.error(`未找到 ${settingsPath}`);
    process.exit(1);
  }
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  let ext = settings?.extension_settings;
  if (typeof ext === 'string') ext = JSON.parse(ext);
  const profiles = ext?.connectionManager?.profiles;
  if (!Array.isArray(profiles)) {
    console.error('settings.json 内无 connectionManager.profiles');
    process.exit(1);
  }
  let secrets = null;
  if (fs.existsSync(secretsPath)) {
    try {
      secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    } catch {
      secrets = null;
    }
  }
  const customArr = Array.isArray(secrets?.api_key_custom) ? secrets.api_key_custom : [];
  const orKey = String(secrets?.api_key_openrouter || secrets?.openrouter || '').trim();
  const xaiKey = String(secrets?.api_key_xai || secrets?.xai || '').trim();

  console.log(`DATA_ROOT=${dataRoot}`);
  console.log(`handle=${handle}`);
  console.log(`profiles=${profiles.length} customSecrets=${customArr.length} openrouterKey=${orKey ? 'yes' : 'no'} xaiKey=${xaiKey ? 'yes' : 'no'}`);
  console.log('---');

  for (const row of STYLE_ROWS) {
    const tp = findProfile(profiles, row.conn);
    const issues = [];
    if (!tp) issues.push('profile_missing');
    else {
      const api = String(tp.api || tp.connectionSnapshot?.chat_completion_source || '').toLowerCase();
      if (api && api !== row.src) issues.push(`api=${api}≠${row.src}`);
      const sid = String(tp['secret-id'] || '').trim();
      if (!sid) issues.push('no_secret-id');
      const exclude = Array.isArray(tp.exclude) ? tp.exclude : [];
      if (exclude.includes('secret-id')) issues.push('exclude_secret-id');
      if (row.src === 'openrouter' && !orKey && !sid) issues.push('no_openrouter_key');
      if (row.src === 'xai' && !xaiKey && !sid) issues.push('no_xai_key');
      if (row.src === 'custom' && !customArr.length && !sid) issues.push('no_custom_secrets');
    }
    const ok = issues.length === 0;
    console.log(`${ok ? 'OK' : 'FAIL'}\t${row.label}\t${row.conn}\t${row.src}\t${row.model}\t${issues.join(',') || '-'}`);
  }
}

main();
