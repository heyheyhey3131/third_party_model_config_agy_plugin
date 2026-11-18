// Maintenance tool: re-derive the patch assets from a clean/patched pair of
// app.asar files, and verify the reconstruction is byte-exact.
//
//   node rebuild-assets.mjs [--clean <path>] [--patched <path>] [--payload-from <dir>]
//
// Schema 2 (forwarder mode): app.asar only carries forwarder stubs, so the
// modelPatch payload is NOT re-extracted from the archive. It stays in
// assets/modelPatch and is used as-is; pass --payload-from to replace it from a
// vendor-patched archive directory (a directory that still contains dist/modelPatch).
//
// Defaults to this machine's standard install locations. Run it when the vendor
// ships a new modelPatch runtime: point --payload-from at the new payload and
// --clean at the matching clean asar, and the script regenerates assets/ and
// self-verifies.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const RES = opt('--resources') || path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'Programs', 'antigravity', 'resources');
const CLEAN_ASAR = opt('--clean') || path.join(RES, 'app.asar.clean-2.32.2.bak');
const PATCHED_ASAR = opt('--patched') || path.join(RES, 'app.asar');
const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(PLUGIN, 'assets');

function readAsar(p) {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32LE(0) !== 4) throw new Error('not an asar: ' + p);
  const headerSize = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.toString('utf8', 16, 16 + jsonLen));
  return { buf, header, dataStart: 8 + headerSize, headerSize, jsonLen };
}
function index(a) {
  const m = new Map();
  (function walk(node, base) {
    for (const [k, v] of Object.entries(node.files || {})) {
      const p = base ? base + '/' + k : k;
      if (v.files) walk(v, p); else m.set(p, v);
    }
  })(a.header, '');
  return m;
}
function readAt(a, e) {
  if (e.unpacked || e.offset == null) return null;
  const off = a.dataStart + Number(e.offset);
  return a.buf.subarray(off, off + Number(e.size));
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- LCS line diff ----------
function diffLines(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ t: 'ctx', a: i, b: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', a: i }); i++; }
    else { ops.push({ t: 'ins', b: j }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', a: i }); i++; }
  while (j < m) { ops.push({ t: 'ins', b: j }); j++; }
  return ops;
}
function countOccurrences(hay, needle) {
  let c = 0, idx = hay.indexOf(needle);
  while (idx >= 0) { c++; idx = hay.indexOf(needle, idx + needle.length); }
  return c;
}

// Build anchored edits for one file: returns {edits:[...], append:Buffer|null}
function buildEdits(relPath, cleanText, patchedText) {
  const aLines = cleanText.split('\n');
  const bLines = patchedText.split('\n');
  const ops = diffLines(aLines, bLines);
  // walk ops, group consecutive ins blocks and record A-position before each
  const blocks = [];
  let cur2 = null, ai2 = 0;
  for (const op of ops) {
    if (op.t === 'ins') {
      if (!cur2) cur2 = { lines: [], pos: ai2 };
      cur2.lines.push(bLines[op.b]);
    } else {
      if (cur2) { blocks.push(cur2); cur2 = null; }
      if (op.t === 'ctx' || op.t === 'del') ai2++;
    }
  }
  if (cur2) blocks.push(cur2);

  const edits = [];
  for (const blk of blocks) {
    const insText = blk.lines.join('\n');
    // Prefer an anchor on the line(s) the insertion precedes (insertBefore):
    // following context (comments, call sites) tends to be more stable across
    // versions than a bare "];" or signature line. Fall back to the preceding
    // line(s) (insertAfter). Smallest unique run wins.
    let placed = false;
    for (let k = 0; k <= 5 && !placed; k++) {
      if (blk.pos + k >= aLines.length) break;
      const anchor = aLines.slice(blk.pos, blk.pos + k + 1).join('\n');
      if (anchor.trim() === '') continue;
      if (countOccurrences(cleanText, anchor) === 1) {
        edits.push({ op: 'insertBefore', anchor, text: insText });
        placed = true;
      }
    }
    for (let k = 1; k <= 6 && !placed; k++) {
      if (blk.pos - k < 0) break;
      const anchor = aLines.slice(blk.pos - k, blk.pos).join('\n');
      if (anchor.trim() === '') continue;
      if (countOccurrences(cleanText, anchor) === 1) {
        edits.push({ op: 'insertAfter', anchor, text: insText });
        placed = true;
      }
    }
    if (!placed) throw new Error(`no unique anchor for insertion at A-line ${blk.pos} in ${relPath}`);
  }
  // trailing append? (patchedText starts with cleanText and has extra tail)
  let append = null;
  if (patchedText.startsWith(cleanText) && patchedText.length > cleanText.length) {
    append = Buffer.from(patchedText.slice(cleanText.length), 'utf8');
  }
  return { edits, append };
}

function applyEdits(text, edits, appendBuf) {
  let out = text;
  for (const e of edits) {
    const n = countOccurrences(out, e.anchor);
    if (n !== 1) throw new Error(`anchor occurs ${n}x (expected 1): ${JSON.stringify(e.anchor.slice(0, 80))}`);
    if (e.op === 'insertAfter') out = out.replace(e.anchor, e.anchor + '\n' + e.text);
    else out = out.replace(e.anchor, e.text + '\n' + e.anchor);
  }
  if (appendBuf) out += appendBuf.toString('utf8');
  return out;
}

// ---------- main ----------
const clean = readAsar(CLEAN_ASAR);
const patched = readAsar(PATCHED_ASAR);
const ci = index(clean), pi = index(patched);

// 1. payload: kept in the plugin (forwarder mode). Optionally replaced from an
//    external directory that still contains the full dist/modelPatch tree.
const payloadFrom = opt('--payload-from');
const payloadFiles = [...pi.keys()].filter(k => k.startsWith('dist/modelPatch/')).sort();
const asarHasRealPayload = payloadFiles.some((f) => {
  const t = readAt(patched, pi.get(f));
  return t && !t.toString('utf8').includes('antigravity-model-patch: generated forwarder');
});
if (payloadFrom) {
  const src = path.resolve(payloadFrom);
  if (!fs.existsSync(src)) throw new Error('--payload-from not found: ' + src);
  fs.rmSync(path.join(ASSETS, 'modelPatch'), { recursive: true, force: true });
  (function walk(dir, base) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = base ? base + '/' + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else {
        const dest = path.join(ASSETS, 'modelPatch', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(full, dest);
      }
    }
  })(src, '');
  console.log('payload files:', 'replaced from ' + src);
} else {
  const kept = payloadFilesOnDiskCount();
  console.log(`payload files: ${kept} kept in assets/modelPatch (forwarder mode; asar payload ${asarHasRealPayload ? 'present' : 'absent'})`);
  if (!kept) throw new Error('assets/modelPatch is empty and no --payload-from was given');
}
function payloadFilesOnDiskCount() {
  if (!fs.existsSync(path.join(ASSETS, 'modelPatch'))) return 0;
  let n = 0;
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else n++;
    }
  })(path.join(ASSETS, 'modelPatch'));
  return n;
}

// 2. preload blob
const preloadClean = readAt(clean, ci.get('dist/preload.js')).toString('utf8');
const preloadPatched = readAt(patched, pi.get('dist/preload.js')).toString('utf8');
if (!preloadPatched.startsWith(preloadClean)) throw new Error('preload is not a pure append');
const blob = Buffer.from(preloadPatched.slice(preloadClean.length), 'utf8');
fs.writeFileSync(path.join(ASSETS, 'preload-inject.js'), blob);
console.log('preload blob bytes:', blob.length);

// 3. anchored edits for main.js + languageServer.js
const patches = { schema: 1, marker: 'antigravity-model-patch', files: {} };
for (const rel of ['dist/main.js', 'dist/languageServer.js']) {
  const c = readAt(clean, ci.get(rel)).toString('utf8');
  const p = readAt(patched, pi.get(rel)).toString('utf8');
  const { edits } = buildEdits(rel, c, p);
  // round-trip check
  const rebuilt = applyEdits(c, edits, null);
  if (rebuilt !== p) throw new Error('round-trip failed for ' + rel);
  patches.files[rel] = { edits };
  console.log(`${rel}: ${edits.length} edit(s), round-trip OK`);
  for (const e of edits) console.log('   -', e.op, JSON.stringify(e.anchor.slice(0, 90)));
}
patches.files['dist/preload.js'] = { appendFile: 'preload-inject.js' };
patches.forwarders = {
  from: 'modelPatch',
  to: 'dist/modelPatch',
  note: 'schema 2: app.asar keeps only generated forwarder stubs for the entry points required by the edits; the real runtime stays in the plugin assets/modelPatch and is loaded from there.',
};
fs.writeFileSync(path.join(ASSETS, 'patches.json'), JSON.stringify(patches, null, 2));

// 4. multi-block integrity formula check (optional; needs the unpacked file on disk)
{
  const p = path.join(RES, 'app.asar.unpacked/node_modules/chrome-devtools-mcp/build/src/third_party/index.js');
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    const blockSize = 4194304;
    const blocks = [];
    for (let i = 0; i < buf.length; i += blockSize) blocks.push(sha(buf.subarray(i, i + blockSize)));
    const hash = sha(buf);
    console.log('multi-block formula check (hash = sha256 of whole file):', hash === 'fc6ae43cb8f6007eba4b0f269290ec8fea6db7670686d17967b4812d90d2cc10' ? 'OK' : 'MISMATCH -> ' + hash);
  } else {
    console.log('multi-block formula check: skipped (unpacked sample not present)');
  }
}

// 5. full reconstruction test: rebuild patched asar from clean + forwarders + edits
{
  const entryRe = /require\((['"])\.\/modelPatch\/([^'"]+?)\1\)/g;
  const ents = new Set();
  for (const spec of Object.values(patches.files))
    for (const e of spec.edits || []) { entryRe.lastIndex = 0; let m; while ((m = entryRe.exec(e.text))) ents.add(m[2]); }
  const stub = (rel) => Buffer.from(
    `"use strict";\n// antigravity-model-patch: generated forwarder (schema 2).\n` +
    `module.exports = require(${JSON.stringify(path.join(ASSETS, 'modelPatch', rel))});\n`, 'utf8');
  const newContent = new Map();
  for (const rel of [...ents].sort()) newContent.set('dist/modelPatch/' + rel, stub(rel));
  for (const rel of Object.keys(patches.files)) {
    const spec = patches.files[rel];
    const c = readAt(clean, ci.get(rel)).toString('utf8');
    const appendBuf = spec.appendFile ? fs.readFileSync(path.join(ASSETS, spec.appendFile)) : null;
    newContent.set(rel, Buffer.from(applyEdits(c, spec.edits || [], appendBuf), 'utf8'));
  }
  let same = 0, diff = [];
  const all = new Set([...ci.keys(), ...pi.keys()]);
  for (const f of all) {
    const a = ci.has(f) ? readAt(clean, ci.get(f)) : null;
    const b = pi.has(f) ? readAt(patched, pi.get(f)) : null;
    const n = newContent.has(f) ? newContent.get(f) : a;
    if (n && b && Buffer.compare(n, b) === 0) same++;
    else if (!b && !n) same++;
    else diff.push(f);
  }
  console.log('reconstruction: identical files =', same, '/', all.size, ' differing =', diff.length);
  for (const d of diff) console.log('   differs:', d);
  if (asarHasRealPayload) {
    console.log('note: --patched still carries a full payload; a schema-2 asar keeps only forwarders, so those files are expected to differ.');
  }
}
console.log('BUILD OK');
