'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HEADER = 'x-cursor-client-type';
const VALUE = 'sand';

const CANDIDATE_FILES = [
  'out/main.js',
  'out/vs/workbench/workbench.desktop.main.js',
  'out/vs/workbench/api/node/extensionHostProcess.js',
  'out/vs/workbench/api/worker/extensionHostWorkerMain.js'
];

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
  return {
    headerMentions: countMatches(text, /x-cursor-client-type/g),
    unpatchedAssignments: countMatches(text, defaultSetter) + countMatches(text, ideSetter) + countMatches(text, ideObject),
    sandAssignments: countMatches(text, sandSetter) + countMatches(text, sandObject)
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

function activeCandidatePaths(appRoot) {
  return CANDIDATE_FILES
    .map((rel) => ({ rel, abs: path.join(appRoot, rel) }))
    .filter(({ abs }) => fs.existsSync(abs) && fs.statSync(abs).isFile());
}

function inspect(appRoot) {
  const root = assertAppRoot(appRoot);
  const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
  const files = activeCandidatePaths(root).map(({ rel, abs }) => {
    const data = fs.readFileSync(abs);
    const analysis = analyzeText(data.toString('utf8'));
    return { rel, sha256: sha256(data), ...analysis };
  });
  const totals = files.reduce(
    (acc, file) => {
      acc.headerMentions += file.headerMentions;
      acc.unpatchedAssignments += file.unpatchedAssignments;
      acc.sandAssignments += file.sandAssignments;
      return acc;
    },
    { headerMentions: 0, unpatchedAssignments: 0, sandAssignments: 0 }
  );
  return {
    appRoot: root,
    version: product.version || 'unknown',
    files,
    totals,
    patched: totals.sandAssignments > 0 && totals.unpatchedAssignments === 0
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

function applyPatchLocked({ appRoot, stateRoot, dryRun = false }) {
  const root = assertAppRoot(appRoot || defaultAppRoot());
  const before = inspect(root);
  const changes = [];

  for (const { rel, abs } of activeCandidatePaths(root)) {
    const original = fs.readFileSync(abs);
    const result = patchText(original.toString('utf8'));
    if (result.replacements > 0) {
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
      `No supported ${HEADER} assignment was found. Cursor ${before.version} may need a new patch rule; no file was changed.`
    );
  }

  const replacementCount = changes.reduce((sum, change) => sum + change.replacements, 0);
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
    schemaVersion: 1,
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
  if (!after.patched) {
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
  if (!manifestPath) throw new Error(`No backup manifest found for ${root}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const backupDir = path.dirname(manifestPath);

  for (const entry of manifest.entries) {
    const target = path.join(root, entry.rel);
    if (!fs.existsSync(target)) {
      if (!force) throw new Error(`Refusing restore: target is missing: ${target}`);
      continue;
    }
    const currentHash = sha256(fs.readFileSync(target));
    if (!force && currentHash !== entry.patchedSha256) {
      throw new Error(
        `Refusing restore because ${entry.rel} changed after patching. ` +
          `Expected ${entry.patchedSha256}, got ${currentHash}.`
      );
    }
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
  return { restored, backupDir, after: inspect(root) };
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
  analyzeText,
  applyPatch,
  defaultAppRoot,
  defaultStateRoot,
  findLatestManifest,
  inspect,
  patchText,
  restoreLatest,
  sha256,
  vscodeChecksum
};
