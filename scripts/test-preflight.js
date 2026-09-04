'use strict';

// 预检：自动发现 _unpack-* 夹具，分别跑完整注入 + 往返可逆 + dryRun 不被拒。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sand = require('../src/sandStream');
const patcher = require('../src/sandPatcher');

const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'cursor插件开发');
const FIXTURES = fs.existsSync(FIXTURE_ROOT)
  ? fs.readdirSync(FIXTURE_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('_unpack-'))
      .map((d) => ({ label: d.name.replace('_unpack-', ''), rel: d.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  : [];
assert.ok(FIXTURES.length > 0, 'no _unpack-* fixtures found under ' + FIXTURE_ROOT);

function merge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] || 0) + b[k];
  return out;
}

for (const fixture of FIXTURES) {
  const UNPACK = path.join(__dirname, '..', '..', 'cursor插件开发', fixture.rel, 'Cursor.app', 'Contents', 'Resources', 'app');
  if (!fs.existsSync(path.join(UNPACK, 'product.json'))) {
    console.log(`skip ${fixture.label}: fixture not found`);
    continue;
  }

  let totals = null;
  for (const spec of sand.TARGET_SPECS) {
    const abs = path.join(UNPACK, spec.rel);
    if (!fs.existsSync(abs)) continue;
    const patched = sand.applySandPatches(fs.readFileSync(abs, 'utf8')).content;
    const d = sand.detectSand(patched);
    totals = totals ? merge(totals, d) : d;
  }
  assert.ok(totals, `${fixture.label}: no target files`);
  assert.ok(sand.lifecycleAttempted(totals), `${fixture.label}: expected stream inject`);
  const shortfall = sand.lifecycleShortfall(totals);
  assert.strictEqual(shortfall.length, 0, `${fixture.label}: shortfall: ${JSON.stringify(shortfall)}`);
  assert.ok(sand.CLIENT_SUBAGENT_ENABLED, `${fixture.label}: subagent must be on`);
  assert.ok(sand.streamModeInstalled(totals), `${fixture.label}: streamMode`);
  assert.ok(sand.streamLifecycleInstalled(totals), `${fixture.label}: lifecycle`);
  assert.ok((totals.pushContextTimeout || 0) >= 2, `${fixture.label}: timeout count`);
  assert.ok((totals.actionRoute || 0) >= 1, `${fixture.label}: actionRoute`);
  assert.ok((totals.taskTool || 0) >= 1, `${fixture.label}: taskTool`);

  // shortfall detection
  const crippled = { ...totals, managedLocal: 0 };
  assert.ok(
    sand.lifecycleShortfall(crippled).some((i) => i.key === 'managedLocal'),
    `${fixture.label}: shortfall must flag managedLocal`
  );

  // per-file roundtrip
  for (const spec of sand.TARGET_SPECS) {
    const abs = path.join(UNPACK, spec.rel);
    if (!fs.existsSync(abs)) continue;
    const orig = fs.readFileSync(abs, 'utf8');
    const patched = sand.applySandPatches(orig).content;
    const restored = sand.removeSandPatches(patched).content;
    assert.strictEqual(restored, orig, `${fixture.label}: roundtrip failed for ${spec.rel}`);
  }

  // timeout roundtrip
  for (const name of ['workbench.desktop.main.js', 'workbench.glass.main.js']) {
    const abs = path.join(UNPACK, 'out', 'vs', 'workbench', name);
    const orig = fs.readFileSync(abs, 'utf8');
    assert.strictEqual(sand.countUnpatchedPushContextTimeout(orig), 1, `${fixture.label}: ${name} timeout`);
    const patched = sand.applySandPatches(orig).content;
    assert.ok(patched.includes(sand.SAND_PUSH_CONTEXT_TIMEOUT_MARKER), `${fixture.label}: ${name} marker`);
    assert.ok(/\[push_req_context\]",[A-Za-z_$][\w$]*=50/.test(patched), `${fixture.label}: ${name} 50ms`);
  }

  // dryRun
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-preflight-'));
  try {
    const result = patcher.applyPatch({ appRoot: UNPACK, stateRoot, dryRun: true });
    assert.strictEqual(result.changed, true, `${fixture.label}: dryRun`);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }

  console.log(`preflight ${fixture.label} ok`);
}

console.log('preflight guard ok');
