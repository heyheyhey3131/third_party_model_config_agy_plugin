#!/usr/bin/env node
/**
 * apply-model-patch.mjs — (re)apply the Antigravity third-party model patch.
 *
 * The patch consists of:
 *   1. a payload tree  `dist/modelPatch/**`            (43 files, version-independent)
 *   2. anchored edits  in dist/main.js                 (install desktop runtime)
 *                      in dist/languageServer.js       (start local proxy, point LS at it)
 *   3. an appended blob in dist/preload.js             (custom-model management UI)
 *
 * Everything is rebuilt from the *current* app.asar, so this works after any
 * Antigravity update that replaced the archive. The rebuild is byte-exact:
 * every untouched file keeps its original bytes and a freshly computed
 * integrity hash.
 *
 * Usage:
 *   node apply-model-patch.mjs --status                 read-only status report
 *   node apply-model-patch.mjs --verify                 verify integrity + patch markers
 *   node apply-model-patch.mjs --dry-run                show what --apply would do
 *   node apply-model-patch.mjs --apply                  apply (Antigravity must be closed)
 *   node apply-model-patch.mjs --apply --force          apply even if Antigravity is running
 *   node apply-model-patch.mjs --asar <path>            target a different archive
 *
 * Exit codes: 0 ok / already patched, 1 error, 2 Antigravity running,
 *             3 anchors or targets not found (version drift), 4 verify failed.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import net from 'net';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(PLUGIN_ROOT, 'assets');
const PATCHES_FILE = path.join(ASSETS_DIR, 'patches.json');
const PLUGIN_PAYLOAD_DIR = path.join(ASSETS_DIR, 'modelPatch');

const MARKER = 'antigravity-model-patch';
const PROXY_PORT_FILE = 'antigravity-proxy.json';
const DEFAULT_PROXY_PORT = 50999;
const BLOCK_SIZE = 4194304;

// ---------------------------------------------------------------- args ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const MODE_STATUS = has('--status') || (argv.length === 0 && !has('--dry-run'));
const MODE_VERIFY = has('--verify');
const MODE_APPLY = has('--apply') || has('--dry-run');
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const QUIET = has('--quiet');

function log(...a) { if (!QUIET) console.log(...a); }
function fail(msg, code = 1) { console.error('[model-patch] ' + msg); process.exit(code); }

function defaultAsarPath() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'Programs', 'antigravity', 'resources', 'app.asar');
}
const ASAR = path.resolve(opt('--asar') || defaultAsarPath());
const RESOURCES_DIR = path.dirname(ASAR);
const INSTALL_DIR = path.dirname(RESOURCES_DIR);
const APP_EXE = path.join(INSTALL_DIR, 'Antigravity.exe');
const CUSTOM_MODELS = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');

// ------------------------------------------------------------ asar io ----
function parseAsar(buf) {
  if (buf.length < 16 || buf.readUInt32LE(0) !== 4) throw new Error('not an asar archive');
  const headerSize = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.toString('utf8', 16, 16 + jsonLen));
  return { header, dataStart: 8 + headerSize };
}
function collectFiles(node, base, out) {
  for (const [k, v] of Object.entries(node.files || {})) {
    const p = base ? base + '/' + k : k;
    if (v.files) collectFiles(v, p, out);
    else out.set(p, v);
  }
}
function fileMap(header) {
  const m = new Map();
  collectFiles(header, '', m);
  return m;
}
function readEntry(archive, entry) {
  if (!entry || entry.unpacked || entry.offset == null) return null;
  const off = archive.dataStart + Number(entry.offset);
  return archive.buf.subarray(off, off + Number(entry.size));
}
function readText(archive, relPath) {
  const e = fileMap(archive.header).get(relPath);
  if (!e) return undefined;
  const b = readEntry(archive, e);
  return b === null ? undefined : b.toString('utf8');
}
function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function integrityOf(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(sha256hex(buf.subarray(i, i + BLOCK_SIZE)));
  }
  if (blocks.length === 0) blocks.push(sha256hex(buf)); // empty file: one empty-block hash
  return { algorithm: 'SHA256', hash: sha256hex(buf), blockSize: BLOCK_SIZE, blocks };
}

/**
 * Rebuild the archive. `override` maps archive-relative paths to new Buffers.
 * `removed` is a Set of archive-relative paths to drop from the archive.
 * Untouched packed files keep their original bytes; unpacked entries keep
 * their flags and integrity (their data lives in app.asar.unpacked/).
 */
function buildArchive(archive, override, removed = new Set()) {
  const entries = fileMap(archive.header);
  const paths = [...new Set([...entries.keys(), ...override.keys()])]
    .filter((p) => !removed.has(p))
    .sort();
  const chunks = [];
  const newFiles = {};
  let offset = 0;
  const setEntry = (p, entry) => {
    const parts = p.split('/');
    let node = newFiles;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = { files: {} };
      node = node[parts[i]].files;
    }
    node[parts[parts.length - 1]] = entry;
  };
  for (const p of paths) {
    const orig = entries.get(p) || {};
    if (orig.unpacked) {
      setEntry(p, { size: orig.size, unpacked: true, integrity: orig.integrity });
      continue;
    }
    const buf = override.has(p) ? override.get(p) : readEntry(archive, orig);
    if (buf === null) throw new Error('cannot read original bytes of ' + p);
    setEntry(p, { size: buf.length, offset: String(offset), integrity: integrityOf(buf) });
    chunks.push(buf);
    offset += buf.length;
  }
  const jsonBuf = Buffer.from(JSON.stringify({ files: newFiles }), 'utf8');
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  const payloadSize = 4 + jsonBuf.length + pad;
  const headerSize = 4 + payloadSize;
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(4, 0);
  pre.writeUInt32LE(headerSize, 4);
  pre.writeUInt32LE(payloadSize, 8);
  pre.writeUInt32LE(jsonBuf.length, 12);
  return Buffer.concat([pre, jsonBuf, Buffer.alloc(pad, 0), ...chunks]);
}

// ----------------------------------------------------------- processes ----
function processExists(name) {
  try {
    const out = execFileSync(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe'),
      ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }
    );
    return out.toLowerCase().includes(`"${name.toLowerCase()}"`);
  } catch {
    return false;
  }
}
function antigravityState() {
  if (processExists('Antigravity-x64.exe')) return 'installer';
  if (processExists('language_server.exe')) return 'language_server';
  try {
    const out = execFileSync(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command',
        "@(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | ? { (-not $_.CommandLine) -or ($_.CommandLine -notlike '*sidecar_sdk*') }).Count"],
      { encoding: 'utf8', windowsHide: true, timeout: 25000 }
    );
    if (parseInt(out.trim(), 10) > 0) return 'app';
  } catch {
    if (processExists('Antigravity.exe')) return 'app';
  }
  return null;
}

// ------------------------------------------------------------ payload ----
function loadPatches() {
  if (!fs.existsSync(PATCHES_FILE)) fail(`patches.json not found: ${PATCHES_FILE}`, 1);
  return JSON.parse(fs.readFileSync(PATCHES_FILE, 'utf8'));
}

/**
 * Entry points referenced by the anchored edits, e.g. require('./modelPatch/proxy')
 * yields 'proxy.js'. Only these are materialised inside app.asar as forwarders;
 * the real implementation stays in the plugin's assets/modelPatch tree.
 */
function collectEntries(patches) {
  const names = new Set();
  const re = /require\((['"])\.\/modelPatch\/([^'"]+?)\1\)/g;
  for (const spec of Object.values(patches.files || {})) {
    for (const e of spec.edits || []) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(e.text))) {
        // require('./modelPatch/proxy') resolves proxy.js at runtime; normalise
        // so the forwarder path and the plugin payload file agree.
        const name = /\.[cm]?js$/.test(m[2]) ? m[2] : m[2] + '.js';
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** Forwarder stub written into app.asar; resolves the real module from the plugin. */
function forwarderStub(rel) {
  return `"use strict";
// antigravity-model-patch: generated forwarder (schema 2).
// The real implementation lives in the third-party-model-patch plugin, not in app.asar.
const path = require("path");
const os = require("os");
const fs = require("fs");
const ENTRY = ${JSON.stringify(rel)};
const CANDIDATES = [
  process.env.ANTIGRAVITY_MODEL_PATCH_DIR,
  path.join(os.homedir(), ".gemini", "config", "plugins", "third-party-model-patch", "assets", "modelPatch"),
].filter(Boolean);
// Opt-in tracing: AG_PATCH_TRACE=1 appends a line per load to <plugin>/.trace.log.
// Resolve from the plugin root (not __dirname, which is inside app.asar) so the
// trace never lands in the install directory.
const TRACE = process.env.AG_PATCH_TRACE
  ? path.join(os.homedir(), ".gemini", "config", "plugins", "third-party-model-patch", ".trace.log")
  : null;
const trace = (...a) => {
  if (!TRACE) return;
  try { fs.appendFileSync(TRACE, new Date().toISOString() + " " + a.join(" ") + "\\n"); } catch (e) {}
};
const payload = CANDIDATES.find((p) => {
  try { return fs.existsSync(path.join(p, ENTRY)); } catch (e) { return false; }
});
trace("load", ENTRY, "payload=" + payload, "cwd=" + process.cwd(), "appPath=" + (process.env.ANTIGRAVITY_APP_PATH || ""));
if (!payload) {
  const msg = "antigravity-model-patch: payload entry '" + ENTRY + "' not found. Looked in: " +
    CANDIDATES.join(", ") + ". Re-apply the patch from the third-party-model-patch plugin.";
  trace("FAIL", msg);
  throw new Error(msg);
}
// Host-app dependencies (electron-log especially) MUST resolve to the copy
// already loaded from app.asar. A second copy of electron-log registers
// ipcMain.handle('_ELECTRON_LOG_') again and crashes the main process.
try {
  const Module = require("module");
  const electron = require("electron");
  const hostApp = electron.app.getAppPath();
  const hostNm = path.join(hostApp, "node_modules");
  if (fs.existsSync(hostNm) && !Module.globalPaths.includes(hostNm)) Module.globalPaths.unshift(hostNm);
  // Only rewrite electron-log when the host copy is actually on disk. Calling
  // origLoad (not createRequire) avoids re-entering this hook.
  if (fs.existsSync(path.join(hostNm, "electron-log")) && !Module.__agModelPatchHostLoad) {
    Module.__agModelPatchHostLoad = true;
    const origLoad = Module._load;
    const hostParent = {
      id: path.join(hostApp, "package.json"),
      filename: path.join(hostApp, "package.json"),
      paths: Module._nodeModulePaths(hostApp),
    };
    Module._load = function (request, parent, isMain) {
      if (request === "electron-log" || (typeof request === "string" && request.startsWith("electron-log/"))) {
        return origLoad.call(this, request, hostParent, isMain);
      }
      return origLoad.apply(this, arguments);
    };
    trace("hostLoad hook installed", hostNm);
  }
} catch (e) { trace("hostLoad hook failed", e && e.message); }
try {
  const mod = require(path.join(payload, ENTRY));
  trace("loaded", ENTRY, "keys=" + Object.keys(mod).slice(0, 8).join(","));
  module.exports = mod;
} catch (e) {
  trace("REQUIRE FAILED", ENTRY, e && e.message);
  throw e;
}
`;
}

/** Every file the plugin payload actually ships on disk. */
function payloadFilesOnDisk() {
  if (!fs.existsSync(PLUGIN_PAYLOAD_DIR)) return [];
  const out = [];
  (function walk(dir, base) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = base ? base + '/' + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  })(PLUGIN_PAYLOAD_DIR, '');
  return out.sort();
}
function countOccurrences(hay, needle) {
  let c = 0, idx = hay.indexOf(needle);
  while (idx >= 0) { c++; idx = hay.indexOf(needle, idx + needle.length); }
  return c;
}
function applyEdits(text, edits, relPath) {
  let out = text;
  for (const e of edits || []) {
    const n = countOccurrences(out, e.anchor);
    if (n === 0) {
      const err = new Error(`anchor not found in ${relPath}: ${JSON.stringify(e.anchor.slice(0, 100))}`);
      err.code = 'ANCHOR_MISSING';
      throw err;
    }
    if (n > 1) {
      const err = new Error(`anchor occurs ${n}x in ${relPath} (expected 1): ${JSON.stringify(e.anchor.slice(0, 100))}`);
      err.code = 'ANCHOR_AMBIGUOUS';
      throw err;
    }
    out = e.op === 'insertBefore'
      ? out.replace(e.anchor, e.text + '\n' + e.anchor)
      : out.replace(e.anchor, e.anchor + '\n' + e.text);
  }
  return out;
}

// --------------------------------------------------------------- modes ----
function readArchive() {
  if (!fs.existsSync(ASAR)) fail(`app.asar not found: ${ASAR}`, 1);
  const buf = fs.readFileSync(ASAR);
  const archive = parseAsar(buf);
  archive.buf = buf;
  return archive;
}
function getVersion(archive) {
  try {
    const e = fileMap(archive.header).get('package.json');
    const b = readEntry(archive, e);
    return JSON.parse(b.toString('utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}
function checkPort(port, timeout = 600) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => { resolve(false); });
    s.connect(port, '127.0.0.1');
  });
}

async function cmdStatus() {
  const archive = readArchive();
  const version = getVersion(archive);
  const patches = loadPatches();
  const files = fileMap(archive.header);
  console.log(`app.asar      : ${ASAR}`);
  console.log(`version       : ${version}`);
  const entries = collectEntries(patches);
  const onDisk = payloadFilesOnDisk();
  const missingEntries = entries.filter((rel) => !onDisk.includes(rel));
  console.log(`plugin payload: ${onDisk.length} file(s) in ${PLUGIN_PAYLOAD_DIR}${missingEntries.length ? ` — MISSING ${missingEntries.join(', ')}` : ''}`);
  for (const rel of entries) {
    const e = files.get('dist/modelPatch/' + rel);
    const text = e ? readText(archive, rel === '' ? 'dist/modelPatch' : 'dist/modelPatch/' + rel) : undefined;
    console.log(`  dist/modelPatch/${rel.padEnd(18)}: ${text === undefined ? 'NOT IN ARCHIVE' : text.includes(MARKER) ? 'forwarder' : 'NOT a forwarder'}`);
  }
  const stale = [...files.keys()].filter(
    (p) => p.startsWith('dist/modelPatch/') && !entries.some((r) => p === 'dist/modelPatch/' + r),
  );
  console.log(`asar payload  : ${stale.length ? stale.length + ' schema-1 payload file(s) inside app.asar (run --apply to slim to forwarders)' : 'none (forwarder mode)'}`);
  for (const [rel, spec] of Object.entries(patches.files)) {
    const text = readText(archive, rel);
    if (text === undefined) {
      console.log(`  ${rel.padEnd(24)} : NOT IN ARCHIVE`);
      continue;
    }
    if (text.includes(MARKER)) {
      console.log(`  ${rel.padEnd(24)} : patched`);
    } else if (spec.edits) {
      let anchorOk = true;
      for (const e of spec.edits) if (countOccurrences(text, e.anchor) !== 1) anchorOk = false;
      console.log(`  ${rel.padEnd(24)} : NOT patched (anchors ${anchorOk ? 'match — can re-apply' : 'DRIFTED — manual review needed'})`);
    } else {
      console.log(`  ${rel.padEnd(24)} : NOT patched`);
    }
  }
  // proxy marker + port
  const markerFile = path.join(INSTALL_DIR, PROXY_PORT_FILE);
  let port = DEFAULT_PROXY_PORT;
  if (fs.existsSync(markerFile)) {
    try {
      const v = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
      if (v && v.requiredPort) port = v.requiredPort;
      console.log(`proxy port    : ${port} (pinned by ${PROXY_PORT_FILE})`);
    } catch {
      console.log(`proxy port    : ${port} (${PROXY_PORT_FILE} unreadable, assuming default)`);
    }
  } else {
    console.log(`proxy port    : ${port} (default; no ${PROXY_PORT_FILE})`);
  }
  const live = await checkPort(port);
  console.log(`proxy status  : ${live ? `LISTENING on 127.0.0.1:${port}` : 'not listening (Antigravity closed or patch inactive)'}`);
  // custom models
  if (fs.existsSync(CUSTOM_MODELS)) {
    try {
      const cm = JSON.parse(fs.readFileSync(CUSTOM_MODELS, 'utf8'));
      const models = cm.models || [];
      const on = models.filter((m) => m.enabled !== false);
      console.log(`custom models : ${models.length} configured, ${on.length} enabled`);
      for (const m of models) {
        console.log(`   - ${m.displayName || m.name}  [${m.provider}] ${m.enabled === false ? '(disabled)' : ''}`);
      }
    } catch (e) {
      console.log(`custom models : ${CUSTOM_MODELS} unreadable (${e.message})`);
    }
  } else {
    console.log(`custom models : none (${CUSTOM_MODELS} absent)`);
  }
  // backups
  const baks = fs.readdirSync(RESOURCES_DIR).filter((f) => /^app\.asar\..*\.bak$/.test(f)).sort();
  console.log(`backups       : ${baks.length ? baks.join(', ') : 'none'}`);
  const state = antigravityState();
  console.log(`antigravity   : ${state ? `RUNNING (${state})` : 'not running'}`);
  return 0;
}

function cmdVerify() {
  const archive = readArchive();
  const version = getVersion(archive);
  const files = fileMap(archive.header);
  let bad = 0, checked = 0, stale = 0;
  for (const [p, e] of files) {
    if (e.unpacked) continue;
    const b = readEntry(archive, e);
    if (b === null) { console.log(`  UNREADABLE ${p}`); bad++; continue; }
    checked++;
    if (!e.integrity || sha256hex(b) !== e.integrity.hash) {
      // The update-fix watchdog patches ipcHandlers.js/updater.js in place
      // (same byte length) without refreshing header hashes, so those two
      // entries can carry a stale hash. Harmless at runtime; refreshed on the
      // next model-patch apply.
      if (b.toString('utf8').includes('agy-update-fix')) {
        console.log(`  STALE HASH ${p} (in-place update-fix patch; refreshed on next apply)`);
        stale++;
        continue;
      }
      console.log(`  INTEGRITY MISMATCH ${p}`);
      bad++;
    }
  }
  const patches = loadPatches();
  const entries = collectEntries(patches);
  const onDisk = payloadFilesOnDisk();
  const missing = [];
  for (const rel of entries) {
    if (!onDisk.includes(rel)) missing.push(`plugin payload ${rel}`);
    const text = readText(archive, 'dist/modelPatch/' + rel);
    if (text === undefined || !text.includes(MARKER)) missing.push('dist/modelPatch/' + rel + ' (forwarder)');
  }
  const staleAsar = [...files.keys()].filter((p) => p.startsWith('dist/modelPatch/') && !entries.some((r) => p === 'dist/modelPatch/' + r));
  if (staleAsar.length) missing.push(`${staleAsar.length} payload file(s) still inside app.asar (forwarder mode expected)`);
  for (const [rel, spec] of Object.entries(patches.files)) {
    const text = readText(archive, rel);
    if (text === undefined || !text.includes(MARKER)) missing.push(rel);
  }
  console.log(`[model-patch] verify: version=${version} integrity=${checked} files checked, ${bad} bad${stale ? `, ${stale} stale-hash (update-fix)` : ''}; forwarders=${entries.length}, plugin payload=${onDisk.length} file(s); patch markers missing: ${missing.length ? missing.join(', ') : 'none'}`);
  if (bad > 0) return 4;
  if (missing.length > 0) return 4;
  console.log('[model-patch] OK — archive integrity valid and patch fully applied.');
  return 0;
}

function computeOverride(archive, patches) {
  const files = fileMap(archive.header);
  const override = new Map();
  const removed = new Set();
  const skipped = [];
  const report = [];
  // 1. anchored edits + append
  for (const [rel, spec] of Object.entries(patches.files)) {
    const entry = files.get(rel);
    if (!entry) {
      const err = new Error(`${rel} not found in this app.asar (version drift?)`);
      err.code = 'TARGET_MISSING';
      throw err;
    }
    const text = readEntry(archive, entry).toString('utf8');
    if (text.includes(MARKER)) { skipped.push(rel); continue; }
    let out = applyEdits(text, spec.edits, rel);
    if (spec.appendFile) {
      const blob = fs.readFileSync(path.join(ASSETS_DIR, spec.appendFile));
      out += blob.toString('utf8');
    }
    override.set(rel, Buffer.from(out, 'utf8'));
    report.push(`${rel}: ${spec.edits ? spec.edits.length + ' edit(s)' : ''}${spec.edits && spec.appendFile ? ' + ' : ''}${spec.appendFile ? 'append ' + spec.appendFile : ''}`);
  }
  // 2. forwarders: only the entry points the edits require. The 43-file runtime
  //    stays in the plugin's assets/modelPatch and is loaded from there at runtime.
  const entries = collectEntries(patches);
  const onDisk = payloadFilesOnDisk();
  const missingPayload = entries.filter((rel) => !onDisk.includes(rel));
  if (missingPayload.length) {
    const err = new Error(`plugin payload is missing ${missingPayload.join(', ')} under ${PLUGIN_PAYLOAD_DIR}`);
    err.code = 'PAYLOAD_CONFLICT';
    throw err;
  }
  let added = 0, kept = 0, dropped = 0, migrated = 0;
  for (const rel of entries) {
    const dest = 'dist/modelPatch/' + rel;
    const buf = Buffer.from(forwarderStub(rel), 'utf8');
    const cur = files.has(dest) ? readEntry(archive, files.get(dest)) : null;
    if (cur && Buffer.compare(cur, buf) === 0) { kept++; continue; }
    if (cur && !cur.toString('utf8').includes(MARKER)) {
      // schema 1 left the real payload inside the asar. Slim it to a forwarder
      // only when the bytes match this plugin's own copy, so a foreign file is
      // never overwritten.
      const pluginCopy = fs.existsSync(path.join(PLUGIN_PAYLOAD_DIR, rel))
        ? fs.readFileSync(path.join(PLUGIN_PAYLOAD_DIR, rel))
        : null;
      if (pluginCopy && Buffer.compare(cur, pluginCopy) === 0) { migrated++; override.set(dest, buf); continue; }
      const err = new Error(`${dest} exists but is not a patch forwarder; refusing to overwrite`);
      err.code = 'PAYLOAD_CONFLICT';
      throw err;
    }
    override.set(dest, buf);
    added++;
  }
  // 3. drop any payload left inside app.asar by an older (pre-forwarder) apply
  for (const p of files.keys()) {
    if (!p.startsWith('dist/modelPatch/')) continue;
    if (entries.some((rel) => p === 'dist/modelPatch/' + rel)) continue;
    const pluginCopyRel = p.slice('dist/modelPatch/'.length);
    const pluginCopy = fs.existsSync(path.join(PLUGIN_PAYLOAD_DIR, pluginCopyRel))
      ? fs.readFileSync(path.join(PLUGIN_PAYLOAD_DIR, pluginCopyRel))
      : null;
    const cur = readEntry(archive, files.get(p));
    if (!cur || !pluginCopy || Buffer.compare(cur, pluginCopy) !== 0) continue;
    removed.add(p);
    dropped++;
  }
  return { override, removed, skipped, added, kept, dropped, migrated, entries, payloadCount: onDisk.length, report };
}

function cmdApply() {
  const archive = readArchive();
  const version = getVersion(archive);
  const patches = loadPatches();
  const files = fileMap(archive.header);

  // already patched (forwarders current, markers present, asar slimmed)?
  const entries = collectEntries(patches);
  const onDisk = payloadFilesOnDisk();
  const payloadMissing = entries.some((rel) => !onDisk.includes(rel));
  const forwardersCurrent = entries.every((rel) => {
    const cur = files.has('dist/modelPatch/' + rel) ? readEntry(archive, files.get('dist/modelPatch/' + rel)) : null;
    return cur !== null && Buffer.compare(cur, Buffer.from(forwarderStub(rel), 'utf8')) === 0;
  });
  let allMarkers = true;
  for (const rel of Object.keys(patches.files)) {
    const text = readText(archive, rel);
    if (text === undefined || !text.includes(MARKER)) allMarkers = false;
  }
  const asarSlim = ![...files.keys()].some(
    (p) => p.startsWith('dist/modelPatch/') && !entries.some((rel) => p === 'dist/modelPatch/' + rel),
  );
  if (forwardersCurrent && allMarkers && asarSlim && !payloadMissing) {
    log(`[model-patch] already applied (version ${version}); forwarder mode, payload served from the plugin. Nothing to do.`);
    return 0;
  }

  let computed;
  try {
    computed = computeOverride(archive, patches);
  } catch (e) {
    if (e.code === 'ANCHOR_MISSING' || e.code === 'ANCHOR_AMBIGUOUS' || e.code === 'TARGET_MISSING') {
      fail(`${e.message}\nThe vendor code changed in version ${version}. Re-apply manually: inspect the target file, adapt the anchor in assets/patches.json, then re-run.`, 3);
    }
    if (e.code === 'PAYLOAD_CONFLICT') fail(e.message, 3);
    throw e;
  }
  const { override, removed, skipped, added, kept, dropped, migrated, entries: ents, payloadCount, report } = computed;
  log(`[model-patch] version=${version} asar=${ASAR}`);
  for (const r of report) log(`  edit  ${r}`);
  if (skipped.length) log(`  skip  already patched: ${skipped.join(', ')}`);
  log(`  fwd   ${ents.map((e) => 'dist/modelPatch/' + e).join(', ')} -> ${PLUGIN_PAYLOAD_DIR} (${payloadCount} file(s))${kept ? `, ${kept} current` : ''}${added ? `, ${added} new` : ''}${migrated ? `, ${migrated} slimmed from schema-1 payload` : ''}`);
  if (dropped) log(`  drop  ${dropped} payload file(s) from app.asar (now served by the plugin)`);
  log(`  total ${override.size} file(s) change${removed.size ? `, ${removed.size} removed` : ''}; archive will be rebuilt (untouched files keep original bytes + fresh integrity).`);

  if (DRY_RUN) {
    log('[model-patch] dry run — nothing written.');
    return 0;
  }

  const state = antigravityState();
  if (state && !FORCE) {
    fail(`Antigravity is running (${state}). Close it first (or use scripts/activate-patch.bat), or pass --force.`, 2);
  }

  // backup once per version
  const backup = `${ASAR}.model-patch-${version}.bak`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(ASAR, backup);
    log(`[model-patch] backup: ${backup}`);
  } else {
    log(`[model-patch] backup exists: ${backup}`);
  }

  const out = buildArchive(archive, override, removed);
  const tmp = `${ASAR}.model-patch.tmp`;
  fs.writeFileSync(tmp, out);
  try {
    fs.renameSync(tmp, ASAR);
  } catch {
    fs.copyFileSync(tmp, ASAR);
    fs.unlinkSync(tmp);
  }
  log(`[model-patch] written ${ASAR} (${out.length} bytes)`);

  // self-verify
  const reread = readArchive();
  const rc = cmdVerifyQuiet(reread);
  if (rc !== 0) fail('post-write verification FAILED — restore the backup if the app misbehaves.', 4);
  log('[model-patch] post-write verification OK.');
  log('[model-patch] done. Start Antigravity; custom models appear in Settings.');
  return 0;
}
function cmdVerifyQuiet(archive) {
  const files = fileMap(archive.header);
  for (const [p, e] of files) {
    if (e.unpacked) continue;
    const b = readEntry(archive, e);
    if (b === null || !e.integrity || sha256hex(b) !== e.integrity.hash) return 4;
  }
  const patches = loadPatches();
  const entries = collectEntries(patches);
  const onDisk = payloadFilesOnDisk();
  if (entries.some((rel) => !onDisk.includes(rel))) return 4;
  for (const rel of entries) {
    const text = readText(archive, 'dist/modelPatch/' + rel);
    if (text === undefined || !text.includes(MARKER)) return 4;
  }
  for (const rel of Object.keys(patches.files)) {
    const text = readText(archive, rel);
    if (text === undefined || !text.includes(MARKER)) return 4;
  }
  return 0;
}

// ---------------------------------------------------------------- main ----
export { forwarderStub, collectEntries, payloadFilesOnDisk };

(async () => {
  try {
    if (MODE_APPLY) process.exit(cmdApply());
    if (MODE_VERIFY) process.exit(cmdVerify());
    if (MODE_STATUS) process.exit(await cmdStatus());
    console.log('usage: node apply-model-patch.mjs [--status|--verify|--apply] [--dry-run] [--force] [--asar <path>]');
    process.exit(0);
  } catch (e) {
    fail(e.stack || e.message, 1);
  }
})();
