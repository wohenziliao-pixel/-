/**
 * 将 config.euSharedApiFromHandle 的 API 配置套用到 data/ 下所有用户（不含源账号与系统目录）。
 * 用法：cd /opt/SillyTavern && node tools/eu-shared-api-sync-all.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initConfig } from '../src/config-init.js';
import { getConfigValue } from '../src/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(repoRoot, 'data');

const SKIP = new Set([
    '_cache', '_storage', '_uploads', '_webpack',
    'eu-public', 'eu-audit', 'eu-tieba-avatars', 'eu-tieba-media',
]);

async function main() {
    initConfig(path.join(repoRoot, 'config.yaml'));
    const dataRootCfg = String(getConfigValue('dataRoot', './data', 'string') || './data');
    globalThis.DATA_ROOT = path.isAbsolute(dataRootCfg)
        ? dataRootCfg
        : path.resolve(repoRoot, dataRootCfg);

    const { applyEuSharedApiProfile, getEuSharedApiSourceHandle } = await import('../src/endpoints/eu-shared-api.js');
    const { getUserDirectories } = await import('../src/users.js');

    const src = getEuSharedApiSourceHandle();
    if (!src) {
        console.error('config.yaml 未设置 euSharedApiFromHandle');
        process.exit(1);
    }

    let ok = 0;
    let skip = 0;
    for (const name of fs.readdirSync(dataRoot)) {
        if (SKIP.has(name) || name === src) {
            skip++;
            continue;
        }
        const p = path.join(dataRoot, name);
        if (!fs.statSync(p).isDirectory()) {
            continue;
        }
        const r = applyEuSharedApiProfile(getUserDirectories(name));
        console.log(name, r);
        if (r.applied) {
            ok++;
        }
    }

    console.log(`完成：套用 ${ok} 个用户，跳过 ${skip} 个目录/源账号`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
