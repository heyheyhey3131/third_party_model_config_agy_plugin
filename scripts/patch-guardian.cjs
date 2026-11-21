"use strict";
/**
 * patch-guardian.cjs — keep the model-patch + Codex-slider hooks alive across
 * Antigravity version updates, with zero manual adjustment.
 *
 * Why updates break the plugins:
 *   Both plugins install by editing resources/app.asar (forwarder stubs + anchor
 *   edits for the model patch; an inlined preload payload for the slider). The
 *   official updater REPLACES app.asar wholesale on every version bump, so those
 *   in-archive hooks are wiped. The real runtime lives in the plugin directories
 *   and survives; only the hooks inside app.asar are lost.
 *
 * What the guardian does:
 *   Watches app.asar's mtime. When it changes (an update) and the patch markers
 *   are gone, it waits for the brief window where Antigravity is NOT running
 *   (the updater quits the app before swapping files, and again on any manual
 *   quit), then re-runs both installers. The next launch is therefore already
 *   patched — no user action required.
 *
 *   It only ever writes when Antigravity is closed, so it never fights a running
 *   instance or the updater's own file writes (debounced until the asar is stable).
 *
 * Usage:
 *   node patch-guardian.cjs                # resident watcher (started at logon)
 *   node patch-guardian.cjs --once         # single check/repair pass, then exit
 *   node patch-guardian.cjs --install-task # register the logon scheduled task
 *   node patch-guardian.cjs --remove-task  # remove the scheduled task
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const HERE = __dirname;
const MODEL_APPLY = path.join(HERE, "apply-model-patch.mjs");
const SLIDER_TOOLS = path.join(os.homedir(), ".gemini", "config", "plugins",
  "antigravity-codex-effort-slider", "assets", "sliderPatch", "tools");
const SLIDER_PATCH = path.join(SLIDER_TOOLS, "patch-asar.cjs");
const { findDefaultAsarPath } = require(SLIDER_PATCH);

const LOG_PATH = path.join(HERE, "patch-guardian.log");
const TASK_NAME = "Antigravity Patch Guardian";
const MODEL_MARKER = "antigravity-model-patch";
const SLIDER_MARKER = "__AG_CODEX_EFFORT_SLIDER_START__";
const POLL_MS = 600;
const DEBOUNCE_MS = 800;
// A launch this young right after an asar change is the post-update relaunch;
// restart it once into the patched state so no manual quit is needed.
const FRESH_WINDOW_MS = 180000;

const args = process.argv.slice(2);
const ONCE = args.includes("--once");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(`[PatchGuardian] ${msg}`);
  try {
    fs.appendFileSync(LOG_PATH, line + "\n", "utf8");
    const lines = fs.readFileSync(LOG_PATH, "utf8").trim().split(/\r?\n/);
    if (lines.length > 200) fs.writeFileSync(LOG_PATH, lines.slice(-200).join("\n") + "\n", "utf8");
  } catch {}
}

function isRunning() {
  const r = spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe"),
    ["/fo", "csv", "/nh"], { encoding: "utf8" });
  const out = (r.stdout || "").toLowerCase();
  return out.includes('"antigravity.exe"') || out.includes('"language_server.exe"');
}

// Milliseconds since the (first) Antigravity process started; Infinity if unknown.
function appUptimeMs() {
  try {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "(Get-Process Antigravity -ErrorAction SilentlyContinue | Select-Object -First 1).StartTime.ToString('o')"],
      { encoding: "utf8" });
    const out = (r.stdout || "").trim();
    if (!out) return Infinity;
    return Date.now() - new Date(out).getTime();
  } catch { return Infinity; }
}
function killApp() {
  spawnSync("taskkill.exe", ["/F", "/IM", "Antigravity.exe", "/T"], { stdio: "ignore" });
  spawnSync("taskkill.exe", ["/F", "/IM", "language_server.exe", "/T"], { stdio: "ignore" });
}
function waitClosed(timeoutMs = 30000) {
  const start = Date.now();
  while (isRunning() && Date.now() - start < timeoutMs) {
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},500)"], { stdio: "ignore" });
  }
  return !isRunning();
}
function relaunch() {
  try {
    const asar = findDefaultAsarPath();
    const exe = path.join(path.dirname(path.dirname(asar)), "Antigravity.exe");
    spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    log("relaunched Antigravity into patched state");
  } catch (e) { log("relaunch failed: " + (e && e.message)); }
}

function readMarkers(asarPath) {
  const buf = fs.readFileSync(asarPath);
  return {
    model: buf.includes(MODEL_MARKER),
    slider: buf.includes(SLIDER_MARKER),
  };
}

function runInstaller(script, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...extraArgs], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code == null ? 1 : code));
    child.on("error", () => resolve(1));
  });
}

async function repair() {
  log("unpatched app.asar detected while Antigravity is closed -> re-applying both patches");
  const modelCode = await runInstaller(MODEL_APPLY, ["--apply"]);
  log(`model-patch --apply exit=${modelCode}`);
  const sliderCode = await runInstaller(SLIDER_PATCH, []);
  log(`slider patch-asar exit=${sliderCode}`);
  return modelCode === 0 && sliderCode === 0;
}

async function tick(state) {
  const asarPath = findDefaultAsarPath();
  let stat;
  try { stat = fs.statSync(asarPath); } catch { return; }
  const mtime = stat.mtimeMs;

  if (mtime === state.lastMtime && state.healthy) return; // idle, nothing changed

  let changed = false;
  if (mtime !== state.lastMtime) {
    changed = true;
    state.lastMtime = mtime;
    state.pendingSince = 0;
    let m;
    try { m = readMarkers(asarPath); } catch { return; }
    state.healthy = m.model && m.slider;
    if (state.healthy) { log("app.asar healthy (both hooks present)"); return; }
    log(`app.asar changed and unpatched (model=${m.model} slider=${m.slider})`);
  }
  if (state.healthy || state.busy) return;

  if (isRunning()) {
    state.pendingSince = 0;
    // Fresh post-update relaunch: restart once into the patched state so the
    // user never has to quit manually. Older sessions wait for a natural exit.
    if (changed && appUptimeMs() < FRESH_WINDOW_MS) {
      state.busy = true;
      log("fresh post-update launch detected; auto-restarting into patched state");
      killApp();
      if (waitClosed()) { await repair(); relaunch(); }
      state.busy = false;
      state.lastMtime = 0;
      state.healthy = false;
    }
    return; // otherwise wait for the closed window
  }

  const now = Date.now();
  if (!state.pendingSince) { state.pendingSince = now; return; }
  if (now - state.pendingSince < DEBOUNCE_MS) return;

  state.busy = true;
  state.pendingSince = 0;
  try { await repair(); } catch (e) { log(`repair error: ${e && e.message}`); }
  state.busy = false;
  state.lastMtime = 0; // force re-read next tick
  state.healthy = false;
}

async function resident() {
  log(`guardian started (poll=${POLL_MS}ms)`);
  const state = { lastMtime: 0, healthy: false, pendingSince: 0, busy: false };
  for (;;) {
    try { await tick(state); } catch (e) { log(`tick error (ignored): ${e && e.message}`); state.busy = false; }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function installTask() {
  // Per-user Run key (no elevation needed). Launches the guardian hidden at logon.
  const node = process.execPath;
  const guardian = path.join(HERE, "patch-guardian.cjs");
  const data = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& '${node}' '${guardian}'"`;
  const r = spawnSync("reg.exe", ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v", TASK_NAME, "/t", "REG_SZ", "/d", data, "/f"], { encoding: "utf8" });
  console.log(r.stdout || r.stderr);
  return r.status === 0;
}
function removeTask() {
  const r = spawnSync("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v", TASK_NAME, "/f"], { encoding: "utf8" });
  console.log(r.stdout || r.stderr);
  return r.status === 0;
}

(async () => {
  if (args.includes("--install-task")) { process.exit(installTask() ? 0 : 1); }
  if (args.includes("--remove-task")) { process.exit(removeTask() ? 0 : 1); }
  if (ONCE) {
    const state = { lastMtime: 0, healthy: false, pendingSince: 0, busy: false };
    // single pass: bypass debounce by pre-seeding pendingSince
    await tick(state);
    if (!state.healthy && !state.busy) { state.pendingSince = Date.now() - DEBOUNCE_MS; await tick(state); }
    process.exit(0);
  }
  await resident();
})();