#!/usr/bin/env node
// add-effort-variants.mjs — create low/medium/high effort variants for custom
// reasoning models, replicating modelManagement.createEffortVariants.
//
// Why: the native model selector (and the Codex effort slider, which parses
// "Name (effort)" labels) only exposes thinking levels for a custom model when
// effort variants exist. A bare DeepSeek/StepFun entry has no levels, so the
// slider renders locked. This script adds the variants so the slider unlocks.
//
// Usage (Antigravity must be CLOSED so it does not overwrite the config):
//   node scripts/add-effort-variants.mjs                 # all thinking-capable models lacking variants
//   node scripts/add-effort-variants.mjs deepseek-flash step-5-preview
//   node scripts/add-effort-variants.mjs --dry-run
//
// Copies each source verbatim (including the machine-bound enc: apiKey), exactly
// like the in-app "Effort variants" button. Idempotent: existing variants are kept.
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
const targets = argv.filter((a) => !a.startsWith('--'));
const CFG = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
const EFFORTS = ['low', 'medium', 'high'];

if (!fs.existsSync(CFG)) { console.error('custom_models.json not found:', CFG); process.exit(1); }
const raw = fs.readFileSync(CFG, 'utf8');
const cfg = JSON.parse(raw);
const models = cfg.models || [];
const names = new Set(models.map((m) => m.name));

// A model already has variants if any entry copyFrom it (or name starts with it + '-effort').
const hasVariants = (m) => models.some((x) => x.copyFrom === m.name || EFFORTS.some((e) => x.name === `${m.name}-${e}`));

const sources = models.filter((m) => {
  if (m.copyFrom) return false; // never variant-of-variant
  if (targets.length && !targets.includes(m.externalModelName) && !targets.includes(m.name)) return false;
  if (m.supportsThinking === false) return false;
  if (!modelUtils.detectModelCapabilities(m).isThinking) return false;
  return !hasVariants(m);
});

if (!sources.length) { console.log('No thinking-capable models need variants (already present or none matched).'); process.exit(0); }

const backup = CFG + '.before-effort-variants.bak';
if (!DRY && !fs.existsSync(backup)) fs.writeFileSync(backup, raw);

let added = 0;
for (const source of sources) {
  const format = providers.resolveApiFormat(source.provider, source.apiFormat);
  for (const [index, effort] of EFFORTS.entries()) {
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
      const budget = [1024, 4096, 8192][index];
      copy.thinkingBudget = budget;
      copy.maxOutputTokens = Math.max(Number(source.maxOutputTokens) || 16384, budget + 1024);
    }
    models.push(copy);
    added++;
    console.log(`${DRY ? '[dry] would add' : 'added'} ${target} -> ${copy.displayName}`);
  }
}
if (!DRY) {
  cfg.models = models;
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  console.log(`\nadded ${added} variants; total models ${models.length}. Backup: ${backup}`);
  console.log('Start Antigravity; the effort slider now shows low/medium/high for these models.');
} else {
  console.log(`\n[dry-run] would add ${added} variants; nothing written.`);
}
