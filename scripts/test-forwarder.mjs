// Sanity test for the schema-2 forwarder: syntax + real require chain.
//   node test-forwarder.mjs
//
// desktop.js requires 'electron' at top level, which only exists inside the
// Electron app, so this test injects a stub through NODE_PATH (exercising the
// globalPaths fallback the forwarder installs).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { forwarderStub, collectEntries, payloadFilesOnDisk } from './apply-model-patch.mjs';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = path.join(os.tmpdir(), 'ag-model-patch-forwarder-test');

const patches = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'assets', 'patches.json'), 'utf8'));
const entries = collectEntries(patches);
const onDisk = payloadFilesOnDisk();

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

check(`patches.json declares entries ${entries.join(', ')}`, entries.length > 0);
check('every declared entry exists in assets/modelPatch', entries.every((e) => onDisk.includes(e)),
  entries.filter((e) => !onDisk.includes(e)).join(',') || 'all present');
check('plugin does not ship a second electron-log (must use the host app copy)',
  !fs.existsSync(path.join(PLUGIN, 'node_modules', 'electron-log', 'package.json')));

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(SCRATCH, 'node_modules', 'electron'), { recursive: true });
for (const rel of entries) {
  const stub = forwarderStub(rel);
  fs.writeFileSync(path.join(SCRATCH, rel), stub);
  try {
    new (await import('node:vm')).Script(stub, { filename: rel });
    check(`stub ${rel} parses`, true);
  } catch (e) {
    check(`stub ${rel} parses`, false, e.message);
  }
}
// stub electron so desktop.js can be required outside the app
fs.writeFileSync(
  path.join(SCRATCH, 'node_modules', 'electron', 'package.json'),
  JSON.stringify({ name: 'electron', version: '0.0.0-stub', main: 'index.js' }),
);
fs.writeFileSync(
  path.join(SCRATCH, 'node_modules', 'electron', 'index.js'),
  `'use strict';
module.exports = {
  app: { getPath: () => os.homedir(), getAppPath: () => '/app', on: () => {}, whenReady: () => Promise.resolve() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  session: { defaultSession: { webRequest: { onBeforeRequest: () => {} } } },
  BrowserWindow: class {},
  shell: { openExternal: () => {} },
  dialog: {},
  net: { request: () => {} },
};
`,
);
fs.mkdirSync(path.join(SCRATCH, 'node_modules', 'electron-log'), { recursive: true });
fs.writeFileSync(
  path.join(SCRATCH, 'node_modules', 'electron-log', 'package.json'),
  JSON.stringify({ name: 'electron-log', version: '0.0.0-stub', main: 'index.js' }),
);
fs.writeFileSync(
  path.join(SCRATCH, 'node_modules', 'electron-log', 'index.js'),
  `'use strict';
const log = (...a) => {};
module.exports = Object.assign(log, { info: log, warn: log, error: log, debug: log, verbose: log, silly: log, transports: {} });
`,
);

const portInUse = false; // placeholder removed; port probing belongs to --status

for (const rel of entries) {
  // Load the forwarder in a child process whose NODE_PATH points at a stub
  // 'electron' (desktop.js requires it at top level; it only exists inside the
  // app). This also exercises the globalPaths fallback the forwarder installs.
  const loader = path.join(SCRATCH, 'load-' + rel.replace(/[^\w.-]/g, '_') + '.cjs');
  fs.writeFileSync(
    loader,
    `'use strict';\nconst m = require(${JSON.stringify(path.join(SCRATCH, rel))});\n` +
      `const v = m.default !== undefined ? m.default : m;\n` +
      `if (v == null) { console.error('EMPTY'); process.exit(1); }\n` +
      `console.log(Object.keys(v).slice(0, 8).join(','));\n`,
  );
  try {
    const out = execFileSync(process.execPath, [loader], {
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.join(SCRATCH, 'node_modules') },
    }).trim();
    check(`forwarder ${rel} loads the real payload`, true, out);
  } catch (e) {
    const msg = (e.stderr || e.message || '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
    check(`forwarder ${rel} loads the real payload`, false, msg);
  }
}

function pathToFileURL(p) {
  return new URL('file://' + p.replace(/\\/g, '/'));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
