'use strict';

// 用每个已发布 tag 的注入逻辑打到 _unpack-3.18.9 的内存副本上，
// 再用当前源码卸载，确认从 2.1.0 起都能卸干净。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const current = require('../src/sandPatcher');

const REPO = path.join(__dirname, '..');
const UNPACK = path.join(
  REPO,
  '..',
  'cursor插件开发',
  '_unpack-3.18.9',
  'Cursor.app',
  'Contents',
  'Resources',
  'app'
);

function gitShow(tag, file) {
  return execSync(`git show ${tag}:${file}`, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function extractTag(tag, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'sandPatcher.js'), gitShow(tag, 'src/sandPatcher.js'));
  try {
    fs.writeFileSync(path.join(dest, 'sandStream.js'), gitShow(tag, 'src/sandStream.js'));
  } catch {
    // 2.1.0–2.2.9 没有 sandStream
  }
}

function leftoverIn(text) {
  return current.LEFTOVER_MARKERS.filter((marker) => text.includes(marker));
}

function sandLeft(text) {
  return current.analyzeText(text).sandAssignments;
}

function applyLegacyHeader(oldPatcher, text) {
  return oldPatcher.patchText(text).text;
}

function applyReleasedStream(tagDir, text) {
  const oldPatcher = require(path.join(tagDir, 'sandPatcher.js'));
  const oldStream = require(path.join(tagDir, 'sandStream.js'));
  const streamed = oldStream.applySandPatches(text);
  return oldPatcher.patchText(streamed.content).text;
}

function assertClean(label, original, applied, removed) {
  const marks = leftoverIn(removed);
  const sand = sandLeft(removed);
  if (applied === original) {
    throw new Error(`${label}: old inject made no change (fixture mismatch)`);
  }
  if (marks.length) {
    throw new Error(`${label}: leftover markers ${marks.join(', ')}`);
  }
  if (sand > 0) {
    throw new Error(`${label}: still has ${sand} unmarked sand header(s)`);
  }
}

function filesFor(rels) {
  return rels
    .map((rel) => ({ rel, abs: path.join(UNPACK, rel) }))
    .filter((item) => fs.existsSync(item.abs) && fs.statSync(item.abs).isFile());
}

function runFamily(label, rels, applyFn) {
  const files = filesFor(rels);
  if (!files.length) throw new Error(`${label}: no fixture files under ${UNPACK}`);
  let touched = 0;
  for (const file of files) {
    const original = fs.readFileSync(file.abs, 'utf8');
    const applied = applyFn(original);
    if (applied === original) continue;
    touched += 1;
    const removed = current.uninstallAllPatches(applied).text;
    assertClean(`${label} ${file.rel}`, original, applied, removed);
  }
  if (!touched) throw new Error(`${label}: inject touched 0 files`);
  return { files: files.length, touched };
}

if (!fs.existsSync(path.join(UNPACK, 'product.json'))) {
  throw new Error(`unpack fixture missing: ${UNPACK}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-release-uninstall-'));
extractTag('v2.1.0', path.join(tmp, 'v210'));
extractTag('v2.3.1', path.join(tmp, 'v231'));

const v210 = require(path.join(tmp, 'v210', 'sandPatcher.js'));
const v231Dir = path.join(tmp, 'v231');

const results = {
  v210: runFamily('v2.1.0 header', v210.CANDIDATE_FILES, (text) => applyLegacyHeader(v210, text)),
  v231: runFamily('v2.3.1 stream+header', require(path.join(v231Dir, 'sandStream.js')).TARGET_SPECS.map((s) => s.rel), (text) =>
    applyReleasedStream(v231Dir, text)
  ),
  current: runFamily('current 2.3.2', current.CANDIDATE_FILES, (text) => {
    const streamed = require('../src/sandStream').applySandPatches(text);
    return current.patchText(streamed.content).text;
  })
};

const staleRoot = path.join(tmp, 'stale-app');
fs.mkdirSync(path.join(staleRoot, 'out'), { recursive: true });
const fixture = 'header.set("x-cursor-client-type", envType ?? "ide"); extra={"x-cursor-client-type":"ide"};';
fs.writeFileSync(path.join(staleRoot, 'out', 'main.js'), fixture);
fs.writeFileSync(
  path.join(staleRoot, 'product.json'),
  `${JSON.stringify({ version: '3.18.9-test', checksums: {} }, null, '\t')}\n`
);
const injected = applyLegacyHeader(v210, fixture);
fs.writeFileSync(path.join(staleRoot, 'out', 'main.js'), injected);
const stateRoot = path.join(tmp, 'stale-state');
const backupDir = path.join(stateRoot, 'backups', 'old-release');
fs.mkdirSync(path.join(backupDir, 'out'), { recursive: true });
fs.writeFileSync(path.join(backupDir, 'out', 'main.js'), fixture);
fs.writeFileSync(
  path.join(backupDir, 'manifest.json'),
  `${JSON.stringify({
    schemaVersion: 2,
    appRoot: staleRoot,
    cursorVersion: '3.18.9-test',
    entries: [
      {
        rel: 'out/main.js',
        backupRel: 'out/main.js',
        originalSha256: current.sha256(Buffer.from(fixture)),
        patchedSha256: '0'.repeat(64),
        replacements: 1,
        mode: 0o644
      }
    ]
  }, null, 2)}\n`
);

const restored = current.restoreLatest({ appRoot: staleRoot, stateRoot, force: false });
if (!restored.inPlace || !restored.backupSkipped) {
  throw new Error(`stale backup should fall back to in-place, got ${JSON.stringify(restored)}`);
}
const afterStale = fs.readFileSync(path.join(staleRoot, 'out', 'main.js'), 'utf8');
if (sandLeft(afterStale) > 0 || leftoverIn(afterStale).length) {
  throw new Error(`stale backup in-place left sand/markers: ${afterStale}`);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, unpack: UNPACK, results, staleBackupFallback: restored.backupSkipped }, null, 2));
