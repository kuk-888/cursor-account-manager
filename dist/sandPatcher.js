'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sandStream = require('./sandStream');

const HEADER = 'x-cursor-client-type';
const VALUE = 'sand';

const CANDIDATE_FILES = sandStream.TARGET_SPECS.map((spec) => spec.rel);

// 2.1.0–2.2.9 只打这 4 个文件的无标记请求头。卸载/扫描必须永远覆盖它们，
// 即使以后注入清单变短，旧 Release 打过的文件也要能卸掉。
const LEGACY_HEADER_RELS = [
  path.join('out', 'main.js'),
  path.join('out', 'vs', 'workbench', 'workbench.desktop.main.js'),
  path.join('out', 'vs', 'workbench', 'api', 'node', 'extensionHostProcess.js'),
  path.join('out', 'vs', 'workbench', 'api', 'worker', 'extensionHostWorkerMain.js')
];

function uniqueRels(rels) {
  const seen = new Set();
  const out = [];
  for (const rel of rels) {
    const key = rel.split(path.sep).join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rel);
  }
  return out;
}

const SCAN_FILES = uniqueRels([...LEGACY_HEADER_RELS, ...CANDIDATE_FILES]);

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function vscodeChecksum(data) {
  return crypto.createHash('sha256').update(data).digest('base64').replace(/=+$/, '');
}

function utcStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

function assertAppRoot(appRoot) {
  const root = path.resolve(appRoot);
  const productPath = path.join(root, 'product.json');
  const outPath = path.join(root, 'out');
  if (!fs.existsSync(productPath) || !fs.statSync(productPath).isFile()) {
    throw new Error(`Invalid Cursor app root: product.json not found under ${root}`);
  }
  if (!fs.existsSync(outPath) || !fs.statSync(outPath).isDirectory()) {
    throw new Error(`Invalid Cursor app root: out directory not found under ${root}`);
  }
  return root;
}

function defaultAppRoot() {
  const candidates = [];
  if (process.env.CURSOR_APP_ROOT) candidates.push(process.env.CURSOR_APP_ROOT);
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Cursor.app/Contents/Resources/app');
    candidates.push(path.join(os.homedir(), 'Applications/Cursor.app/Contents/Resources/app'));
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) candidates.push(path.join(local, 'Programs', 'cursor', 'resources', 'app'));
  } else {
    candidates.push('/usr/share/cursor/resources/app');
    candidates.push('/opt/Cursor/resources/app');
  }
  for (const candidate of candidates) {
    try {
      return assertAppRoot(candidate);
    } catch {
      // Try the next conventional install location.
    }
  }
  throw new Error('Cursor installation not found. Pass --app-root or set cursorAccountManager.sandAppRoot.');
}

function defaultStateRoot() {
  if (process.env.CURSOR_SAND_ROUTER_STATE) {
    return path.resolve(process.env.CURSOR_SAND_ROUTER_STATE);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor Sand Router');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'Cursor Sand Router');
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'cursor-sand-router');
}

function withOperationLock(stateRoot, operation) {
  const root = path.resolve(stateRoot);
  const lockPath = path.join(root, '.operation.lock');
  fs.mkdirSync(root, { recursive: true });
  const claim = () => {
    try {
      fs.mkdirSync(lockPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockPath).mtimeMs > 120_000;
      } catch {
        stale = true;
      }
      if (!stale) {
        throw new Error(`Another Cursor Sand Router operation is in progress: ${lockPath}`);
      }
      fs.rmSync(lockPath, { recursive: true, force: true });
      fs.mkdirSync(lockPath);
    }
    fs.writeFileSync(
      path.join(lockPath, 'owner.json'),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`
    );
  };
  claim();
  try {
    return operation();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function countMatches(text, regex) {
  return Array.from(text.matchAll(regex)).length;
}

function analyzeText(text) {
  const defaultSetter = /\.set\(\s*["']x-cursor-client-type["']\s*,\s*[A-Za-z_$][\w$]*\s*\?\?\s*["']ide["']\s*\)/g;
  const ideSetter = /\.set\(\s*["']x-cursor-client-type["']\s*,\s*["']ide["']\s*\)/g;
  const sandSetter = /\.set\(\s*["']x-cursor-client-type["']\s*,\s*["']sand["']\s*\)/g;
  const ideObject = /["']x-cursor-client-type["']\s*:\s*["']ide["']/g;
  const sandObject = /["']x-cursor-client-type["']\s*:\s*["']sand["']/g;
  const stream = sandStream.detectSand(text);
  return {
    headerMentions: countMatches(text, /x-cursor-client-type/g),
    unpatchedAssignments: countMatches(text, defaultSetter) + countMatches(text, ideSetter) + countMatches(text, ideObject),
    sandAssignments: countMatches(text, sandSetter) + countMatches(text, sandObject),
    stream
  };
}

function emptyStreamTotals() {
  return {
    client: 0,
    eligibility: 0,
    managedLocal: 0,
    runtimeLoad: 0,
    moveExec: 0,
    directStream: 0,
    agentHost: 0,
    identity: 0,
    subagentRoute: 0,
    subagentSession: 0,
    taskTool: 0,
    legacyTaskTool: 0,
    actionRoute: 0,
    resumeMode: 0,
    completionWake: 0,
    legacy: 0
  };
}

function addStreamTotals(acc, item) {
  const out = acc || emptyStreamTotals();
  for (const key of Object.keys(out)) out[key] += (item && item[key]) || 0;
  return out;
}

function reverseUnmarkedClientSand(text) {
  let replacements = 0;
  const replace = (regex, replacer) => {
    text = text.replace(regex, (...args) => {
      replacements += 1;
      return replacer(...args);
    });
  };
  // 2.1.0–2.2.9 无标记注入 + 2.3.1 之后 stream 没盖住的漏网请求头。
  replace(
    /(isGlass\s*\?\s*["']glass["']\s*:\s*)["']sand["']/g,
    (_match, prefix) => `${prefix}"ide"`
  );
  replace(
    /(\.set\(\s*["']x-cursor-client-type["']\s*,\s*)["']sand["'](\s*\))/g,
    (_match, prefix, suffix) => `${prefix}"ide"${suffix}`
  );
  replace(
    /(header\.set\(\s*["']x-cursor-client-type["']\s*,\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*(?:\?\?|\|\|)\s*)["']sand["']/g,
    (_match, prefix) => `${prefix}"ide"`
  );
  replace(
    /(["']x-cursor-client-type["']\s*:\s*)["']sand["']/g,
    (_match, prefix) => `${prefix}"ide"`
  );
  replace(
    /(clientIdentity\s*:\s*\{\s*clientType\s*:\s*)["']sand["'](\s*\})/g,
    (_match, prefix, suffix) => `${prefix}"ide"${suffix}`
  );
  return { text, replacements };
}

const LEFTOVER_MARKERS = [
  'SAND_CLIENT_MODE_V1',
  'SAND_CLIENT_EXISTING_V1',
  'SAND_ELIGIBILITY_MODE_V1',
  'SAND_MANAGED_LOCAL_ROUTE_V1',
  'SAND_DIRECT_INFERENCE_STREAM_V1',
  'SAND_AGENT_HOST_ENABLEMENT_V1',
  'SAND_LOCAL_RUNTIME_LOAD_V1',
  'SAND_AGENT_HOST_MOVE_EXEC_V1',
  'SAND_AGENT_HOST_IDENTITY_V1',
  'SAND_MANAGED_SUBAGENT_ROUTE_V1',
  'SAND_MANAGED_SUBAGENT_SESSION_V1',
  'SAND_MANAGED_TASK_TOOL_V2',
  'SAND_MANAGED_TASK_TOOL_V1',
  'SAND_MANAGED_ACTION_ROUTE_V1',
  'SAND_SUBAGENT_RESUME_AGENT_MODE_V1',
  'SAND_SUBAGENT_COMPLETION_WAKE_V1',
  'KC_SAND_CLIENT_V1',
  'KC_SAND_ELIGIBILITY_V1'
];

function leftoverMarkers(root) {
  const hits = [];
  for (const { rel, abs } of scanCandidatePaths(root)) {
    const text = fs.readFileSync(abs, 'utf8');
    const markers = LEFTOVER_MARKERS.filter((marker) => text.includes(marker));
    if (markers.length) hits.push({ rel, markers });
  }
  return hits;
}

function applyAllPatches(text) {
  const streamed = sandStream.applySandPatches(text);
  const headed = patchText(streamed.content);
  return {
    text: headed.text,
    replacements: headed.replacements + sandStream.sumStats(streamed.stats),
    streamStats: streamed.stats,
    headerReplacements: headed.replacements,
    analysis: analyzeText(headed.text)
  };
}

function uninstallAllPatches(text) {
  // 先拆带标记的 Stream（2.3.1 / 1.2.3 / 1.2.6），再拆 2.1.0–2.2.9 无标记请求头。
  const streamed = sandStream.removeSandPatches(text);
  const headed = reverseUnmarkedClientSand(streamed.content);
  return {
    text: headed.text,
    replacements: headed.replacements + sandStream.sumStats(streamed.stats),
    analysis: analyzeText(headed.text)
  };
}

function patchText(text) {
  let replacements = 0;
  const replace = (regex, replacer) => {
    text = text.replace(regex, (...args) => {
      replacements += 1;
      return replacer(...args);
    });
  };

  replace(
    /(\.set\(\s*["']x-cursor-client-type["']\s*,\s*)[A-Za-z_$][\w$]*\s*\?\?\s*["']ide["'](\s*\))/g,
    (_match, prefix, suffix) => `${prefix}"sand"${suffix}`
  );
  replace(
    /(\.set\(\s*["']x-cursor-client-type["']\s*,\s*)["']ide["'](\s*\))/g,
    (_match, prefix, suffix) => `${prefix}"sand"${suffix}`
  );
  replace(
    /(["']x-cursor-client-type["']\s*:\s*)["']ide["']/g,
    (_match, prefix) => `${prefix}"sand"`
  );

  return { text, replacements, analysis: analyzeText(text) };
}

function pathsFromRels(appRoot, rels) {
  return rels
    .map((rel) => ({ rel, abs: path.join(appRoot, rel) }))
    .filter(({ abs }) => fs.existsSync(abs) && fs.statSync(abs).isFile());
}

function applyCandidatePaths(appRoot) {
  return pathsFromRels(appRoot, CANDIDATE_FILES);
}

function scanCandidatePaths(appRoot) {
  return pathsFromRels(appRoot, SCAN_FILES);
}

function inspect(appRoot) {
  const root = assertAppRoot(appRoot);
  const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
  const files = scanCandidatePaths(root).map(({ rel, abs }) => {
    const data = fs.readFileSync(abs);
    const analysis = analyzeText(data.toString('utf8'));
    return { rel, sha256: sha256(data), ...analysis };
  });
  const totals = files.reduce(
    (acc, file) => {
      acc.headerMentions += file.headerMentions;
      acc.unpatchedAssignments += file.unpatchedAssignments;
      acc.sandAssignments += file.sandAssignments;
      acc.stream = addStreamTotals(acc.stream, file.stream);
      return acc;
    },
    { headerMentions: 0, unpatchedAssignments: 0, sandAssignments: 0, stream: emptyStreamTotals() }
  );
  const streamMode = sandStream.streamModeInstalled(totals.stream);
  const streamLifecycle = sandStream.streamLifecycleInstalled(totals.stream);
  const headerPatched = totals.sandAssignments > 0 && totals.unpatchedAssignments === 0;
  const streamPartial = Object.values(totals.stream).some((n) => n > 0);
  return {
    appRoot: root,
    version: product.version || 'unknown',
    files,
    totals,
    streamMode,
    streamLifecycle,
    streamPartial,
    patched: headerPatched || streamMode || streamLifecycle || (streamPartial && totals.unpatchedAssignments === 0 && totals.sandAssignments > 0)
  };
}

function atomicWrite(filePath, data, mode) {
  const temp = `${filePath}.cursor-sand-router-${process.pid}.tmp`;
  fs.writeFileSync(temp, data, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, filePath);
}

function readProduct(appRoot) {
  const productPath = path.join(appRoot, 'product.json');
  return {
    productPath,
    raw: fs.readFileSync(productPath),
    json: JSON.parse(fs.readFileSync(productPath, 'utf8'))
  };
}

function checksumKey(rel) {
  return rel.startsWith('out/') ? rel.slice('out/'.length) : null;
}

function includeExtensionHashChanges(root, changes) {
  const changedMains = [];
  for (const spec of sandStream.TARGET_SPECS) {
    if (!spec.ext) continue;
    const change = changes.find((item) => item.rel === spec.rel);
    if (change) changedMains.push({ ext: spec.ext, bytes: change.patched });
  }
  if (!changedMains.length) return;
  const extRel = sandStream.EXT_HOST_REL;
  const extAbs = path.join(root, extRel);
  if (!fs.existsSync(extAbs)) return;
  const existing = changes.find((item) => item.rel === extRel);
  const original = existing ? existing.original : fs.readFileSync(extAbs);
  const currentText = (existing ? existing.patched : original).toString('utf8');
  const hashed = sandStream.updateExtensionHashes(currentText, changedMains);
  if (!hashed.changed) return;
  const patched = Buffer.from(hashed.content, 'utf8');
  if (existing) {
    existing.patched = patched;
    return;
  }
  changes.push({
    rel: extRel,
    abs: extAbs,
    original,
    patched,
    replacements: 0,
    mode: fs.statSync(extAbs).mode & 0o777
  });
}

function writeProductChecksums(root, changes) {
  const product = readProduct(root);
  const nextProduct = JSON.parse(product.raw.toString('utf8'));
  nextProduct.checksums = nextProduct.checksums || {};
  for (const change of changes) {
    const key = checksumKey(change.rel);
    if (key && Object.prototype.hasOwnProperty.call(nextProduct.checksums, key)) {
      nextProduct.checksums[key] = vscodeChecksum(change.patched);
    }
  }
  const nextProductRaw = Buffer.from(`${JSON.stringify(nextProduct, null, '\t')}\n`, 'utf8');
  return {
    product,
    nextProductRaw,
    productChanged: !product.raw.equals(nextProductRaw)
  };
}

function restoreInPlace(root) {
  const changes = [];
  for (const { rel, abs } of scanCandidatePaths(root)) {
    const original = fs.readFileSync(abs);
    const result = uninstallAllPatches(original.toString('utf8'));
    if (result.text !== original.toString('utf8')) {
      changes.push({
        rel,
        abs,
        original,
        patched: Buffer.from(result.text, 'utf8'),
        replacements: result.replacements,
        mode: fs.statSync(abs).mode & 0o777
      });
    }
  }
  if (changes.length === 0) {
    const leftover = leftoverMarkers(root);
    if (leftover.length) {
      throw new Error(
        `发现补丁标记但未能拆掉：${leftover.map((item) => `${item.rel} (${item.markers.join(', ')})`).join('; ')}`
      );
    }
    return { changed: false, files: [], after: inspect(root) };
  }
  includeExtensionHashChanges(root, changes);
  const { product, nextProductRaw, productChanged } = writeProductChecksums(root, changes);
  for (const change of changes) {
    atomicWrite(change.abs, change.patched, change.mode);
  }
  if (productChanged) {
    atomicWrite(product.productPath, nextProductRaw, fs.statSync(product.productPath).mode & 0o777);
  }
  const leftover = leftoverMarkers(root);
  if (leftover.length) {
    throw new Error(
      `卸载后仍有补丁标记残留：${leftover.map((item) => `${item.rel} (${item.markers.join(', ')})`).join('; ')}`
    );
  }
  return {
    changed: true,
    files: changes.map((change) => change.rel),
    after: inspect(root)
  };
}

function applyPatchLocked({ appRoot, stateRoot, dryRun = false }) {
  const root = assertAppRoot(appRoot || defaultAppRoot());
  const before = inspect(root);
  const changes = [];

  for (const { rel, abs } of applyCandidatePaths(root)) {
    const original = fs.readFileSync(abs);
    const result = applyAllPatches(original.toString('utf8'));
    if (result.replacements > 0 && result.text !== original.toString('utf8')) {
      changes.push({
        rel,
        abs,
        original,
        patched: Buffer.from(result.text, 'utf8'),
        replacements: result.replacements,
        mode: fs.statSync(abs).mode & 0o777
      });
    }
  }

  if (changes.length === 0) {
    if (before.patched) {
      return { changed: false, reason: 'already-patched', before, after: before, backupDir: null };
    }
    throw new Error(
      `No supported Sand / ${HEADER} assignment was found. Cursor ${before.version} may need a new patch rule; no file was changed.`
    );
  }

  const replacementCount = changes.reduce((sum, change) => sum + change.replacements, 0);
  includeExtensionHashChanges(root, changes);
  const product = readProduct(root);
  const nextProduct = JSON.parse(product.raw.toString('utf8'));
  nextProduct.checksums = nextProduct.checksums || {};
  for (const change of changes) {
    const key = checksumKey(change.rel);
    if (key && Object.prototype.hasOwnProperty.call(nextProduct.checksums, key)) {
      nextProduct.checksums[key] = vscodeChecksum(change.patched);
    }
  }
  const nextProductRaw = Buffer.from(`${JSON.stringify(nextProduct, null, '\t')}\n`, 'utf8');
  const productChanged = !product.raw.equals(nextProductRaw);

  if (dryRun) {
    return {
      changed: true,
      dryRun: true,
      replacementCount,
      files: changes.map((change) => ({ rel: change.rel, replacements: change.replacements })),
      before,
      backupDir: null
    };
  }

  const backupDir = path.join(path.resolve(stateRoot), 'backups', `${utcStamp()}-cursor-${before.version}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const entries = [];
  for (const change of changes) {
    const backupPath = path.join(backupDir, change.rel);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, change.original);
    entries.push({
      rel: change.rel,
      backupRel: change.rel,
      originalSha256: sha256(change.original),
      patchedSha256: sha256(change.patched),
      replacements: change.replacements,
      mode: change.mode
    });
  }
  if (productChanged) {
    fs.writeFileSync(path.join(backupDir, 'product.json'), product.raw);
    entries.push({
      rel: 'product.json',
      backupRel: 'product.json',
      originalSha256: sha256(product.raw),
      patchedSha256: sha256(nextProductRaw),
      replacements: 0,
      mode: fs.statSync(product.productPath).mode & 0o777
    });
  }

  const manifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    appRoot: root,
    cursorVersion: before.version,
    header: HEADER,
    value: VALUE,
    entries
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const written = [];
  try {
    for (const change of changes) {
      atomicWrite(change.abs, change.patched, change.mode);
      written.push(change);
    }
    if (productChanged) {
      atomicWrite(product.productPath, nextProductRaw, fs.statSync(product.productPath).mode & 0o777);
    }
  } catch (error) {
    for (const change of written.reverse()) {
      atomicWrite(change.abs, change.original, change.mode);
    }
    if (productChanged && fs.existsSync(path.join(backupDir, 'product.json'))) {
      atomicWrite(product.productPath, product.raw, fs.statSync(product.productPath).mode & 0o777);
    }
    throw error;
  }

  const after = inspect(root);
  if (!after.patched && !after.streamPartial) {
    throw new Error('Patch write completed but post-write verification failed. Use restore before retrying.');
  }
  return {
    changed: true,
    dryRun: false,
    replacementCount,
    files: changes.map((change) => ({ rel: change.rel, replacements: change.replacements })),
    before,
    after,
    backupDir
  };
}

function applyPatch({ appRoot, stateRoot = defaultStateRoot(), dryRun = false } = {}) {
  return withOperationLock(stateRoot, () => applyPatchLocked({ appRoot, stateRoot, dryRun }));
}

function manifestPaths(stateRoot) {
  const backups = path.join(path.resolve(stateRoot), 'backups');
  if (!fs.existsSync(backups)) return [];
  return fs
    .readdirSync(backups, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backups, entry.name, 'manifest.json'))
    .filter((file) => fs.existsSync(file))
    .sort()
    .reverse();
}

function restoreLatestLocked({ appRoot, stateRoot, force = false }) {
  const root = assertAppRoot(appRoot || defaultAppRoot());
  const candidates = manifestPaths(stateRoot);
  const manifestPath = candidates.find((candidate) => {
    try {
      return path.resolve(JSON.parse(fs.readFileSync(candidate, 'utf8')).appRoot) === root;
    } catch {
      return false;
    }
  });
  if (!manifestPath) {
    const inPlace = restoreInPlace(root);
    if (!inPlace.changed) {
      throw new Error(`No backup manifest found for ${root}, and no Sand Stream / header patch to reverse`);
    }
    return { restored: inPlace.files, backupDir: null, after: inPlace.after, inPlace: true };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const backupDir = path.dirname(manifestPath);

  let backupRefuseReason = '';
  for (const entry of manifest.entries) {
    const target = path.join(root, entry.rel);
    if (!fs.existsSync(target)) {
      if (!force) {
        backupRefuseReason = `target is missing: ${entry.rel}`;
        break;
      }
      continue;
    }
    const currentHash = sha256(fs.readFileSync(target));
    if (!force && currentHash !== entry.patchedSha256) {
      backupRefuseReason = `${entry.rel} changed after the backup was taken`;
      break;
    }
  }

  if (backupRefuseReason && !force) {
    const inPlace = restoreInPlace(root);
    if (inPlace.changed) {
      return {
        restored: inPlace.files,
        backupDir,
        after: inPlace.after,
        inPlace: true,
        backupSkipped: backupRefuseReason
      };
    }
    throw new Error(
      `Refusing restore because ${backupRefuseReason}, and no Sand Stream / header patch to reverse in place.`
    );
  }

  const restored = [];
  for (const entry of manifest.entries) {
    const target = path.join(root, entry.rel);
    const backup = path.join(backupDir, entry.backupRel);
    if (!fs.existsSync(backup)) throw new Error(`Backup file missing: ${backup}`);
    const data = fs.readFileSync(backup);
    if (sha256(data) !== entry.originalSha256) {
      throw new Error(`Backup integrity check failed: ${backup}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicWrite(target, data, entry.mode || 0o644);
    restored.push(entry.rel);
  }
  const leftover = restoreInPlace(root);
  const markers = leftoverMarkers(root);
  if (markers.length) {
    throw new Error(
      `卸载后仍有补丁标记残留：${markers.map((item) => `${item.rel} (${item.markers.join(', ')})`).join('; ')}`
    );
  }
  return {
    restored: leftover.changed ? restored.concat(leftover.files) : restored,
    backupDir,
    after: leftover.after || inspect(root),
    inPlace: leftover.changed
  };
}

function restoreLatest({ appRoot, stateRoot = defaultStateRoot(), force = false } = {}) {
  return withOperationLock(stateRoot, () => restoreLatestLocked({ appRoot, stateRoot, force }));
}

function findLatestManifest(appRoot, stateRoot) {
  const root = path.resolve(appRoot);
  return manifestPaths(stateRoot).find((candidate) => {
    try {
      return path.resolve(JSON.parse(fs.readFileSync(candidate, 'utf8')).appRoot) === root;
    } catch {
      return false;
    }
  }) || null;
}

module.exports = {
  HEADER,
  VALUE,
  CANDIDATE_FILES,
  SCAN_FILES,
  LEGACY_HEADER_RELS,
  LEFTOVER_MARKERS,
  analyzeText,
  applyPatch,
  defaultAppRoot,
  defaultStateRoot,
  findLatestManifest,
  inspect,
  leftoverMarkers,
  patchText,
  restoreInPlace,
  restoreLatest,
  reverseUnmarkedClientSand,
  sha256,
  uninstallAllPatches,
  vscodeChecksum
};
