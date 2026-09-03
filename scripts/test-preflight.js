'use strict';

// 预检：完整注入后 lifecycleShortfall 必须为空；缺任何一条生命周期补丁必须被 lifecycleShortfall 抓到。
// 再用 dryRun 把整套补丁打到 _unpack-3.18.9 内存副本上，确认真实 3.18.9 能完整命中、不被拒。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sand = require('../src/sandStream');
const patcher = require('../src/sandPatcher');

const UNPACK = path.join(
  __dirname,
  '..',
  '..',
  'cursor插件开发',
  '_unpack-3.18.9',
  'Cursor.app',
  'Contents',
  'Resources',
  'app'
);

// 1) 直接对真实目标文件套用补丁，汇总标记，断言 shortfall 为空。
let totals = null;
for (const spec of sand.TARGET_SPECS) {
  const abs = path.join(UNPACK, spec.rel);
  if (!fs.existsSync(abs)) continue;
  const patched = sand.applySandPatches(fs.readFileSync(abs, 'utf8')).content;
  const d = sand.detectSand(patched);
  totals = totals ? merge(totals, d) : d;
}
assert.ok(totals, 'no target files found under unpack fixture');
assert.ok(sand.lifecycleAttempted(totals), 'expected a stream inject on 3.18.9');
const shortfall = sand.lifecycleShortfall(totals);
assert.strictEqual(shortfall.length, 0, 'unexpected shortfall on clean 3.18.9: ' + JSON.stringify(shortfall));
assert.ok(sand.CLIENT_SUBAGENT_ENABLED, 'default build must keep client subagent on');
assert.ok(sand.streamModeInstalled(totals), 'streamModeInstalled should be true after apply');
assert.ok(sand.streamLifecycleInstalled(totals), 'full subagent lifecycle must install');
assert.ok((totals.pushContextTimeout || 0) >= 2, 'desktop+glass must each get push_req_context timeout');
assert.ok((totals.actionRoute || 0) >= 1, 'action route must install');
assert.ok((totals.taskTool || 0) >= 1, 'task tool must install');

// 2) 抠掉核心路由（模拟 657.js 没命中）→ 必须被抓出来。
const crippled = { ...totals, managedLocal: 0 };
const s2 = sand.lifecycleShortfall(crippled);
assert.ok(
  s2.some((item) => item.key === 'managedLocal' && item.have === 0 && item.want === 1),
  'shortfall must flag a missing managedLocal'
);

// 3.5) 657/675 注入后往返可逆。
const j657 = path.join(UNPACK, 'extensions', 'cursor-agent-host', 'dist', '657.js');
const orig657 = fs.readFileSync(j657, 'utf8');
const patched657 = sand.applySandPatches(orig657).content;
const restored657 = sand.removeSandPatches(patched657).content;
assert.strictEqual(restored657, orig657, 'apply→remove must restore 657.js byte-for-byte');

const j675 = path.join(UNPACK, 'extensions', 'cursor-agent-host', 'dist', '675.js');
const orig675 = fs.readFileSync(j675, 'utf8');
const patched675 = sand.applySandPatches(orig675).content;
assert.ok(patched675.includes('/*SAND_DIRECT_INFERENCE_STREAM_V1*/'), 'direct stream must still inject');
const restored675 = sand.removeSandPatches(patched675).content;
assert.strictEqual(restored675, orig675, 'apply→remove must restore 675.js byte-for-byte');

// 3.7) push_req_context 超时：desktop+glass 各 1 处 1e4→200，结构正则不绑死压缩名，往返可逆。
const timeoutFiles = [
  path.join(UNPACK, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
  path.join(UNPACK, 'out', 'vs', 'workbench', 'workbench.glass.main.js'),
];
for (const abs of timeoutFiles) {
  const orig = fs.readFileSync(abs, 'utf8');
  assert.strictEqual(
    sand.countUnpatchedPushContextTimeout(orig),
    1,
    'expected one unpatched 10s push_req_context timeout in ' + path.basename(abs)
  );
  const patched = sand.applySandPatches(orig).content;
  assert.ok(patched.includes(sand.SAND_PUSH_CONTEXT_TIMEOUT_MARKER), 'timeout marker missing in ' + path.basename(abs));
  assert.strictEqual(sand.countUnpatchedPushContextTimeout(patched), 0, '10s timeout leftover in ' + path.basename(abs));
  assert.ok(/\[push_req_context\]",[A-Za-z_$][\w$]*=200/.test(patched), 'timeout must become 200ms');
  const restored = sand.removeSandPatches(patched).content;
  assert.strictEqual(restored, orig, 'apply→remove must restore timeout in ' + path.basename(abs));
}

// 4) dryRun 全量注入真实 3.18.9：预检应放行（changed:true，不抛错）。
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-preflight-'));
try {
  const result = patcher.applyPatch({ appRoot: UNPACK, stateRoot, dryRun: true });
  assert.strictEqual(result.changed, true, 'dryRun should report changes on clean fixture');
  assert.strictEqual(result.dryRun, true);
} finally {
  fs.rmSync(stateRoot, { recursive: true, force: true });
}

function merge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] || 0) + b[k];
  return out;
}

console.log('preflight guard ok');
