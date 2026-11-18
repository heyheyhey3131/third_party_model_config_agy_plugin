"use strict";
/**
 * Conversation-scoped reasoning-level overrides written by the effort slider.
 *
 * The native model selector can only switch between model entries whose labels
 * carry one of five effort tokens, so levels such as `none`, `minimal` and
 * `default` cannot be variants. The slider therefore posts the chosen level
 * here and the proxy merges it into the outgoing request for that conversation.
 *
 * Nothing secret is stored: model names and level tokens only.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const modelStore = require('../modelStore');

const VERSION = 1;
const MAX_CONVERSATIONS = 100;

let configuredDirectory = null;
let state = null;
let loadedStamp = '';

function dataFilePath() {
    const directory = configuredDirectory ||
        process.env.ANTIGRAVITY_DATA_DIR ||
        path.join(os.homedir(), '.gemini', 'antigravity');
    return path.join(directory, 'effort_overrides.json');
}

function emptyState() {
    return { version: VERSION, conversations: {}, models: {} };
}

function configure(directory) {
    configuredDirectory = directory ? path.resolve(directory) : null;
    state = null;
    loadedStamp = '';
}

function ensureState() {
    if (state)
        return state;
    const file = dataFilePath();
    try {
        const stat = fs.statSync(file);
        const stamp = `${stat.mtimeMs}:${stat.size}`;
        if (stamp === loadedStamp && state)
            return state;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        state = {
            version: VERSION,
            conversations: parsed && typeof parsed.conversations === 'object' && parsed.conversations ? parsed.conversations : {},
            models: parsed && typeof parsed.models === 'object' && parsed.models ? parsed.models : {},
        };
        loadedStamp = stamp;
    }
    catch {
        state = emptyState();
        loadedStamp = '';
    }
    return state;
}

function persist(current) {
    if (current !== state)
        return;
    try {
        modelStore.writeJsonAtomic(dataFilePath(), current);
        const stat = fs.statSync(dataFilePath());
        loadedStamp = `${stat.mtimeMs}:${stat.size}`;
    }
    catch {
        // A failed write only loses this drag; the next one retries.
    }
}

function conversationKey(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function prune(current) {
    const entries = Object.entries(current.conversations || {});
    if (entries.length <= MAX_CONVERSATIONS)
        return;
    entries
        .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
        .slice(MAX_CONVERSATIONS)
        .forEach(([key]) => {
        delete current.conversations[key];
    });
}

/** Explicit slider choice for this conversation, else the model-wide fallback. */
function resolveLevel(modelName, conversationId) {
    if (!modelName)
        return undefined;
    const current = ensureState();
    const key = conversationKey(conversationId);
    const conversation = key ? current.conversations[key] : undefined;
    const scoped = conversation && conversation.levels ? conversation.levels[modelName] : undefined;
    if (typeof scoped === 'string')
        return scoped;
    const shared = current.models ? current.models[modelName] : undefined;
    return typeof shared === 'string' ? shared : undefined;
}

function setLevel(modelName, level, conversationId) {
    if (!modelName || !level)
        return;
    const current = ensureState();
    current.models[modelName] = level;
    const key = conversationKey(conversationId);
    if (key) {
        const conversation = current.conversations[key] || { updatedAt: 0, levels: {} };
        conversation.levels = conversation.levels || {};
        conversation.levels[modelName] = level;
        conversation.updatedAt = Date.now();
        current.conversations[key] = conversation;
    }
    prune(current);
    persist(current);
}

function reset() {
    state = null;
    loadedStamp = '';
}

exports.resolveLevel = resolveLevel;
exports.setLevel = setLevel;
exports.configure = configure;
exports.reset = reset;
exports.dataFilePath = dataFilePath;