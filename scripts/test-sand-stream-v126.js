'use strict';
const assert = require('assert');
const sand = require('../src/sandStream');

const fixture =
  'try{return(yield o.checkFeatureGate(ae))?{runtime:"managed-local",reason:"eligible"}:{runtime:"connect",reason:"gate-off"}}catch(e)' +
  'let t=!1;try{t=await r.cursor.checkFeatureGate(Ds)}' +
  'p=await Promise.resolve(r.cursor.checkFeatureGate(Us)).catch(()=>!1)' +
  'hasUnsupportedRunOptions:void 0!==e.runOptions.customSystemPrompt||void 0!==e.runOptions.harness||!0===e.runOptions.excludeWorkspaceContext||void 0!==e.runOptions.subagentTypeName||void 0!==e.runOptions.parentAgentToolCallId||!0===e.runOptions.directMetaParentChildSubagent' +
  'return"userMessageAction"!==e.actionCase?"action-not-supported":e.requestedMode!==oe.xyI.AGENT?"mode-not-supported":e.simulatedUserMessage?"simulated-message-not-supported":void 0===e.modelId?"model-not-supported":e.hasModelCredentials?"private-model-not-supported":e.hasUnsupportedRunOptions?"run-options-not-supported":void 0' +
  'e.resumeAgentId&&e.mode===Mn.FL.UNSPECIFIED&&!e.readonly?oe.xyI.UNSPECIFIED:' +
  'x.source==="interactive-child"||x.payload.notificationContext==="user_driven_interactive_child"' +
  'y.source==="interactive-child"||y.payload.notificationContext==="user_driven_interactive_child"' +
  'const Cre={enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0,enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0,nalLoopDetection:!0};' +
  'isGenerateImageModelRestricted:!1,taskToolProps:void 0},resolvers:' +
  'clientIdentity:{clientType:"ide"}' +
  'function hre(e){return t=>{return n=this,o=void 0,s=function*(){' +
  'this._agentHostEnabled=gate,' +
  '$4i="[push_req_context]",Ykd=1e4';

const applied = sand.applySandPatches(fixture);
const d = sand.detectSand(applied.content);
assert.ok(sand.streamModeInstalled(d), JSON.stringify(d, null, 2));
assert.ok(sand.CLIENT_SUBAGENT_ENABLED, 'default must keep client subagent on');
assert.ok(sand.streamLifecycleInstalled(d), JSON.stringify(d, null, 2));
assert.strictEqual(d.subagentRoute, 1);
assert.strictEqual(d.subagentSession, 1);
assert.strictEqual(d.taskTool, 1);
assert.strictEqual(d.actionRoute, 1);
assert.strictEqual(d.resumeMode, 1);
assert.strictEqual(d.completionWake, 2);
assert.strictEqual(d.pushContextTimeout, 1);
assert.ok(applied.content.includes('Ykd=200/*SAND_PUSH_CONTEXT_TIMEOUT_V1*/'));
const from500 = sand.applySandPatches(
  fixture.replace('Ykd=1e4', 'Ykd=500/*SAND_PUSH_CONTEXT_TIMEOUT_V1*/')
);
assert.ok(from500.content.includes('Ykd=200/*SAND_PUSH_CONTEXT_TIMEOUT_V1*/'));
assert.ok(!from500.content.includes('Ykd=500/*SAND_PUSH_CONTEXT_TIMEOUT_V1*/'));

const removed = sand.removeSandPatches(applied.content);
assert.strictEqual(removed.content, fixture, 'apply/remove should be reversible');

const v125 = sand.managedTaskToolPatchedV125();
const unmigrated = sand.removeSandPatches(v125);
assert.ok(unmigrated.content.includes('taskToolProps:void 0},resolvers:'));
assert.ok(!unmigrated.content.includes('SAND_MANAGED_TASK_TOOL'));

console.log('sand stream lifecycle + timeout patches ok');
