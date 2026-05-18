/**
 * 故事书 AI 归纳标签（服务端直连 xAI，供商城批量/单本补标签）。
 */
import { readSecret, SECRET_KEYS } from './secrets.js';

const XAI_API = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4.3';
const MAX_HAY = 14000;

function sanitizeHayForApi(hay) {
    let s = String(hay || '').replace(/\u0000/g, '');
    s = s.replace(/\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g, '/');
    return s.slice(0, MAX_HAY);
}

function looksLikeInstructionFragment(inner) {
    const s = String(inner || '').trim();
    if (!s) return false;
    return /dialogue_antThinking|antThinking|模拟内容\s*[:：]|正文要求(?:风格)?\s*[:：]/i.test(s);
}

function stripInstructionFragments(text) {
    let s = String(text || '');
    if (!s) return '';
    s = s.replace(/<!--([\s\S]*?)-->/g, (full, inner) => (looksLikeInstructionFragment(inner) ? '' : full));
    s = s.replace(/\(\s*模拟内容\s*[:：][\s\S]*?\)/g, '');
    s = s.replace(/\(\s*正文要求(?:风格)?\s*[:：][\s\S]*?\)/g, '');
    return s;
}

export function gatherInferTextFromCard(raw) {
    const clean = raw && typeof raw === 'object' ? raw : {};
    const data = clean.data && typeof clean.data === 'object' ? clean.data : {};
    const parts = [];
    const push = (s, cap = 4000) => {
        const t = stripInstructionFragments(String(s || '').trim());
        if (t) parts.push(cap > 0 && t.length > cap ? `${t.slice(0, cap)}…` : t);
    };
    const openings = [
        clean.first_mes,
        data.first_mes,
        ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings.slice(0, 3) : []),
        ...(Array.isArray(clean.alternate_greetings) ? clean.alternate_greetings.slice(0, 3) : []),
    ];
    openings.forEach((o) => push(o, 3500));
    const descA = String(clean.description || clean.desc || '').trim();
    const descB = String(data.description || '').trim();
    const techRe = /KIMETSU_HUD|HUD_START|findRegex|角色需要更新状态栏|严格遵守以下格式/i;
    if (descA && !techRe.test(descA)) push(descA, 2000);
    if (descB && !techRe.test(descB)) push(descB, 2000);
    push(data.scenario || clean.scenario || '', 1500);
    push(data.personality || clean.personality || '', 1500);
    push(clean.tags || '');
    push(data.tags || '');
    const entries =
        Array.isArray(data.character_book?.entries) ? data.character_book.entries
        : Array.isArray(data.entries) ? data.entries
        : Array.isArray(clean.entries) ? clean.entries
        : [];
    for (const e of entries.slice(0, 48)) {
        push([e?.comment, e?.name, e?.key].filter(Boolean).join(' '), 200);
        push(e?.content, 600);
    }
    push(Array.isArray(clean.catalog) ? clean.catalog.slice(0, 30).join('\n') : clean.catalog || '', 2000);
    return sanitizeHayForApi(parts.filter(Boolean).join('\n'));
}

function stripOpeningForListDesc(text) {
    let s = stripInstructionFragments(String(text || '').trim());
    if (!s) return '';
    const optIdx = s.search(/<\s*option\b/i);
    if (optIdx >= 0) s = s.slice(0, optIdx).trim();
    const stepIdx = s.search(/我的下一步行动\s*[:：]/);
    if (stepIdx >= 0) s = s.slice(0, stepIdx).trim();
    return s
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function trimOpeningAtChoiceMenu(s) {
    let t = String(s || '').trim();
    if (!t) return '';
    for (const re of [
        /▼\s*请选择[\s\S]*/,
        /【选项\s*[A-ZＡ-Ｚ][\s\S]*/,
        /<\s*option\b[\s\S]*/i,
        /我的下一步行动\s*[:：][\s\S]*/,
        /(?:^|\n)\s*(?:\d+\.\s*)?姓名\s*[:：\[][\s\S]*/,
    ]) {
        t = t.replace(re, '').trim();
    }
    return t;
}

function stripSystemPrefaceForDesc(s) {
    let t = String(s || '').trim();
    if (!t) return '';
    t = t.replace(/^（意识在混沌中浮沉[^）]*）\s*/u, '').trim();
    t = t.replace(/（[^）]*(?:数据流|机械音)[^）]*）\s*/g, '').trim();
    if (/\r?\n/.test(t)) {
        t = t.split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !/^(?:SYSTEM|ANCHORING|HIGHEST_[A-Z_]+)\s*[:：]/i.test(line))
            .filter((line) => !/^智脑\s*SYSTEM/i.test(line))
            .join(' ')
            .trim();
    } else {
        t = t.replace(/SYSTEM\s*:\s*HIGHEST_[A-Z_]+[^。）"]*/gi, '').trim();
        t = t.replace(/智脑\s*SYSTEM\s*:\s*/gi, '').trim();
    }
    const welcome = t.match(/欢迎来到【[^】]+】[^▼【]*/);
    if (welcome && welcome[0].length >= 10) {
        const chunk = welcome[0].replace(/▼[\s\S]*$/, '').trim();
        if (chunk.length >= 10) return chunk;
    }
    return t;
}

/** 酒馆 HTML / ```html 开场白 → 纯文本简介。 */
function extractNarrativeFromHtmlOpening(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    s = s.replace(/<StatusPlaceHolder[^>]*\/?>/gi, '');
    s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|motion|div|h\d|li|section|article)>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = stripOpeningForListDesc(s);
    s = trimOpeningAtChoiceMenu(s);
    const formIdx = s.search(/(?:^|\n)\s*(?:\d+\.\s*)?姓名\s*[:：\[]/);
    if (formIdx > 80) s = s.slice(0, formIdx).trim();
    return s;
}

const LIST_DESC_EXCERPT_MAX = 280;
const LIST_DESC_FULL_MAX = 1200;
const LIST_DESC_OPENING_PREFIX = '【开场白】\n';

function truncateAtSentenceBoundary(text, maxLen) {
    const s = String(text || '').trim();
    if (!s || maxLen <= 0) return '';
    if (s.length <= maxLen) return s;
    const chunk = s.slice(0, maxLen);
    const punct = /[。！？!?…\n]/g;
    let lastEnd = -1;
    let m;
    while ((m = punct.exec(chunk))) {
        if (m.index + 1 >= 40) lastEnd = m.index + 1;
    }
    if (lastEnd > 0) return chunk.slice(0, lastEnd).trim();
    const space = chunk.lastIndexOf(' ');
    if (space >= Math.floor(maxLen * 0.55)) return `${chunk.slice(0, space).trim()}…`;
    return `${chunk.trim()}…`;
}

function looksLikeBrokenListExcerpt(excerpt, full) {
    const e = String(excerpt || '').trim();
    const f = String(full || '').trim();
    if (!e || e.length < 20) return true;
    if (!e.endsWith('…')) return false;
    const body = e.replace(/…+$/, '').trim();
    if (body.length < 40) return true;
    if (/[。！？!?…]$/.test(body)) return false;
    if (f.length > e.length + 12) return true;
    return false;
}

function openingToListDesc(opening) {
    let s = String(opening || '').trim();
    if (!s) return '';
    if (/<style\b|<!DOCTYPE|<html\b|```(?:html)?/i.test(s)) {
        const fromHtml = extractNarrativeFromHtmlOpening(s);
        if (fromHtml) s = fromHtml;
    } else {
        s = stripOpeningForListDesc(s);
    }
    s = stripSystemPrefaceForDesc(s);
    s = trimOpeningAtChoiceMenu(s);
    if (s.length < 12 || looksLikeTechnicalListDesc(s)) return '';
    const fullForStorage = s.length > LIST_DESC_FULL_MAX
        ? truncateAtSentenceBoundary(s, LIST_DESC_FULL_MAX)
        : s;
    const excerpt = truncateAtSentenceBoundary(s, LIST_DESC_EXCERPT_MAX);
    if (
        !looksLikeBrokenListExcerpt(excerpt, s) &&
        excerpt.length >= 40 &&
        excerpt.length < s.length - 20
    ) {
        return excerpt;
    }
    return `${LIST_DESC_OPENING_PREFIX}${fullForStorage}`;
}

function looksLikeTechnicalListDesc(text) {
    const s = String(text || '').trim();
    if (!s || /^从文件导入$/i.test(s)) return true;
    return /KIMETSU_HUD|HUD_START|findRegex|角色需要更新状态栏|严格遵守以下格式|原文件.*数据/i.test(s);
}

/** 商城/列表简介：优先开场白叙事节选。 */
export function buildMallListDescFromRaw(raw) {
    const clean = raw && typeof raw === 'object' ? raw : {};
    const data = clean.data && typeof clean.data === 'object' ? clean.data : {};
    const openings = [
        clean.first_mes,
        data.first_mes,
        ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings.slice(0, 2) : []),
        ...(Array.isArray(clean.alternate_greetings) ? clean.alternate_greetings.slice(0, 2) : []),
    ];
    for (const o of openings) {
        const s = openingToListDesc(o);
        if (s) return s;
    }
    const prev = String(clean.desc || clean.description || data.description || '').trim();
    if (prev && !looksLikeTechnicalListDesc(prev)) {
        const p = stripOpeningForListDesc(prev);
        if (p.length >= 8) return p.length > 400 ? truncateAtSentenceBoundary(p, 400) : p;
    }
    return null;
}

/** 供 preview API：纯文本开场白（去选项/HTML，最长约 6k）。 */
export function extractOpeningPlainFromRaw(raw) {
    const clean = raw && typeof raw === 'object' ? raw : {};
    const data = clean.data && typeof clean.data === 'object' ? clean.data : {};
    const openings = [
        clean.first_mes,
        data.first_mes,
        ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings.slice(0, 2) : []),
        ...(Array.isArray(clean.alternate_greetings) ? clean.alternate_greetings.slice(0, 2) : []),
    ];
    for (const o of openings) {
        if (o == null || o === '') continue;
        let s = String(o).trim();
        if (!s) continue;
        if (/<style\b|<!DOCTYPE|<html\b|```(?:html)?/i.test(s)) {
            s = extractNarrativeFromHtmlOpening(s);
        } else {
            s = stripOpeningForListDesc(s);
            s = trimOpeningAtChoiceMenu(s);
            s = stripSystemPrefaceForDesc(s);
        }
        if (s.length >= 8 && !looksLikeTechnicalListDesc(s)) {
            return s.length > 6000 ? `${s.slice(0, 6000).trim()}…` : s;
        }
    }
    return '';
}

/** 服务端小体积预览：简介 + 开场白纯文本（不返回 raw）。 */
export function buildMallResourcePreview(raw, payload = {}) {
    const body = raw && typeof raw === 'object' ? raw : {};
    const desc = buildMallListDescFromRaw(body) || String(payload.desc || '').trim() || '';
    let openingPlain = extractOpeningPlainFromRaw(body);
    if (!openingPlain && typeof payload.first_mes === 'string') {
        openingPlain = extractOpeningPlainFromRaw({ first_mes: payload.first_mes, data: { first_mes: payload.first_mes } });
    }
    if (!openingPlain && desc.startsWith(LIST_DESC_OPENING_PREFIX)) {
        openingPlain = desc.slice(LIST_DESC_OPENING_PREFIX.length).trim();
    }
    if (!openingPlain && desc.length > 40 && !looksLikeTechnicalListDesc(desc)) {
        openingPlain = desc.replace(/^【开场白】\s*\n?/, '').trim();
    }
    return { desc, openingPlain };
}

const ADULT_TAG_RE = /^(成人内容|18\+|18禁|R-?18|NSFW)$/i;

export function isAdultSynonymTag(tag) {
    const s = String(tag || '').trim();
    if (!s) return false;
    if (ADULT_TAG_RE.test(s)) return true;
    return /成人向|工口|露骨色情/.test(s);
}

/** 去掉分级类标签，再由 adultContent 决定是否加回「成人内容」。 */
export function stripAdultSynonymTags(tags) {
    const arr = Array.isArray(tags) ? tags : [];
    return arr.filter((t) => !isAdultSynonymTag(t));
}

export function applyAdultToTagList(tags, adultContent) {
    let list = stripAdultSynonymTags(Array.isArray(tags) ? tags : []);
    if (adultContent === true) {
        const seen = new Set(list.map((t) => String(t).toLowerCase()));
        if (!seen.has('成人内容')) list.push('成人内容');
    }
    return filterTagsCnPreferred(list);
}

/** 成人/全年龄仅以模型 JSON 字段为准，不用 tags 关键词兜底。 */
export function resolveAdultContentFromLlm(j) {
    if (!j || typeof j !== 'object') return false;
    if (j.adultContent === true || j.nsfw === true) return true;
    if (j.adultContent === false || j.allAges === true || j.sfw === true) return false;
    return false;
}

function buildAdultOnlyInferMessages(title, hay) {
    const system = [
        '你是内容分级审核员。只根据标题与正文摘录判断该互动小说是否属于成人向（R18）。',
        '只输出一行 JSON：{"adultContent":true|false,"reason":"一句话中文理由"}',
        '判定标准：',
        '- true：露骨性行为/性器官/性爱过程描写、以色情为主轴、重口性癖、明确 R18/NTR 性爱玩法为核心',
        '- false：全年龄、冒险悬疑日常、纯爱无露骨性、仅暧昧/接吻、战斗成长向、亲子非性描写',
        '忽略导入时的旧标签与勾选；只信正文。拿不准时 false。',
    ].join('\n');
    const user = `标题：${String(title || '').trim() || '（无标题）'}\n\n正文摘录：\n${String(hay || '').trim() || '（无正文）'}`;
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export function parseAdultOnlyLlmJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    let jsonStr = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonStr = fence[1].trim();
    else {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) jsonStr = raw.slice(start, end + 1);
    }
    let j;
    try {
        j = JSON.parse(jsonStr);
    } catch {
        return null;
    }
    if (!j || typeof j !== 'object') return null;
    return {
        adultContent: resolveAdultContentFromLlm(j),
        reason: String(j.reason || '').trim().slice(0, 120),
    };
}

export async function inferStorybookAdultWithXai(apiKey, opts = {}) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('未配置 xAI API 密钥');
    const model = String(opts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const hay = sanitizeHayForApi(String(opts.hay || ''));
    if (!hay.trim()) throw new Error('正文过短，无法判断分级');
    const res = await fetch(XAI_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model,
            messages: buildAdultOnlyInferMessages(opts.title, hay),
            temperature: 0.2,
            max_tokens: 180,
            stream: false,
        }),
    });
    const body = await res.text();
    if (!res.ok) {
        throw new Error(`xAI HTTP ${res.status}: ${body.slice(0, 280)}`);
    }
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        throw new Error('xAI 响应非 JSON');
    }
    const reply = data?.choices?.[0]?.message?.content;
    const parsed = parseAdultOnlyLlmJson(typeof reply === 'string' ? reply : '');
    if (!parsed) throw new Error('AI 分级 JSON 解析失败');
    return parsed;
}

function buildTagInferMessages(title, hay) {
    const system = [
        '你是互动小说/角色卡商城的分类编辑。根据标题与正文摘录归纳中文标签与分级。',
        '只输出一行 JSON，不要 markdown。',
        '格式：{"orientation":"男性向"|"女性向"|"通用"|null,"adultContent":true|false,"tags":["标签1",...]}',
        '分级（adultContent，必须据正文判断，勿沿用导入时假设）：',
        '- true：明确 R18、露骨性描写/性行为、以色情为主轴、重口性癖、标题或世界书大量性相关设定',
        '- false：全年龄、恋爱无露骨性、悬疑冒险日常、仅暧昧接吻、校园纯爱、无性内容的同人冒险等',
        'tags 3～8 个简体中文题材/受众；勿在 tags 里写「成人内容」（由 adultContent 字段表达）；orientation 据叙事重心。',
    ].join('\n');
    const user = `标题：${String(title || '').trim() || '（无标题）'}\n\n正文摘录：\n${String(hay || '').trim() || '（无正文）'}`;
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

function filterTagsCnPreferred(tags) {
    const out = [];
    const seen = new Set();
    for (const raw of tags) {
        const s = String(raw || '').trim();
        if (!s) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        if (/[\u4e00-\u9fff]/.test(s) || /^(R-?\d+[a-z]?|NSFW|NTR|BL|GL)$/i.test(s)) {
            seen.add(k);
            out.push(s);
        }
    }
    return out;
}

export function parseLlmTagJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    let jsonStr = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonStr = fence[1].trim();
    else {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) jsonStr = raw.slice(start, end + 1);
    }
    let j;
    try {
        j = JSON.parse(jsonStr);
    } catch {
        return null;
    }
    if (!j || typeof j !== 'object') return null;
    const tags = [];
    const seen = new Set();
    const pushTag = (t) => {
        const s = String(t || '').trim();
        if (!s || s.length > 24 || /^从文件导入$/i.test(s)) return;
        const k = s.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        tags.push(s);
    };
    if (Array.isArray(j.tags)) j.tags.forEach(pushTag);
    const o = String(j.orientation || '').trim();
    if (/男性向/.test(o)) pushTag('男性向');
    else if (/女性向/.test(o)) pushTag('女性向');
    const adultContent = resolveAdultContentFromLlm(j);
    return {
        tags: applyAdultToTagList(tags, adultContent),
        adultContent,
    };
}

/**
 * @param {string} apiKey
 * @param {{ model?: string, title?: string, hay?: string }} opts
 */
export async function inferStorybookTagsWithXai(apiKey, opts = {}) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('未配置 xAI API 密钥');
    const model = String(opts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const res = await fetch(XAI_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model,
            messages: buildTagInferMessages(opts.title, opts.hay),
            temperature: 0.35,
            max_tokens: 640,
            stream: false,
        }),
    });
    const body = await res.text();
    if (!res.ok) {
        throw new Error(`xAI HTTP ${res.status}: ${body.slice(0, 280)}`);
    }
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        throw new Error('xAI 响应非 JSON');
    }
    const reply = data?.choices?.[0]?.message?.content;
    const parsed = parseLlmTagJson(typeof reply === 'string' ? reply : '');
    if (!parsed?.tags?.length) throw new Error('AI 返回无法解析为标签 JSON');
    return parsed;
}

export function readXaiKeyForUser(directories) {
    return readSecret(directories, SECRET_KEYS.XAI);
}

export { DEFAULT_MODEL as EU_LLM_TAG_DEFAULT_MODEL };
