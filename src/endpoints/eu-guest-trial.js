/**
 * 游客试用：浏览商城（见 eu-mall-resources 公开 GET）、拉取共用 API 配置、限流对话生成（不落库）。
 */
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpFromRequest } from '../express-common.js';
import { getConfigValue } from '../util.js';
import { getUserDirectories } from '../users.js';
import {
    EU_LLM_TAG_DEFAULT_MODEL,
    readXaiKeyForUser,
} from './eu-storybook-llm-tags.js';

export const router = express.Router();

const jsonBody = express.json({ limit: '6mb' });
const XAI_API = 'https://api.x.ai/v1/chat/completions';

const profileLimiter = new RateLimiterMemory({ points: 120, duration: 3600 });
const generateLimiter = new RateLimiterMemory({ points: 48, duration: 3600 });

/** @param {import('express').Request} req */
function clientIp(req) {
    return getIpFromRequest(req) || 'unknown';
}

function sharedHandle() {
    return String(getConfigValue('euSharedApiFromHandle', '', 'string') || '').trim().toLowerCase();
}

function sharedDirectories() {
    const h = sharedHandle();
    if (!h) {
        return null;
    }
    try {
        return getUserDirectories(h);
    } catch {
        return null;
    }
}

/** @param {import('express').Request} req @param {import('express').Response} res @param {import('express').NextFunction} next */
function requireGuestTrialReady(req, res, next) {
    const dirs = sharedDirectories();
    if (!dirs) {
        return res.status(503).json({ error: '未配置 euSharedApiFromHandle，无法提供游客试用对话' });
    }
    const key = readXaiKeyForUser(dirs);
    if (!key) {
        return res.status(503).json({ error: '站点共用 xAI 密钥未配置' });
    }
    req.euGuestTrialDirs = dirs;
    req.euGuestTrialApiKey = key;
    return next();
}

router.get('/generation-profile', requireGuestTrialReady, async (req, res) => {
    try {
        await profileLimiter.consume(clientIp(req));
    } catch (e) {
        if (e instanceof RateLimiterRes) {
            return res.status(429).json({ error: '试用请求过于频繁，请稍后再试' });
        }
        throw e;
    }
    return res.json({
        ok: true,
        chat_completion_source: 'xai',
        model: EU_LLM_TAG_DEFAULT_MODEL,
        max_context: 16383,
        max_tokens: 2048,
        temperature: 0.85,
        sourcePreset: 'guest-trial',
    });
});

router.post('/generate', jsonBody, requireGuestTrialReady, async (req, res) => {
    try {
        await generateLimiter.consume(clientIp(req));
    } catch (e) {
        if (e instanceof RateLimiterRes) {
            return res.status(429).json({ error: '试用对话过于频繁，请登录后继续' });
        }
        throw e;
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
        return res.status(400).json({ error: 'messages required' });
    }
    const model = String(body.model || EU_LLM_TAG_DEFAULT_MODEL).trim() || EU_LLM_TAG_DEFAULT_MODEL;
    const maxTokens = Math.max(256, Math.min(8192, Number(body.max_tokens) || 2048));
    const temperature = Math.min(2, Math.max(0, Number(body.temperature ?? 0.85)));
    const safeMessages = messages
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
            role: ['system', 'user', 'assistant'].includes(String(m.role)) ? String(m.role) : 'user',
            content: String(m.content ?? '').slice(0, 120000),
        }))
        .filter((m) => m.content.trim());
    if (!safeMessages.length) {
        return res.status(400).json({ error: 'messages empty' });
    }
    try {
        const upstream = await fetch(XAI_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${req.euGuestTrialApiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: safeMessages,
                temperature,
                max_tokens: maxTokens,
                stream: false,
            }),
        });
        const text = await upstream.text();
        if (!upstream.ok) {
            return res.status(502).json({ error: `xAI HTTP ${upstream.status}: ${text.slice(0, 240)}` });
        }
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return res.status(502).json({ error: 'xAI 响应非 JSON' });
        }
        const reply = data?.choices?.[0]?.message?.content;
        if (typeof reply !== 'string' || !reply.trim()) {
            return res.status(502).json({ error: 'xAI 返回为空' });
        }
        return res.json({
            choices: [{ message: { content: reply }, finish_reason: 'stop' }],
            usage: data?.usage || null,
        });
    } catch (e) {
        console.error('[eu-guest-trial] generate', e);
        return res.status(500).json({ error: e?.message || 'generate failed' });
    }
});
