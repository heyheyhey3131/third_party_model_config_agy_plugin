"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEVEL_ORDER = void 0;
exports.isLevel = isLevel;
exports.normalizeLevel = normalizeLevel;
exports.normalizeLevels = normalizeLevels;
exports.levelsForModel = levelsForModel;
exports.defaultLevelForModel = defaultLevelForModel;
exports.isDeepSeek = isDeepSeek;
/**
 * Reasoning levels the effort slider may offer, weakest first.
 *
 * `default` means "send nothing and let the provider decide", `none` disables
 * thinking where the provider supports it. The rest are the provider-native
 * strengths. Antigravity's own selector only knows low/medium/high/xhigh/max,
 * which is why the slider talks to this proxy instead of model labels.
 */
const LEVEL_ORDER = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
exports.LEVEL_ORDER = LEVEL_ORDER;
const ALIASES = {
    off: 'none',
    disabled: 'none',
    extra: 'xhigh',
    xhigh: 'xhigh',
    minimum: 'minimal',
    min: 'minimal',
    auto: 'default',
};
function isLevel(value) {
    return typeof value === 'string' && LEVEL_ORDER.includes(normalizeLevel(value));
}
function normalizeLevel(value) {
    const lower = String(value || '').trim().toLowerCase();
    return ALIASES[lower] || lower;
}
/** Filter, alias and sort a level list; unknown tokens are dropped. */
function normalizeLevels(levels) {
    const seen = new Set();
    for (const level of Array.isArray(levels) ? levels : []) {
        const normalized = normalizeLevel(level);
        if (LEVEL_ORDER.includes(normalized))
            seen.add(normalized);
    }
    return LEVEL_ORDER.filter((level) => seen.has(level));
}
function modelIdText(model) {
    return `${model.externalModelName || ''} ${model.name || ''} ${model.displayName || ''}`.toLowerCase();
}
function isDeepSeek(model) {
    return model.provider === 'deepseek' || /deepseek/i.test(modelIdText(model));
}
function isStepFun(model) {
    return /stepfun/i.test(String(model.provider || '')) ||
        /(?:^|[\s/_.-])step-?(?:5|3\.7|3\.5|router)(?:[\s/_.-]|$)/i.test(modelIdText(model));
}
function isOpenAiReasoningFamily(model) {
    return /(?:^|[\s/_.-])(?:gpt-5|gpt-oss|o[1-9])(?:[\s/_.-]|$)/i.test(modelIdText(model));
}
/**
 * Native level set for one model.
 *
 * An explicit `reasoningLevels` array always wins, so a user can advertise
 * exactly what their endpoint accepts. Otherwise the provider families whose
 * documented levels we know get their own sets, and everything else gets the
 * conservative four levels every OpenAI-compatible reasoning model accepts.
 */
function levelsForModel(model) {
    const configured = normalizeLevels(model.reasoningLevels);
    if (configured.length >= 2)
        return configured;
    if (isDeepSeek(model))
        return ['default', 'none', 'low', 'high', 'max'];
    if (isStepFun(model))
        return ['default', 'low', 'medium', 'high'];
    if (isOpenAiReasoningFamily(model))
        return ['default', 'minimal', 'low', 'medium', 'high'];
    return ['default', 'low', 'medium', 'high'];
}
/** The level a conversation starts from when no slider override exists. */
function defaultLevelForModel(model) {
    const levels = levelsForModel(model);
    const saved = normalizeLevel(model.reasoningEffort || '');
    return levels.includes(saved) ? saved : 'default';
}