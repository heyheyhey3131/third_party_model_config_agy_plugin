// Sanity test for thinking-level support (schema-2 payload).
//   node test-thinking.mjs
//
// Verifies, without starting Antigravity:
//   1. DeepSeek / StepFun reasoning models are detected as thinking-capable,
//      so the native IDE advertises supportsThinking and shows its selector.
//   2. readNativeRequestEffort maps the native thinkingConfig to low/medium/high
//      (the only reasoning_effort values both providers accept).
//   3. applyRequestOptions emits reasoning_effort for OpenAI-format models when
//      a per-turn effort is set, and leaves non-thinking models untouched.
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY = path.join(PLUGIN, 'assets', 'modelPatch', 'proxy');
const modelUtils = require(path.join(PROXY, 'modelUtils.js'));
const requestOptions = require(path.join(PROXY, 'requestOptions.js'));
const schemaValidator = require(path.join(PLUGIN, 'assets', 'modelPatch', 'schemaValidator.js'));

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

// 1. capability detection for the configured models
const models = [
  { name: 'models/deepseek/deepseek-flash', provider: 'deepseek', apiFormat: 'openai', externalModelName: 'deepseek-flash', displayName: 'DeepSeek-V4.1-Flash' },
  { name: 'models/deepseek/deepseek-v4-pro', provider: 'deepseek', apiFormat: 'openai', externalModelName: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro' },
  { name: 'models/custom/step-5-preview', provider: 'custom', apiFormat: 'openai', externalModelName: 'step-5-preview', displayName: 'Step 5 Preview' },
  { name: 'models/custom/step-3.7-flash', provider: 'custom', apiFormat: 'openai', externalModelName: 'step-3.7-flash', displayName: 'Step 3.7 Flash' },
];
for (const m of models) {
  const cap = modelUtils.detectModelCapabilities(m);
  check(`isThinking ${m.externalModelName}`, cap.isThinking === true);
}
// explicit override still wins in both directions
check('supportsThinking:false overrides detection',
  modelUtils.detectModelCapabilities({ ...models[0], supportsThinking: false }).isThinking === false);
// a plain text model stays non-thinking
check('non-reasoning model stays non-thinking',
  modelUtils.detectModelCapabilities({ name: 'models/custom/foo', provider: 'custom', externalModelName: 'some-text-model' }).isThinking === false);

// 2. native effort mapping
const cases = [
  [{ thinkingLevel: 'LOW' }, 'low'],
  [{ thinkingLevel: 'MEDIUM' }, 'medium'],
  [{ thinkingLevel: 'HIGH' }, 'high'],
  [{ thinkingLevel: 'MINIMAL' }, 'low'],
  [{ thinkingLevel: 'EXTRA' }, 'high'],
  [{ thinkingLevel: 'XHIGH' }, 'high'],
  [{ thinkingBudget: 1024 }, 'low'],
  [{ thinkingBudget: 4096 }, 'medium'],
  [{ thinkingBudget: 16384 }, 'high'],
  [{}, undefined],
  [undefined, undefined],
];
for (const [tc, want] of cases) {
  const body = tc ? { generationConfig: { thinkingConfig: tc } } : {};
  const got = requestOptions.readNativeRequestEffort(body);
  check(`effort ${JSON.stringify(tc)} -> ${want}`, got === want, `got ${got}`);
}
check('no generationConfig -> undefined', requestOptions.readNativeRequestEffort({ contents: [] }) === undefined);

// 3. request options emit reasoning_effort for openai
const base = { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] };
const withEffort = requestOptions.applyRequestOptions(base, { ...models[0], reasoningEffort: 'high' }, 'openai', false, undefined);
check('openai reasoning_effort emitted', withEffort.reasoning_effort === 'high', `got ${withEffort.reasoning_effort}`);
check('deepseek thinking enabled with effort', withEffort.thinking?.type === 'enabled');
const noEffort = requestOptions.applyRequestOptions(base, { ...models[0] }, 'openai', false, undefined);
check('no saved effort -> no reasoning_effort', noEffort.reasoning_effort === undefined);
// DeepSeek "none"/"off" disables thinking instead of sending an invalid effort
const none = requestOptions.applyRequestOptions(base, { ...models[0], reasoningEffort: 'none' }, 'openai', false, undefined);
check('deepseek none -> thinking disabled', none.thinking?.type === 'disabled' && none.reasoning_effort === undefined);
const off = requestOptions.applyRequestOptions(base, { ...models[0], reasoningEffort: 'off' }, 'openai', false, undefined);
check('deepseek off -> thinking disabled', off.thinking?.type === 'disabled' && off.reasoning_effort === undefined);
// "default" leaves the provider default untouched
const dflt = requestOptions.applyRequestOptions(base, { ...models[0], reasoningEffort: 'default' }, 'openai', false, undefined);
check('deepseek default -> no effort, no thinking toggle', dflt.reasoning_effort === undefined && dflt.thinking === undefined);
// sampling controls are dropped in DeepSeek thinking mode
const sampled = requestOptions.applyRequestOptions({ ...base, temperature: 0.2, presence_penalty: 1, frequency_penalty: 1 },
  { ...models[0], reasoningEffort: 'max' }, 'openai', false, undefined);
check('deepseek thinking drops sampling controls',
  sampled.temperature === undefined && sampled.presence_penalty === undefined && sampled.frequency_penalty === undefined);
// StepFun accepts low/medium/high and gets no DeepSeek-only toggle
const step = requestOptions.applyRequestOptions(base, { ...models[2], reasoningEffort: 'medium' }, 'openai', false, undefined);
check('stepfun reasoning_effort medium', step.reasoning_effort === 'medium' && step.thinking === undefined);
// google format must not receive reasoning_effort
const google = requestOptions.applyRequestOptions({ contents: [] }, { ...models[0], reasoningEffort: 'high', apiFormat: 'google' }, 'google', false, undefined);
check('google format untouched by reasoningEffort', google.reasoning_effort === undefined);

// 4. the schema must accept every level the editor offers (DeepSeek max)
const maxModel = {
  name: 'models/test/deepseek-max',
  provider: 'deepseek',
  apiUrl: 'https://api.deepseek.com/v1/chat/completions',
  externalModelName: 'deepseek-flash',
  reasoningEffort: 'max',
};
const maxCheck = schemaValidator.validateCustomModel(maxModel);
check('schema accepts reasoningEffort max', maxCheck.valid === true, maxCheck.error || '');

// 5. per-model level sets advertised to the effort slider
const levels = require(path.join(PROXY, 'reasoningLevels.js'));
check('deepseek levels', JSON.stringify(levels.levelsForModel(models[0])) === '["default","none","low","high","max"]',
  JSON.stringify(levels.levelsForModel(models[0])));
check('stepfun levels', JSON.stringify(levels.levelsForModel(models[2])) === '["default","low","medium","high"]',
  JSON.stringify(levels.levelsForModel(models[2])));
check('generic levels', JSON.stringify(levels.levelsForModel({ name: 'models/custom/x', provider: 'custom', externalModelName: 'x' })) === '["default","low","medium","high"]');
check('explicit reasoningLevels wins',
  JSON.stringify(levels.levelsForModel({ provider: 'custom', reasoningLevels: ['high', 'none', 'low'] })) === '["none","low","high"]');
check('single explicit level falls back to preset',
  JSON.stringify(levels.levelsForModel({ provider: 'deepseek', reasoningLevels: ['high'] })) === '["default","none","low","high","max"]');
check('unknown level token rejected', levels.normalizeLevel('ultra') === 'ultra' && levels.isLevel('ultra') === false);
check('off aliases to none', levels.normalizeLevel('OFF') === 'none');
check('saved effort becomes current', levels.defaultLevelForModel({ provider: 'deepseek', reasoningEffort: 'high' }) === 'high');
check('unsaved level falls back to default', levels.defaultLevelForModel({ provider: 'stepfun', reasoningEffort: 'max' }) === 'default');

const schemaLevels = schemaValidator.validateCustomModel({
  ...maxModel,
  name: 'models/test/levels',
  reasoningLevels: ['default', 'none', 'low', 'high', 'max'],
});
check('schema accepts reasoningLevels', schemaLevels.valid === true, schemaLevels.error || '');
const schemaBadLevel = schemaValidator.validateCustomModel({ ...maxModel, name: 'models/test/bad', reasoningLevels: ['ultra'] });
check('schema rejects unknown reasoning level', schemaBadLevel.valid === false);

// 6. conversation-scoped overrides persisted for the proxy
const os = require('os');
const fs = require('fs');
const overrides = require(path.join(PROXY, 'effortOverrides.js'));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-effort-'));
overrides.configure(tmpDir);
check('no override initially', overrides.resolveLevel('models/test/a', 'conv-a') === undefined);
overrides.setLevel('models/test/a', 'none', 'conv-a');
check('conversation override applies', overrides.resolveLevel('models/test/a', 'conv-a') === 'none');
check('other conversation falls back to model default', overrides.resolveLevel('models/test/a', 'conv-b') === 'none');
overrides.reset();
overrides.configure(tmpDir);
check('override survives reload', overrides.resolveLevel('models/test/a', 'conv-a') === 'none');
check('override file stores no secrets', !/apiKey|secret|token/i.test(fs.readFileSync(path.join(tmpDir, 'effort_overrides.json'), 'utf8')));

console.log(failed ? `\n${failed} check(s) failed` : '\nall thinking checks passed');
process.exit(failed ? 1 : 0);
