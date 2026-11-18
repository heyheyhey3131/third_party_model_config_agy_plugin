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
const withEffort = requestOptions.applyRequestOptions(base, { ...models[0], reasoningEffort: 'medium' }, 'openai', false, undefined);
check('openai reasoning_effort emitted', withEffort.reasoning_effort === 'medium', `got ${withEffort.reasoning_effort}`);
const noEffort = requestOptions.applyRequestOptions(base, { ...models[0] }, 'openai', false, undefined);
check('no saved effort -> no reasoning_effort', noEffort.reasoning_effort === undefined);
// google format must not receive reasoning_effort
const google = requestOptions.applyRequestOptions({ contents: [] }, { ...models[0], reasoningEffort: 'high', apiFormat: 'google' }, 'google', false, undefined);
check('google format untouched by reasoningEffort', google.reasoning_effort === undefined);

console.log(failed ? `\n${failed} check(s) failed` : '\nall thinking checks passed');
process.exit(failed ? 1 : 0);
