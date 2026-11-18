#!/usr/bin/env node
// add-effort-variants.mjs — create per-model reasoning-effort variants for
// custom models, replicating modelManagement.createEffortVariants but with
// each provider's native level set.
//
// Why: Antigravity's native model selector groups custom entries by display
// label "Name (effort)" and only knows the effort tokens low/medium/high/
// xhigh/max. It shows a level submenu when a model has at least two grouped
// entries. The Codex effort slider reads the same groups. A bare model entry
// therefore renders as one ungrouped row (looking duplicated next to its
// variants) and the slider stays locked.
//
// Native level sets:
//   DeepSeek V4/Flash   low / high / max          (official reasoning_effort)
//   StepFun Step 5/3.7  low / medium / high       (official reasoning_effort)
//   other providers     low / medium / high
//
// The base entry is hidden from the model catalog by the proxy whenever it has
// enabled variants, so the selector shows one row per model plus its levels.
//
// Usage (Antigravity must be CLOSED so it does not overwrite the config):
//   node scripts/add-effort-variants.mjs                 # reconcile all thinking models
//   node scripts/add-effort-variants.mjs deepseek-flash  # only these external names
//   node scripts/add-effort-variants.mjs --dry-run
//   node scripts/add-effort-variants.mjs --reset         # also drop stale/unknown variants
//
// Idempotent. Copies each source verbatim (including the machine-bound enc:
// apiKey) exactly like the in-app "Effort variants" button, and backs up
// custom_models.json before writing.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const modelUtils = require(path.join(PLUGIN, 'assets', 'modelPatch', 'proxy', 'modelUtils.js'));
const providers = require(path.join(PLUGIN, 'assets', 'modelPatch', 'providers.js'));

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const RESET = argv.includes('--reset');
const targets = argv.filter((a) => !a.startsWith('--'));
const CFG = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');

/** Effort tokens Antigravity's native selector understands, in provider order. */
const NATIVE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function levelsFor(model) {
  const id = `${model.externalModelName || ''} ${model.name || ''} ${model.displayName || ''}`;
  // DeepSeek's OpenAI-compatible thinking mode accepts low/high/max.
  if (model.provider === 'deepseek' || /deepseek/i.test(id)) return ['low', 'high', 'max'];
  // StepFun documents low/medium/high, plus "medium" as the recommended default.
  if (/stepfun/i.test(id) || /(?:^|[\/\s-])step-(?:5|3\.7|3\.5|router)/i.test(id)) return ['low', 'medium', 'high'];
  // Everyone else: the generic three levels the native selector knows.
  return ['low', 'medium', 'high'];
}

const isVariant = (m) => typeof m.copyFrom === 'string' && m.copyFrom;
const levelSuffix = (m) => {
  const base = m.displayName || m.externalModelName || m.name;
  const match = /\((low|medium|high|xhigh|max)\)\s*$/i.exec(base);
  return match ? match[1].toLowerCase() : undefined;
};

if (!fs.existsSync(CFG)) { console.error('custom_models.json not found:', CFG); process.exit(1); }
const raw = fs.readFileSync(CFG, 'utf8');
const cfg = JSON.parse(raw);
const models = cfg.models || [];
const names = new Set(models.map((m) => m.name));

// Variant entries belong to their copyFrom parent; tolerate older variants
// that only used the "<parent>-<level>" name convention.
const parentOf = (m) => {
  if (isVariant(m)) return m.copyFrom;
  const match = /^(.*)-(low|medium|high|xhigh|max)(?:-\d+)?$/.exec(m.name || '');
  if (match && models.some((x) => x.name === match[1])) return match[1];
  return undefined;
};

const parents = models.filter((m) => {
  if (isVariant(m) || parentOf(m)) return false;
  if (targets.length && !targets.includes(m.externalModelName) && !targets.includes(m.name)) return false;
  if (m.supportsThinking === false) return false;
  return modelUtils.detectModelCapabilities(m).isThinking;
});

const sources = parents;
if (!sources.length && !RESET) {
  console.log('No thinking-capable models matched.');
  process.exit(0);
}

// Reconcile: every source should have exactly its native levels.
let removed = 0;
let added = 0;
const backup = CFG + '.before-effort-variants.bak';
if (!DRY && !fs.existsSync(backup)) fs.writeFileSync(backup, raw);

for (const source of sources) {
  const levels = levelsFor(source);
  const format = providers.resolveApiFormat(source.provider, source.apiFormat);
  const existing = models.filter((m) => parentOf(m) === source.name);
  const keep = new Map();
  for (const m of existing) {
    const level = isVariant(m) ? levelSuffix(m) : undefined;
    if (level && levels.includes(level) && !keep.has(level)) keep.set(level, m);
  }
  // Drop stale variants (e.g. DeepSeek's old "medium" copy) on --reset, or
  // whenever we are reconciling a source to a different native level set.
  for (let i = models.length - 1; i >= 0; i--) {
    const m = models[i];
    if (parentOf(m) !== source.name) continue;
    const level = isVariant(m) ? levelSuffix(m) : undefined;
    const wanted = level && levels.includes(level) && keep.get(level) === m;
    if (!wanted) {
      names.delete(m.name);
      models.splice(i, 1);
      removed++;
    }
  }
  for (const [index, effort] of levels.entries()) {
    if (keep.has(effort)) continue;
    let target = `${source.name}-${effort}`;
    let suffix = 2;
    while (names.has(target)) target = `${source.name}-${effort}-${suffix++}`;
    names.add(target);
    const copy = {
      ...source,
      name: target,
      copyFrom: source.name,
      displayName: `${source.displayName || source.externalModelName || source.name} (${effort})`,
      reasoningEffort: effort,
    };
    if (format !== 'openai') {
      const budget = [1024, 4096, 8192][index] ?? 8192;
      copy.thinkingBudget = budget;
      copy.maxOutputTokens = Math.max(Number(source.maxOutputTokens) || 16384, budget + 1024);
    }
    models.push(copy);
    added++;
    console.log(`${DRY ? '[dry] would add' : 'added'} ${target} -> ${copy.displayName}`);
  }
}

if (RESET) {
  // Drop orphan variants whose parent no longer exists.
  for (let i = models.length - 1; i >= 0; i--) {
    const m = models[i];
    if (parentOf(m) && !models.some((x) => x.name === parentOf(m))) {
      names.delete(m.name);
      models.splice(i, 1);
      removed++;
    }
  }
}

if (removed) console.log(`${DRY ? '[dry] would remove' : 'removed'} ${removed} stale variant(s)`);
if (!added && !removed) { console.log('Effort variants already match each provider\'s native levels.'); process.exit(0); }

if (!DRY) {
  cfg.models = models;
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  console.log(`\nvariants added=${added} removed=${removed}; total models ${models.length}. Backup: ${backup}`);
  console.log('Start Antigravity; the selector shows one row per model with its native levels.');
} else {
  console.log(`\n[dry-run] would add ${added}, remove ${removed}; nothing written.`);
}