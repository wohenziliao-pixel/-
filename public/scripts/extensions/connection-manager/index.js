import { DOMPurify, Fuse } from '../../../lib.js';

import { event_types, eventSource, main_api, online_status, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { callGenericPopup, Popup, POPUP_RESULT, POPUP_TYPE } from '../../popup.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { SlashCommandAbortController } from '../../slash-commands/SlashCommandAbortController.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders, enumIcons } from '../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandDebugController } from '../../slash-commands/SlashCommandDebugController.js';
import { enumTypes, SlashCommandEnumValue } from '../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommandScope } from '../../slash-commands/SlashCommandScope.js';
import {
    chat_completion_sources,
    getOpenAIConnectionDefaults,
    oai_settings,
    reconnectOpenAi,
    setChatCompletionSourceQuiet,
    settingsToUpdate,
    toggleChatCompletionForms,
} from '../../openai.js';
import { textgen_types, textgenerationwebui_settings } from '../../textgen-settings.js';
import { collapseSpaces, delay, getUniqueName, isFalseBoolean, uuidv4, waitUntilCondition } from '../../utils.js';
import { t } from '../../i18n.js';
import { getSecretLabelById } from '../../secrets.js';

const MODULE_NAME = 'connection-manager';
const NONE = '<None>';
const EMPTY = '<Empty>';

const DEFAULT_SETTINGS = {
    profiles: [],
    selectedProfile: null,
};

// Commands that can record an empty value into the profile
const ALLOW_EMPTY = [
    'stop-strings',
    'start-reply-with',
];

const CC_COMMANDS = [
    'api',
    'preset',
    // Do not fix; CC needs to set the API twice because it could be overridden by the preset
    'api',
    'api-url',
    'model',
    'proxy',
    'stop-strings',
    'start-reply-with',
    'reasoning-template',
    'prompt-post-processing',
    'secret-id',
    'regex-preset',
];

const TC_COMMANDS = [
    'api',
    'preset',
    'api-url',
    'model',
    'sysprompt',
    'sysprompt-state',
    'instruct',
    'context',
    'instruct-state',
    'tokenizer',
    'stop-strings',
    'start-reply-with',
    'reasoning-template',
    'secret-id',
    'regex-preset',
];

/** @type {boolean} */
let isApplyingConnectionProfile = false;

/** @type {ReturnType<typeof setTimeout>|null} */
let pendingAutoUpdateProfileTimer = null;

/** @type {{ profile: ConnectionProfile, fullState: Record<string, *> }|null} */
let pendingProfileModelApply = null;

/** @type {boolean} */
let profileModelApplyDone = false;

/** User clicked Connect — only then auto-save the selected profile. */
let awaitingManualConnectSnapshot = false;

/** Slash commands that are not connection identity (applied after snapshot). */
const CC_AUX_COMMANDS = [
    'proxy',
    'stop-strings',
    'start-reply-with',
    'reasoning-template',
    'prompt-post-processing',
    'secret-id',
    'regex-preset',
];

const TC_AUX_COMMANDS = [
    'sysprompt',
    'sysprompt-state',
    'instruct',
    'context',
    'instruct-state',
    'tokenizer',
    'stop-strings',
    'start-reply-with',
    'reasoning-template',
    'secret-id',
    'regex-preset',
];

/** chat_completion_source → oai_settings model field name */
const CC_MODEL_SETTING_BY_SOURCE = Object.freeze({
    [chat_completion_sources.CLAUDE]: 'claude_model',
    [chat_completion_sources.OPENAI]: 'openai_model',
    [chat_completion_sources.MAKERSUITE]: 'google_model',
    [chat_completion_sources.VERTEXAI]: 'vertexai_model',
    [chat_completion_sources.OPENROUTER]: 'openrouter_model',
    [chat_completion_sources.AI21]: 'ai21_model',
    [chat_completion_sources.MISTRALAI]: 'mistralai_model',
    [chat_completion_sources.CUSTOM]: 'custom_model',
    [chat_completion_sources.COHERE]: 'cohere_model',
    [chat_completion_sources.PERPLEXITY]: 'perplexity_model',
    [chat_completion_sources.GROQ]: 'groq_model',
    [chat_completion_sources.CHUTES]: 'chutes_model',
    [chat_completion_sources.ELECTRONHUB]: 'electronhub_model',
    [chat_completion_sources.NANOGPT]: 'nanogpt_model',
    [chat_completion_sources.DEEPSEEK]: 'deepseek_model',
    [chat_completion_sources.AIMLAPI]: 'aimlapi_model',
    [chat_completion_sources.XAI]: 'xai_model',
    [chat_completion_sources.POLLINATIONS]: 'pollinations_model',
    [chat_completion_sources.MOONSHOT]: 'moonshot_model',
    [chat_completion_sources.FIREWORKS]: 'fireworks_model',
    [chat_completion_sources.COMETAPI]: 'cometapi_model',
    [chat_completion_sources.ZAI]: 'zai_model',
    [chat_completion_sources.SILICONFLOW]: 'siliconflow_model',
});

/** All oai_settings keys that hold a model id (applied only after API connect succeeds). */
const CONNECTION_MODEL_FIELDS = new Set(Object.values(CC_MODEL_SETTING_BY_SOURCE));

/** OpenRouter fields that depend on model list / connect (phase 2). */
const OPENROUTER_POST_CONNECT_FIELDS = [
    'openrouter_model',
    'openrouter_providers',
    'openrouter_quantizations',
    'openrouter_allow_fallbacks',
    'openrouter_use_fallback',
];

/** Chat Completion: slash /api key → model control id */
const CC_MODEL_SELECT_BY_API = Object.freeze({
    [chat_completion_sources.OPENAI]: 'model_openai_select',
    [chat_completion_sources.CLAUDE]: 'model_claude_select',
    [chat_completion_sources.OPENROUTER]: 'model_openrouter_select',
    [chat_completion_sources.AI21]: 'model_ai21_select',
    [chat_completion_sources.MAKERSUITE]: 'model_google_select',
    [chat_completion_sources.VERTEXAI]: 'model_vertexai_select',
    [chat_completion_sources.MISTRALAI]: 'model_mistralai_select',
    [chat_completion_sources.CUSTOM]: 'custom_model_id',
    [chat_completion_sources.COHERE]: 'model_cohere_select',
    [chat_completion_sources.PERPLEXITY]: 'model_perplexity_select',
    [chat_completion_sources.GROQ]: 'model_groq_select',
    [chat_completion_sources.CHUTES]: 'model_chutes_select',
    [chat_completion_sources.ELECTRONHUB]: 'model_electronhub_select',
    [chat_completion_sources.NANOGPT]: 'model_nanogpt_select',
    [chat_completion_sources.DEEPSEEK]: 'model_deepseek_select',
    [chat_completion_sources.AIMLAPI]: 'model_aimlapi_select',
    [chat_completion_sources.XAI]: 'model_xai_select',
    [chat_completion_sources.POLLINATIONS]: 'model_pollinations_select',
    [chat_completion_sources.MOONSHOT]: 'model_moonshot_select',
    [chat_completion_sources.FIREWORKS]: 'model_fireworks_select',
    [chat_completion_sources.COMETAPI]: 'model_cometapi_select',
    [chat_completion_sources.ZAI]: 'model_zai_select',
    [chat_completion_sources.SILICONFLOW]: 'model_siliconflow_select',
});

/** Text Completion: slash /api key → model control id */
const TC_MODEL_SELECT_BY_API = Object.freeze({
    [textgen_types.KOBOLDCPP]: 'koboldcpp_model',
    [textgen_types.VLLM]: 'vllm_model',
    [textgen_types.APHRODITE]: 'aphrodite_model',
    [textgen_types.OLLAMA]: 'ollama_model',
    [textgen_types.TABBY]: 'tabby_model',
    [textgen_types.LLAMACPP]: 'llamacpp_model',
    [textgen_types.FEATHERLESS]: 'featherless_model',
    [textgen_types.OPENROUTER]: 'openrouter_model',
});

const FANCY_NAMES = {
    'api': 'API',
    'api-url': 'Server URL',
    'preset': 'Settings Preset',
    'model': 'Model',
    'proxy': 'Proxy Preset',
    'sysprompt-state': 'Use System Prompt',
    'sysprompt': 'System Prompt Name',
    'instruct-state': 'Instruct Mode',
    'instruct': 'Instruct Template',
    'context': 'Context Template',
    'tokenizer': 'Tokenizer',
    'stop-strings': 'Custom Stopping Strings',
    'start-reply-with': 'Start Reply With',
    'reasoning-template': 'Reasoning Template',
    'prompt-post-processing': 'Prompt Post-Processing',
    'secret-id': 'Secret',
    'regex-preset': 'Regex Preset',
};

/**
 * A wrapper for the connection manager spinner.
 */
class ConnectionManagerSpinner {
    /**
     * @type {AbortController[]}
     */
    static abortControllers = [];

    /** @type {HTMLElement} */
    spinnerElement;

    /** @type {AbortController} */
    abortController = new AbortController();

    constructor() {
        // @ts-ignore
        this.spinnerElement = document.getElementById('connection_profile_spinner');
        this.abortController = new AbortController();
    }

    start() {
        ConnectionManagerSpinner.abortControllers.push(this.abortController);
        this.spinnerElement.classList.remove('hidden');
    }

    stop() {
        this.spinnerElement.classList.add('hidden');
    }

    isAborted() {
        return this.abortController.signal.aborted;
    }

    static abort() {
        for (const controller of ConnectionManagerSpinner.abortControllers) {
            controller.abort();
        }
        ConnectionManagerSpinner.abortControllers = [];
    }
}

/**
 * Get named arguments for the command callback.
 * @param {object} [args] Additional named arguments
 * @param {string} [args.force] Whether to force setting the value
 * @returns {object} Named arguments
 */
function getNamedArguments(args = {}) {
    // None of the commands here use underscored args, but better safe than sorry
    return {
        _scope: new SlashCommandScope(),
        _abortController: new SlashCommandAbortController(),
        _debugController: new SlashCommandDebugController(),
        _parserFlags: {},
        _hasUnnamedArgument: false,
        quiet: 'true',
        ...args,
    };
}

/** @type {() => SlashCommandEnumValue[]} */
const profilesProvider = () => [
    new SlashCommandEnumValue(NONE),
    ...extension_settings.connectionManager.profiles.map(p => new SlashCommandEnumValue(p.name, null, enumTypes.name, enumIcons.server)),
];

/**
 * @typedef {Object} ConnectionProfile
 * @property {string} id Unique identifier
 * @property {string} mode Mode of the connection profile
 * @property {string} [name] Name of the connection profile
 * @property {string} [api] API
 * @property {string} [preset] Settings Preset
 * @property {string} [model] Model
 * @property {string} [proxy] Proxy Preset
 * @property {string} [instruct] Instruct Template
 * @property {string} [context] Context Template
 * @property {string} [instruct-state] Instruct Mode
 * @property {string} [tokenizer] Tokenizer
 * @property {string} [stop-strings] Custom Stopping Strings
 * @property {string} [start-reply-with] Start Reply With
 * @property {string} [reasoning-template] Reasoning Template
 * @property {string} [prompt-post-processing] Prompt Post-Processing
 * @property {string} [sysprompt] System Prompt Name
 * @property {string} [sysprompt-state] Use System Prompt
 * @property {string} [api-url] Server URL
 * @property {string} [secret-id] Secret ID
 * @property {string} [regex-preset] Regex Preset ID
 * @property {string[]} [exclude] Commands to exclude
 * @property {Record<string, *>} [connectionSnapshot] Full Chat Completion connection fields (isolated per profile)
 */

/**
 * Finds the best match for the search value.
 * @param {string} value Search value
 * @returns {ConnectionProfile|null} Best match or null
 */
function findProfileByName(value) {
    // Try to find exact match
    const profile = extension_settings.connectionManager.profiles.find(p => p.name === value);

    if (profile) {
        return profile;
    }

    // Try to find fuzzy match
    const fuse = new Fuse(extension_settings.connectionManager.profiles, { keys: ['name'] });
    const results = fuse.search(value);

    if (results.length === 0) {
        return null;
    }

    const bestMatch = results[0];
    return bestMatch.item;
}

/**
 * Reads the connection profile from the commands.
 * @param {string} mode Mode of the connection profile
 * @param {ConnectionProfile} profile Connection profile
 * @param {boolean} [cleanUp] Whether to clean up the profile
 */
async function readProfileFromCommands(mode, profile, cleanUp = false) {
    const commands = mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
    const opposingCommands = mode === 'cc' ? TC_COMMANDS : CC_COMMANDS;
    const excludeList = Array.isArray(profile.exclude) ? profile.exclude : [];
    for (const command of commands) {
        try {
            if (excludeList.includes(command)) {
                continue;
            }

            const allowEmpty = ALLOW_EMPTY.includes(command);
            const args = getNamedArguments();
            const result = await SlashCommandParser.commands[command].callback(args, '');
            if (result || (allowEmpty && result === '')) {
                profile[command] = result;
                continue;
            }
        } catch (error) {
            console.error(`Failed to execute command: ${command}`, error);
        }
    }

    if (cleanUp) {
        for (const command of commands) {
            if (command.endsWith('-state') && profile[command] === 'false') {
                delete profile[command.replace('-state', '')];
            }
        }
        for (const command of opposingCommands) {
            if (commands.includes(command)) {
                continue;
            }

            delete profile[command];
        }
    }
}

/**
 * Creates a new connection profile.
 * @param {string} [forceName] Name of the connection profile
 * @returns {Promise<ConnectionProfile>} Created connection profile
 */
async function createConnectionProfile(forceName = null) {
    const mode = main_api === 'openai' ? 'cc' : 'tc';
    const id = uuidv4();
    /** @type {ConnectionProfile} */
    const profile = {
        id,
        mode,
        exclude: [],
    };

    await readProfileFromCommands(mode, profile);

    const profileForDisplay = makeFancyProfile(profile);
    const template = $(await renderExtensionTemplateAsync(MODULE_NAME, 'profile', { profile: profileForDisplay }));
    template.find('input[name="exclude"]').on('input', function () {
        const fancyName = String($(this).val());
        const keyName = Object.entries(FANCY_NAMES).find(x => x[1] === fancyName)?.[0];
        if (!keyName) {
            console.warn('Key not found for fancy name:', fancyName);
            return;
        }

        if (!Array.isArray(profile.exclude)) {
            profile.exclude = [];
        }

        const excludeState = !$(this).prop('checked');
        if (excludeState) {
            profile.exclude.push(keyName);
        } else {
            const index = profile.exclude.indexOf(keyName);
            index !== -1 && profile.exclude.splice(index, 1);
        }
    });
    const isNameTaken = (n) => extension_settings.connectionManager.profiles.some(p => p.name === n);
    const suggestedName = getUniqueName(collapseSpaces(`${profile.api ?? ''} ${profile.model ?? ''} - ${profile.preset ?? ''}`), isNameTaken);
    let name = forceName ?? await callGenericPopup(template, POPUP_TYPE.INPUT, suggestedName);
    // If it's cancelled, it will be false
    if (!name) {
        return null;
    }
    name = DOMPurify.sanitize(String(name));
    if (!name) {
        toastr.error('Name cannot be empty.');
        return null;
    }

    if (isNameTaken(name) || name === NONE) {
        toastr.error('A profile with the same name already exists.');
        return null;
    }

    if (Array.isArray(profile.exclude)) {
        for (const command of profile.exclude) {
            delete profile[command];
        }
    }

    profile.name = String(name);

    if (profile.mode === 'cc' && main_api === 'openai') {
        profile.api = oai_settings.chat_completion_source;
        profile.connectionSnapshot = captureConnectionSnapshot();
        profile.connectionSnapshot.chat_completion_source = oai_settings.chat_completion_source;
        const modelField = CC_MODEL_SETTING_BY_SOURCE[profile.api];
        if (modelField && profile.connectionSnapshot[modelField]) {
            profile.model = String(profile.connectionSnapshot[modelField]);
        }
    }

    return profile;
}

/**
 * Deletes the selected connection profile.
 * @returns {Promise<void>}
 */
async function deleteConnectionProfile() {
    const selectedProfile = extension_settings.connectionManager.selectedProfile;
    if (!selectedProfile) {
        return;
    }

    const index = extension_settings.connectionManager.profiles.findIndex(p => p.id === selectedProfile);
    if (index === -1) {
        return;
    }

    const profile = extension_settings.connectionManager.profiles[index];
    const name = profile.name;
    const confirm = await Popup.show.confirm(t`Are you sure you want to delete the selected profile?`, name);

    if (!confirm) {
        return;
    }

    extension_settings.connectionManager.profiles.splice(index, 1);
    extension_settings.connectionManager.selectedProfile = null;
    saveSettingsDebounced();

    await eventSource.emit(event_types.CONNECTION_PROFILE_DELETED, profile);
}

/**
 * Formats the connection profile for display.
 * @param {ConnectionProfile} profile Connection profile
 * @returns {Object} Fancy profile
 */
function makeFancyProfile(profile) {
    return Object.entries(FANCY_NAMES).reduce((acc, [key, value]) => {
        const allowEmpty = ALLOW_EMPTY.includes(key);
        if (!profile[key]) {
            if (profile[key] === '' && allowEmpty) {
                acc[value] = EMPTY;
            }
            return acc;
        }

        // UUID is not very useful in the UI, so we replace it with a label (if available)
        if (key === 'secret-id') {
            const label = getSecretLabelById(profile[key]);
            if (label) {
                acc[value] = label;
                return acc;
            }
        }

        if (key === 'regex-preset') {
            const label = extension_settings.regex_presets?.find(p => p.id === profile[key])?.name;
            if (label) {
                acc[value] = label;
                return acc;
            }
        }

        acc[value] = profile[key];
        return acc;
    }, {});
}

/**
 * @returns {Record<string, *>}
 */
function captureConnectionSnapshot() {
    /** @type {Record<string, *>} */
    const snapshot = {};

    for (const [, [, setting, , isConnection]] of Object.entries(settingsToUpdate)) {
        if (!isConnection) {
            continue;
        }

        if (oai_settings[setting] !== undefined) {
            const value = oai_settings[setting];
            snapshot[setting] = Array.isArray(value) ? [...value] : value;
        }
    }

    if (online_status !== 'no_connection') {
        syncLiveModelFieldIntoSnapshot(snapshot);
    }

    return snapshot;
}

/**
 * Read the visible model control (select2-safe) into the snapshot.
 * @param {Record<string, *>} snapshot
 */
function syncLiveModelFieldIntoSnapshot(snapshot) {
    if (main_api !== 'openai') {
        return;
    }

    const source = normalizeChatCompletionSource(oai_settings.chat_completion_source);
    const modelField = CC_MODEL_SETTING_BY_SOURCE[source];
    const selectId = CC_MODEL_SELECT_BY_API[source];

    if (!modelField || !selectId) {
        return;
    }

    const control = document.getElementById(selectId);
    if (!control) {
        return;
    }

    const liveValue = String($(control).val() || '').trim();
    if (liveValue) {
        snapshot[modelField] = liveValue;
        oai_settings[modelField] = liveValue;
    }
}

/** Slash /api aliases → #chat_completion_source option value */
const API_ALIAS_TO_SOURCE = Object.freeze({
    google: chat_completion_sources.MAKERSUITE,
    oai: chat_completion_sources.OPENAI,
});

/**
 * @param {string} apiOrSource
 * @returns {string}
 */
function normalizeChatCompletionSource(apiOrSource) {
    const key = String(apiOrSource || '').toLowerCase().trim();
    return API_ALIAS_TO_SOURCE[key] || key;
}

/**
 * Build the full connection state for a profile (defaults + saved data).
 * profile.api (聊天补全来源) wins over stale snapshot values.
 * @param {ConnectionProfile} profile
 * @returns {Record<string, *>}
 */
function buildFullStateFromProfile(profile) {
    const defaults = getOpenAIConnectionDefaults();
    const legacy = buildLegacySnapshotFromProfile(profile) || {};
    const snapshot = profile.connectionSnapshot || {};
    const source = normalizeChatCompletionSource(
        profile.api || snapshot.chat_completion_source || legacy.chat_completion_source,
    );

    /** @type {Record<string, *>} */
    const fullState = {
        ...defaults,
        ...legacy,
        ...snapshot,
        chat_completion_source: source,
    };

    // 「更新配置」写入的 profile.model 优先于过期的 connectionSnapshot（避免切换时被 GLM 等覆盖）
    const modelField = CC_MODEL_SETTING_BY_SOURCE[source];
    if (profile.model && modelField) {
        fullState[modelField] = profile.model;
    }

    return fullState;
}

/**
 * @param {ConnectionProfile} profile
 * @returns {Record<string, *>|null}
 */
function buildLegacySnapshotFromProfile(profile) {
    if (profile.mode !== 'cc' || !profile.api) {
        return null;
    }

    const source = normalizeChatCompletionSource(profile.api);
    /** @type {Record<string, *>} */
    const snapshot = { chat_completion_source: source };

    const modelField = CC_MODEL_SETTING_BY_SOURCE[source];
    if (profile.model && modelField) {
        snapshot[modelField] = profile.model;
    }

    const apiUrl = profile['api-url'];
    if (apiUrl) {
        if (source === chat_completion_sources.CUSTOM) {
            snapshot.custom_url = apiUrl;
        } else if (source === chat_completion_sources.ZAI) {
            snapshot.zai_endpoint = apiUrl;
        } else if (source === chat_completion_sources.SILICONFLOW) {
            snapshot.siliconflow_endpoint = apiUrl;
        } else if (source === chat_completion_sources.VERTEXAI) {
            snapshot.vertexai_region = apiUrl;
        }
    }

    return snapshot;
}

/**
 * Write a full connection state into oai_settings (not a partial merge).
 * @param {Record<string, *>} fullState
 */
function writeConnectionStateToOaiSettings(fullState) {
    for (const [, [, setting, , isConnection]] of Object.entries(settingsToUpdate)) {
        if (!isConnection || !(setting in fullState)) {
            continue;
        }

        const value = fullState[setting];
        oai_settings[setting] = Array.isArray(value) ? [...value] : value;
    }
}

/**
 * Reset every connection field to defaults, then caller overlays the profile snapshot.
 */
function resetAllConnectionFieldsToDefaults() {
    const defaults = getOpenAIConnectionDefaults();

    for (const [, [selector, setting, isCheckbox, isConnection]] of Object.entries(settingsToUpdate)) {
        if (!isConnection || defaults[setting] === undefined) {
            continue;
        }

        // 第三项「聊天补全来源」由 buildFullStateFromProfile 单独设置，避免先写成默认 OpenAI
        if (setting === 'chat_completion_source') {
            continue;
        }

        applySnapshotField(setting, defaults[setting], isCheckbox, selector);
    }
}

/**
 * @param {Record<string, *>} state
 * @returns {Record<string, *>}
 */
function omitModelFieldsFromState(state) {
    /** @type {Record<string, *>} */
    const result = { ...state };

    for (const field of CONNECTION_MODEL_FIELDS) {
        delete result[field];
    }

    for (const field of OPENROUTER_POST_CONNECT_FIELDS) {
        delete result[field];
    }

    return result;
}

/**
 * Reset model fields in memory so connect/status does not use a stale model slug.
 */
function resetModelFieldsInOaiSettingsToDefaults() {
    const defaults = getOpenAIConnectionDefaults();

    for (const field of CONNECTION_MODEL_FIELDS) {
        if (defaults[field] !== undefined) {
            oai_settings[field] = Array.isArray(defaults[field]) ? [...defaults[field]] : defaults[field];
        }
    }
}

/**
 * Phase 1 UI: API source, keys, URLs — no model fields.
 * @param {Record<string, *>} connectionState
 */
function applyConnectionFieldsBeforeConnect(connectionState) {
    const targetSource = String(connectionState.chat_completion_source || '');

    for (const [, [selector, setting, isCheckbox, isConnection]] of Object.entries(settingsToUpdate)) {
        if (!isConnection || setting === 'chat_completion_source') {
            continue;
        }

        if (!(setting in connectionState)) {
            continue;
        }

        if (CONNECTION_MODEL_FIELDS.has(setting)) {
            continue;
        }

        if (OPENROUTER_POST_CONNECT_FIELDS.includes(setting)) {
            continue;
        }

        applySnapshotField(setting, connectionState[setting], isCheckbox, selector);
    }

    void targetSource;
}

/**
 * @param {ConnectionProfile} profile
 * @param {Record<string, *>} fullState
 * @returns {{ source: string, model?: string, modelField?: string, openrouterExtras: Record<string, *> }}
 */
function resolveModelPayloadFromProfile(profile, fullState) {
    const source = normalizeChatCompletionSource(fullState.chat_completion_source);
    const modelField = CC_MODEL_SETTING_BY_SOURCE[source];
    let model = modelField ? fullState[modelField] : undefined;

    if (profile.model && normalizeChatCompletionSource(profile.api) === source) {
        model = profile.model;
    } else if (modelField && profile.connectionSnapshot?.[modelField]) {
        model = profile.connectionSnapshot[modelField];
    }

    /** @type {Record<string, *>} */
    const openrouterExtras = {};
    if (source === chat_completion_sources.OPENROUTER) {
        for (const key of OPENROUTER_POST_CONNECT_FIELDS) {
            if (key !== 'openrouter_model' && fullState[key] !== undefined) {
                openrouterExtras[key] = fullState[key];
            }
        }
    }

    return { source, model: model ? String(model) : undefined, modelField, openrouterExtras };
}

/**
 * Phase 2: apply model only after API/key connection is valid.
 * @param {ConnectionProfile} profile
 * @param {Record<string, *>} fullState
 * @returns {Promise<boolean>}
 */
async function applyModelFieldsAfterConnect(profile, fullState) {
    const { source, model, modelField, openrouterExtras } = resolveModelPayloadFromProfile(profile, fullState);

    if (!model || !modelField) {
        console.warn(`[Connection Manager] Profile "${profile.name}" has no saved model for source "${source}"`);
        return false;
    }

    await waitForProfileModelSelectReady({ ...profile, api: source });

    try {
        await SlashCommandParser.commands['model'].callback(getNamedArguments(), model);
    } catch (error) {
        console.error(`[Connection Manager] /model failed for profile "${profile.name}"`, error);
    }

    if (source === chat_completion_sources.OPENROUTER) {
        await applyOpenRouterFieldsFromSnapshot({ openrouter_model: model, ...openrouterExtras }, profile);
    } else {
        const selectId = CC_MODEL_SELECT_BY_API[source];
        const selector = selectId ? `#${selectId}` : '';
        applySnapshotField(modelField, model, false, selector);
    }

    profile.model = model;
    if (profile.connectionSnapshot) {
        profile.connectionSnapshot[modelField] = model;
    }

    return true;
}

/**
 * Trigger connect and wait until status + model list are ready.
 * @returns {Promise<boolean>}
 */
async function reconnectOpenAiAndWaitForProfile() {
    return new Promise((resolve) => {
        /** @type {((status: string) => void)|null} */
        let handler = null;

        const timeout = setTimeout(() => {
            if (handler) {
                eventSource.removeListener(event_types.ONLINE_STATUS_CHANGED, handler);
            }
            resolve(online_status !== 'no_connection');
        }, 20000);

        handler = (status) => {
            if (status === 'no_connection') {
                return;
            }

            clearTimeout(timeout);
            eventSource.removeListener(event_types.ONLINE_STATUS_CHANGED, handler);
            resolve(true);
        };

        eventSource.on(event_types.ONLINE_STATUS_CHANGED, handler);
        reconnectOpenAi();
    });
}

/**
 * @returns {Promise<void>}
 */
async function finishPendingProfileModelApply() {
    if (!pendingProfileModelApply || profileModelApplyDone) {
        return;
    }

    profileModelApplyDone = true;
    const { profile, fullState } = pendingProfileModelApply;
    await applyModelFieldsAfterConnect(profile, fullState);
}

/**
 * @param {string} setting
 * @param {*} value
 * @param {boolean} isCheckbox
 * @param {string} selector
 */
function applySnapshotField(setting, value, isCheckbox, selector) {
    if (value === undefined) {
        return;
    }

    oai_settings[setting] = Array.isArray(value) ? [...value] : value;

    if (!selector) {
        return;
    }

    const $el = $(selector);
    if (!$el.length) {
        return;
    }

    const eventData = { source: 'connection_profile' };

    if (isCheckbox) {
        $el.prop('checked', value).trigger('input', eventData);
        return;
    }

    if (setting === 'openrouter_providers' || setting === 'openrouter_quantizations') {
        $el.val(value).trigger('change', eventData);
        return;
    }

    const triggerEvent = $el.is('select') ? 'change' : 'input';
    $el.val(value).trigger(triggerEvent, eventData);
}

/**
 * @param {Record<string, *>} snapshot
 * @returns {Promise<void>}
 */
async function applyOpenRouterFieldsFromSnapshot(snapshot, profile = null) {
    let model = snapshot.openrouter_model;

    if (profile?.model && normalizeChatCompletionSource(profile.api) === chat_completion_sources.OPENROUTER) {
        model = profile.model;
    }

    if (model === undefined) {
        return;
    }

    model = String(model);
    oai_settings.openrouter_model = model;

    const $select = $('#model_openrouter_select');
    const tryApplyModel = () => {
        const hasOption = $select.find('option').filter(function () {
            return String($(this).val()) === model;
        }).length > 0;

        if (!hasOption) {
            return false;
        }

        $select.val(model).trigger('change', { source: 'connection_profile' });
        return true;
    };

    if (!tryApplyModel()) {
        await waitUntilCondition(tryApplyModel, 12000, 150, { rejectOnTimeout: false });
    }

    if (snapshot.openrouter_providers !== undefined) {
        applySnapshotField('openrouter_providers', snapshot.openrouter_providers, false, '#openrouter_providers_chat');
    }

    if (snapshot.openrouter_quantizations !== undefined) {
        applySnapshotField('openrouter_quantizations', snapshot.openrouter_quantizations, false, '#openrouter_quantizations_chat');
    }

    if (snapshot.openrouter_allow_fallbacks !== undefined) {
        applySnapshotField('openrouter_allow_fallbacks', snapshot.openrouter_allow_fallbacks, true, '#openrouter_allow_fallbacks');
    }

    if (snapshot.openrouter_use_fallback !== undefined) {
        applySnapshotField('openrouter_use_fallback', snapshot.openrouter_use_fallback, true, '#openrouter_use_fallback');
    }
}

/**
 * Apply an isolated connection snapshot (replaces connection fields, does not merge with live form).
 * @param {ConnectionProfile} profile
 * @returns {Promise<boolean>}
 */
async function applyConnectionSnapshot(profile) {
    const fullState = buildFullStateFromProfile(profile);
    const targetSource = String(fullState.chat_completion_source || '');

    if (!targetSource || profile.mode !== 'cc') {
        return false;
    }

    pendingProfileModelApply = { profile, fullState };
    profileModelApplyDone = false;

    if (main_api !== 'openai') {
        $('#main_api').val('openai').trigger('change');
        await waitUntilCondition(() => main_api === 'openai', 8000, 100, { rejectOnTimeout: false });
    }

    const connectionOnlyState = omitModelFieldsFromState(fullState);

    // 阶段 1：来源、密钥、URL 等（不写入模型，避免未连通时 saveModelList 用错 slug）
    resetAllConnectionFieldsToDefaults();
    writeConnectionStateToOaiSettings(connectionOnlyState);
    setChatCompletionSourceQuiet(targetSource);
    applyConnectionFieldsBeforeConnect(connectionOnlyState);
    resetModelFieldsInOaiSettingsToDefaults();
    toggleChatCompletionForms();

    // 阶段 2：自动连接（等同点击「连接」），等待有效
    const connected = await reconnectOpenAiAndWaitForProfile();
    await delay(connected ? 350 : 0);

    // 阶段 3：连通后再填已保存的模型（列表就绪后 /model 模糊匹配）
    await finishPendingProfileModelApply();

    pendingProfileModelApply = null;
    toggleChatCompletionForms();
    saveSettingsDebounced();
    return true;
}

/**
 * @param {ConnectionProfile} profile
 * @returns {string|undefined}
 */
function getActiveApiKeyForProfile(profile) {
    if (profile.mode === 'cc' && main_api === 'openai') {
        return oai_settings.chat_completion_source;
    }

    if (profile.mode === 'tc' && main_api === 'textgenerationwebui') {
        return textgenerationwebui_settings.type;
    }

    return profile.api;
}

/**
 * @param {string} apiKey
 * @returns {HTMLElement|null}
 */
function getModelControlForProfileApi(profile, apiKey) {
    const normalized = String(apiKey || '').toLowerCase().trim();
    if (!normalized) {
        return null;
    }

    const selectId = profile.mode === 'cc'
        ? CC_MODEL_SELECT_BY_API[normalized]
        : TC_MODEL_SELECT_BY_API[normalized];

    return selectId ? document.getElementById(selectId) : null;
}

/**
 * Wait until API status check finishes (or times out).
 * @returns {Promise<void>}
 */
async function waitForProfileConnectionReady() {
    await waitUntilCondition(() => online_status !== 'no_connection', 12000, 100, { rejectOnTimeout: false });
}

/**
 * Wait until the model picker for this profile's API is ready.
 * @param {ConnectionProfile} profile
 * @returns {Promise<void>}
 */
async function waitForProfileModelSelectReady(profile) {
    const control = getModelControlForProfileApi(profile, getActiveApiKeyForProfile(profile));
    if (!control) {
        await delay(150);
        return;
    }

    if (control instanceof HTMLInputElement) {
        return;
    }

    await waitUntilCondition(() => {
        if (!(control instanceof HTMLSelectElement)) {
            return true;
        }
        return control.options.length > 0;
    }, 12000, 150, { rejectOnTimeout: false });

    await delay(100);
}

/**
 * @param {ConnectionProfile} profile
 * @param {string} command
 * @param {string} argument
 * @param {ConnectionManagerSpinner} spinner
 * @returns {Promise<void>}
 */
async function runProfileCommand(profile, command, argument, spinner) {
    if (spinner.isAborted()) {
        throw new Error('Profile application aborted');
    }

    const allowEmpty = ALLOW_EMPTY.includes(command);
    const args = getNamedArguments(allowEmpty ? { force: 'true' } : {});
    await SlashCommandParser.commands[command].callback(args, argument);

    if (command === 'api' || command === 'preset' || command === 'api-url') {
        await waitForProfileConnectionReady();
    }

    if (command === 'api' && profile.api) {
        await waitForProfileModelSelectReady(profile);
    }
}

/**
 * Applies the connection profile.
 * @param {ConnectionProfile} profile Connection profile
 * @returns {Promise<void>}
 */
async function applyAuxProfileCommands(profile, commands, spinner) {
    for (const command of commands) {
        const argument = profile[command];
        const allowEmpty = ALLOW_EMPTY.includes(command);
        if (!argument && !(allowEmpty && argument === '')) {
            continue;
        }
        try {
            await runProfileCommand(profile, command, argument, spinner);
        } catch (error) {
            console.error(`Failed to execute command: ${command} ${argument}`, error);
        }
    }
}

/**
 * Legacy slash-only apply when no connection snapshot can be built (text completion, etc.).
 * @param {ConnectionProfile} profile
 * @param {ConnectionManagerSpinner} spinner
 */
async function applyConnectionProfileLegacy(profile, spinner) {
    const commands = profile.mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
    const commandsBeforeModel = commands.filter(command => command !== 'model');
    const modelArgument = profile.model;

    for (const command of commandsBeforeModel) {
        const argument = profile[command];
        const allowEmpty = ALLOW_EMPTY.includes(command);
        if (!argument && !(allowEmpty && argument === '')) {
            continue;
        }
        try {
            await runProfileCommand(profile, command, argument, spinner);
        } catch (error) {
            console.error(`Failed to execute command: ${command} ${argument}`, error);
        }
    }

    if (modelArgument) {
        try {
            await waitForProfileModelSelectReady(profile);
            await runProfileCommand(profile, 'model', modelArgument, spinner);
        } catch (error) {
            console.error(`Failed to execute command: model ${modelArgument}`, error);
        }
    }
}

async function applyConnectionProfile(profile) {
    if (!profile) {
        return;
    }

    // Abort any ongoing profile application
    ConnectionManagerSpinner.abort();

    const spinner = new ConnectionManagerSpinner();
    spinner.start();
    isApplyingConnectionProfile = true;

    try {
        const auxCommands = profile.mode === 'cc' ? CC_AUX_COMMANDS : TC_AUX_COMMANDS;
        await applyAuxProfileCommands(profile, auxCommands, spinner);

        const snapshotApplied = await applyConnectionSnapshot(profile);
        if (!snapshotApplied) {
            // Text Completion / empty profile: fall back to slash commands (includes preset)
            await applyConnectionProfileLegacy(profile, spinner);
        }

        saveSettingsDebounced();
    } finally {
        isApplyingConnectionProfile = false;
        spinner.stop();
    }
}

/**
 * After a successful manual connect, persist the live form into the selected profile.
 * @param {HTMLElement} detailsContent
 * @returns {Promise<void>}
 */
async function autoUpdateSelectedProfileAfterConnect(detailsContent) {
    if (isApplyingConnectionProfile) {
        return;
    }

    const selectedProfile = extension_settings.connectionManager.selectedProfile;
    if (!selectedProfile) {
        return;
    }

    const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
    if (!profile) {
        return;
    }

    const oldProfile = structuredClone(profile);
    await updateConnectionProfile(profile);
    saveSettingsDebounced();
    await renderDetailsContent(detailsContent);
    await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
}

/**
 * Save the current API form into the selected connection profile (no connect).
 * @param {HTMLElement} detailsContent
 * @returns {Promise<boolean>}
 */
async function saveSelectedConnectionProfileToArchive(detailsContent) {
    const selectedProfile = extension_settings.connectionManager.selectedProfile;
    if (!selectedProfile) {
        toastr.warning('请先在上方选择一条 API 连接配置');
        return false;
    }

    const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
    if (!profile) {
        toastr.warning('未找到该连接配置');
        return false;
    }

    const oldProfile = structuredClone(profile);
    await updateConnectionProfile(profile);
    await renderDetailsContent(detailsContent);
    saveSettingsDebounced();
    await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
    toastr.success(`已保存到配置：${profile.name}`, '', { timeOut: 2000 });
    return true;
}

/**
 * Updates the selected connection profile.
 * @param {ConnectionProfile} profile Connection profile
 * @returns {Promise<void>}
 */
async function updateConnectionProfile(profile) {
    profile.mode = main_api === 'openai' ? 'cc' : 'tc';
    await readProfileFromCommands(profile.mode, profile, true);
    if (profile.mode === 'cc' && main_api === 'openai') {
        profile.api = oai_settings.chat_completion_source;
        profile.connectionSnapshot = captureConnectionSnapshot();
        profile.connectionSnapshot.chat_completion_source = oai_settings.chat_completion_source;

        if (online_status !== 'no_connection') {
            const modelField = CC_MODEL_SETTING_BY_SOURCE[profile.api];
            if (modelField && profile.connectionSnapshot[modelField]) {
                profile.model = String(profile.connectionSnapshot[modelField]);
            }
        }
    }
}

/**
 * Renders the connection profile details.
 * @param {HTMLSelectElement} profiles Select element containing connection profiles
 */
function renderConnectionProfiles(profiles) {
    profiles.innerHTML = '';
    const noneOption = document.createElement('option');

    noneOption.value = '';
    noneOption.textContent = NONE;
    noneOption.selected = !extension_settings.connectionManager.selectedProfile;
    profiles.appendChild(noneOption);

    for (const profile of extension_settings.connectionManager.profiles.sort((a, b) => a.name.localeCompare(b.name))) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        option.selected = profile.id === extension_settings.connectionManager.selectedProfile;
        profiles.appendChild(option);
    }
}

/**
 * Renders the content of the details element.
 * @param {HTMLElement} detailsContent Content element of the details
 */
async function renderDetailsContent(detailsContent) {
    detailsContent.innerHTML = '';
    if (detailsContent.classList.contains('hidden')) {
        return;
    }
    const selectedProfile = extension_settings.connectionManager.selectedProfile;
    const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
    if (profile) {
        const profileForDisplay = makeFancyProfile(profile);
        const templateParams = { profile: profileForDisplay };
        if (Array.isArray(profile.exclude) && profile.exclude.length > 0) {
            templateParams.omitted = profile.exclude.map(e => FANCY_NAMES[e]).join(', ');
        }
        const template = await renderExtensionTemplateAsync(MODULE_NAME, 'view', templateParams);
        detailsContent.innerHTML = template;
    } else {
        detailsContent.textContent = t`No profile selected`;
    }
}

(async function () {
    extension_settings.connectionManager = extension_settings.connectionManager || structuredClone(DEFAULT_SETTINGS);

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (extension_settings.connectionManager[key] === undefined) {
            extension_settings.connectionManager[key] = DEFAULT_SETTINGS[key];
        }
    }

    const container = document.getElementById('rm_api_block');
    const settings = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    container.insertAdjacentHTML('afterbegin', settings);

    /** @type {HTMLSelectElement} */
    // @ts-ignore
    const profiles = document.getElementById('connection_profiles');
    renderConnectionProfiles(profiles);

    function toggleProfileSpecificButtons() {
        const profileId = extension_settings.connectionManager.selectedProfile;
        const profileSpecificButtons = [
            'update_connection_profile',
            'reload_connection_profile',
            'delete_connection_profile',
            'save_connection_profile_settings',
        ];
        profileSpecificButtons.forEach(id => document.getElementById(id)?.classList.toggle('disabled', !profileId));
    }
    toggleProfileSpecificButtons();

    profiles.addEventListener('change', async function () {
        const selectedProfile = profiles.selectedOptions[0];
        if (!selectedProfile) {
            // Safety net for preventing the command getting stuck
            await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, NONE);
            return;
        }

        const profileId = selectedProfile.value;
        extension_settings.connectionManager.selectedProfile = profileId;
        saveSettingsDebounced();
        await renderDetailsContent(detailsContent);

        toggleProfileSpecificButtons();

        // None option selected
        if (!profileId) {
            await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, NONE);
            return;
        }

        const profile = extension_settings.connectionManager.profiles.find(p => p.id === profileId);

        if (!profile) {
            console.log(`Profile not found: ${profileId}`);
            return;
        }

        await applyConnectionProfile(profile);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
    });

    const reloadButton = document.getElementById('reload_connection_profile');
    reloadButton.addEventListener('click', async () => {
        const selectedProfile = extension_settings.connectionManager.selectedProfile;
        const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
        if (!profile) {
            console.log('No profile selected');
            return;
        }
        await applyConnectionProfile(profile);
        await renderDetailsContent(detailsContent);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
        toastr.success('Connection profile reloaded', '', { timeOut: 1500 });
    });

    const createButton = document.getElementById('create_connection_profile');
    createButton.addEventListener('click', async () => {
        const profile = await createConnectionProfile();
        if (!profile) {
            return;
        }
        extension_settings.connectionManager.profiles.push(profile);
        extension_settings.connectionManager.selectedProfile = profile.id;
        saveSettingsDebounced();
        renderConnectionProfiles(profiles);
        await renderDetailsContent(detailsContent);
        await eventSource.emit(event_types.CONNECTION_PROFILE_CREATED, profile);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
    });

    const updateButton = document.getElementById('update_connection_profile');
    updateButton.addEventListener('click', async () => {
        const selectedProfile = extension_settings.connectionManager.selectedProfile;
        const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
        if (!profile) {
            console.log('No profile selected');
            return;
        }
        await saveSelectedConnectionProfileToArchive(detailsContent);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
    });

    const saveSettingsButton = document.getElementById('save_connection_profile_settings');
    saveSettingsButton?.addEventListener('click', async () => {
        await saveSelectedConnectionProfileToArchive(detailsContent);
    });

    const deleteButton = document.getElementById('delete_connection_profile');
    deleteButton.addEventListener('click', async () => {
        await deleteConnectionProfile();
        renderConnectionProfiles(profiles);
        await renderDetailsContent(detailsContent);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, NONE);
    });

    const editButton = document.getElementById('edit_connection_profile');
    editButton.addEventListener('click', async () => {
        const selectedProfile = extension_settings.connectionManager.selectedProfile;
        const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
        if (!profile) {
            console.log('No profile selected');
            return;
        }
        if (!Array.isArray(profile.exclude)) {
            profile.exclude = [];
        }

        let saveChanges = false;
        const sortByViewOrder = (a, b) => Object.keys(FANCY_NAMES).indexOf(a) - Object.keys(FANCY_NAMES).indexOf(b);
        const commands = profile.mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
        const settings = commands.slice().sort(sortByViewOrder).reduce((acc, command) => {
            const fancyName = FANCY_NAMES[command];
            acc[fancyName] = !profile.exclude.includes(command);
            return acc;
        }, {});
        const template = $(await renderExtensionTemplateAsync(MODULE_NAME, 'edit', { name: profile.name, settings }));
        let newName = await callGenericPopup(template, POPUP_TYPE.INPUT, profile.name, {
            customButtons: [{
                text: t`Save and Update`,
                classes: ['popup-button-ok'],
                result: POPUP_RESULT.AFFIRMATIVE,
                action: () => {
                    saveChanges = true;
                },
            }],
        });

        // If it's cancelled, it will be false
        if (!newName) {
            return;
        }
        newName = DOMPurify.sanitize(String(newName));
        if (!newName) {
            toastr.error('Name cannot be empty.');
            return;
        }

        if (profile.name !== newName && extension_settings.connectionManager.profiles.some(p => p.name === newName)) {
            toastr.error('A profile with the same name already exists.');
            return;
        }

        const newExcludeList = template.find('input[name="exclude"]:not(:checked)').map(function () {
            return Object.entries(FANCY_NAMES).find(x => x[1] === String($(this).val()))?.[0];
        }).get();

        const oldProfile = structuredClone(profile);
        if (newExcludeList.length !== profile.exclude.length || !newExcludeList.every(e => profile.exclude.includes(e))) {
            profile.exclude = newExcludeList;
            for (const command of newExcludeList) {
                delete profile[command];
            }
            if (saveChanges) {
                await updateConnectionProfile(profile);
            } else {
                toastr.info('Press "Update" to record them into the profile.', 'Included settings list updated');
            }
        }

        if (profile.name !== newName) {
            toastr.success('Connection profile renamed.');
            profile.name = newName;
        }

        saveSettingsDebounced();
        await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
        renderConnectionProfiles(profiles);
        await renderDetailsContent(detailsContent);
    });

    /** @type {HTMLElement} */
    const viewDetails = document.getElementById('view_connection_profile');
    const detailsContent = document.getElementById('connection_profile_details_content');
    viewDetails.addEventListener('click', async () => {
        viewDetails.classList.toggle('active');
        detailsContent.classList.toggle('hidden');
        await renderDetailsContent(detailsContent);
    });

    document.getElementById('api_button_openai')?.addEventListener('click', () => {
        if (isApplyingConnectionProfile) {
            return;
        }

        if (extension_settings.connectionManager.selectedProfile) {
            awaitingManualConnectSnapshot = true;
        }
    }, true);

    eventSource.on(event_types.ONLINE_STATUS_CHANGED, (status) => {
        if (isApplyingConnectionProfile && pendingProfileModelApply && status !== 'no_connection') {
            delay(350).then(() => finishPendingProfileModelApply());
        }

        if (!awaitingManualConnectSnapshot || status === 'no_connection' || isApplyingConnectionProfile) {
            return;
        }

        awaitingManualConnectSnapshot = false;

        if (!extension_settings.connectionManager.selectedProfile) {
            return;
        }

        if (pendingAutoUpdateProfileTimer) {
            clearTimeout(pendingAutoUpdateProfileTimer);
        }

        pendingAutoUpdateProfileTimer = setTimeout(() => {
            pendingAutoUpdateProfileTimer = null;
            autoUpdateSelectedProfileAfterConnect(detailsContent).catch(error => {
                console.error('Failed to auto-update connection profile after connect', error);
            });
        }, 400);
    });

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile',
        helpString: 'Switch to a connection profile or return the name of the current profile in no argument is provided. Use <code>&lt;None&gt;</code> to switch to no profile.',
        returns: 'name of the profile',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Name of the connection profile',
                enumProvider: profilesProvider,
                isRequired: false,
            }),
        ],
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'await',
                description: 'Wait for the connection profile to be applied before returning.',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'true',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'timeout',
                description: 'Maximum time to wait for the API connection to be established, in milliseconds. Set to 0 to disable. Only applies when await=true.',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.NUMBER],
                defaultValue: '2000',
            }),
        ],
        callback: async (args, value) => {
            if (!value || typeof value !== 'string') {
                const selectedProfile = extension_settings.connectionManager.selectedProfile;
                const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
                if (!profile) {
                    return NONE;
                }
                return profile.name;
            }

            if (value === NONE) {
                profiles.selectedIndex = 0;
                profiles.dispatchEvent(new Event('change'));
                return NONE;
            }

            const profile = findProfileByName(value);

            if (!profile) {
                return '';
            }

            const shouldAwait = !isFalseBoolean(String(args?.await));
            const awaitPromise = new Promise((resolve) => eventSource.once(event_types.CONNECTION_PROFILE_LOADED, resolve));

            profiles.selectedIndex = Array.from(profiles.options).findIndex(o => o.value === profile.id);
            profiles.dispatchEvent(new Event('change'));

            if (shouldAwait) {
                await awaitPromise;

                // We should also await the connection to be established
                const parsedTimeout = parseInt(args?.timeout?.toString());
                const timeout = !isNaN(parsedTimeout) ? Math.max(0, parsedTimeout) : 2000;
                if (timeout > 0) {
                    await waitUntilCondition(() => online_status !== 'no_connection', timeout, 100, { rejectOnTimeout: false });
                }
            }

            return profile.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-list',
        helpString: 'List all connection profile names.',
        returns: 'list of profile names',
        callback: () => JSON.stringify(extension_settings.connectionManager.profiles.map(p => p.name)),
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-create',
        returns: 'name of the new profile',
        helpString: 'Create a new connection profile using the current settings.',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'name of the new connection profile',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
        callback: async (_args, name) => {
            if (!name || typeof name !== 'string') {
                toastr.warning('Please provide a name for the new connection profile.');
                return '';
            }
            const profile = await createConnectionProfile(name);
            if (!profile) {
                return '';
            }
            extension_settings.connectionManager.profiles.push(profile);
            extension_settings.connectionManager.selectedProfile = profile.id;
            saveSettingsDebounced();
            renderConnectionProfiles(profiles);
            await renderDetailsContent(detailsContent);
            await eventSource.emit(event_types.CONNECTION_PROFILE_CREATED, profile);
            return profile.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-update',
        helpString: 'Update the selected connection profile.',
        callback: async () => {
            const selectedProfile = extension_settings.connectionManager.selectedProfile;
            const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
            if (!profile) {
                toastr.warning('No profile selected.');
                return '';
            }
            const oldProfile = structuredClone(profile);
            await updateConnectionProfile(profile);
            await renderDetailsContent(detailsContent);
            saveSettingsDebounced();
            await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
            return profile.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-get',
        helpString: 'Get the details of the connection profile. Returns the selected profile if no argument is provided.',
        returns: 'object of the selected profile',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Name of the connection profile',
                enumProvider: profilesProvider,
                isRequired: false,
            }),
        ],
        callback: async (_args, value) => {
            if (!value || typeof value !== 'string') {
                const selectedProfile = extension_settings.connectionManager.selectedProfile;
                const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
                if (!profile) {
                    return '';
                }
                return JSON.stringify(profile);
            }

            const profile = findProfileByName(value);
            if (!profile) {
                return '';
            }
            return JSON.stringify(profile);
        },
    }));
})();
