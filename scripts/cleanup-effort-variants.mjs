#!/usr/bin/env node
// cleanup-effort-variants.mjs — remove leftover reasoning-effort copies from
// custom models.
//
// Older versions of this plugin created one model entry per reasoning level
// ("Name (high)", "Name (max)", ...) because Antigravity's native selector can
// only group entries whose labels end in low/medium/high/xhigh/max. Levels such
// as none, minimal and default could never be expressed that way, and the base
// entry ended up duplicated next to its copies.
//
// Reasoning strength is now chosen in the Codex effort slider and applied per
// conversation by the proxy (see /plugin/effort), so every model must appear in
// the selector exactly once. This script deletes every entry that carries a
// copyFrom parent, plus orphan copies that only use the "<parent>-<level>" name
// convention.
//
// Usage (Antigravity must be CLOSED so it does not overwrite the config):
//   node scripts/cleanup-effort-variants.mjs
//   node scripts/cleanup-effort-variants.mjs --dry-run
//
// Idempotent, backs up custom_models.json before writing.
import fs from 'fs';
import path from 'path';
import os from 'os';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const CFG = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');

if (!fs.existsSync(CFG)) {
  console.error('custom_models.json not found:', CFG);
  process.exit(1);
}

const raw = fs.readFileSync(CFG, 'utf8');
const cfg = JSON.parse(raw);
const models = Array.isArray(cfg.models) ? cfg.models : [];
const names = new Set(models.map((model) => model.name));

const isVariant = (model) => typeof model.copyFrom === 'string' && model.copyFrom;
/** Older copies may lack copyFrom but still end in " (level)". */
const looksLikeOrphan = (model) => {
  if (isVariant(model)) return false;
  const base = model.displayName || '';
  const match = /\((low|medium|high|xhigh|max|minimal|none|default|off)\)\s*$/i.exec(base);
  if (!match) return false;
  const parent = base.slice(0, match.index).trim();
  return models.some((other) => other !== model && (other.displayName || '') === parent);
};

const doomed = models.filter((model) => isVariant(model) || looksLikeOrphan(model));
if (!doomed.length) {
  console.log('No effort copies found; the model list is already clean.');
  process.exit(0);
}

for (const model of doomed) {
  names.delete(model.name);
  console.log(`${DRY ? '[dry] would remove' : 'removed'} ${model.name} -> ${model.displayName || ''}`);
}

if (DRY) {
  console.log(`\n[dry-run] would remove ${doomed.length} entries; nothing written.`);
  process.exit(0);
}

const backup = CFG + '.before-effort-cleanup.bak';
if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);
cfg.models = models.filter((model) => !doomed.includes(model));
fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
console.log(`\nremoved=${doomed.length}; total models ${cfg.models.length}. Backup: ${backup}`);
console.log('Start Antigravity; each model appears once and the effort slider owns the levels.');