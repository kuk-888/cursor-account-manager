// Sand Stream 补丁（对齐 sand_stream_installer 1.2.6-subagent-lifecycle-fixed / Cursor 3.18.9）
// 注入与卸载都走同一套标记，兼容该脚本装过的客户端。
const crypto = require("crypto");
const path = require("path");

// 默认打满子代理生命周期（Task / action / resume / 后台唤醒）。CAM_NO_SUBAGENT=1 才打精简对照包。
const CLIENT_SUBAGENT_ENABLED = true;
const SUBAGENT_LIFECYCLE_KEYS = [
  "subagentRoute",
  "subagentSession",
  "taskTool",
  "actionRoute",
  "resumeMode",
  "completionWake"
];

const SAND_CLIENT_MARKER = "/*SAND_CLIENT_MODE_V1*/";
const SAND_CLIENT_EXISTING_MARKER = "/*SAND_CLIENT_EXISTING_V1*/";
const SAND_ELIGIBILITY_MARKER = "/*SAND_ELIGIBILITY_MODE_V1*/";
const SAND_MANAGED_LOCAL_ROUTE_MARKER = "/*SAND_MANAGED_LOCAL_ROUTE_V1*/";
const SAND_DIRECT_STREAM_MARKER = "/*SAND_DIRECT_INFERENCE_STREAM_V1*/";
const SAND_AGENT_HOST_ENABLEMENT_MARKER = "/*SAND_AGENT_HOST_ENABLEMENT_V1*/";
const SAND_LOCAL_RUNTIME_LOAD_MARKER = "/*SAND_LOCAL_RUNTIME_LOAD_V1*/";
const SAND_AGENT_HOST_MOVE_EXEC_MARKER = "/*SAND_AGENT_HOST_MOVE_EXEC_V1*/";
const SAND_AGENT_HOST_IDENTITY_MARKER = "/*SAND_AGENT_HOST_IDENTITY_V1*/";
const SAND_MANAGED_SUBAGENT_ROUTE_MARKER = "/*SAND_MANAGED_SUBAGENT_ROUTE_V1*/";
const SAND_MANAGED_SUBAGENT_SESSION_MARKER = "/*SAND_MANAGED_SUBAGENT_SESSION_V1*/";
const SAND_MANAGED_TASK_TOOL_MARKER = "/*SAND_MANAGED_TASK_TOOL_V2*/";
const LEGACY_SAND_MANAGED_TASK_TOOL_MARKER = "/*SAND_MANAGED_TASK_TOOL_V1*/";
const SAND_MANAGED_ACTION_ROUTE_MARKER = "/*SAND_MANAGED_ACTION_ROUTE_V1*/";
const SAND_SUBAGENT_RESUME_MODE_MARKER = "/*SAND_SUBAGENT_RESUME_AGENT_MODE_V1*/";
const SAND_SUBAGENT_COMPLETION_WAKE_MARKER = "/*SAND_SUBAGENT_COMPLETION_WAKE_V1*/";
const SAND_PUSH_CONTEXT_TIMEOUT_MARKER = "/*SAND_PUSH_CONTEXT_TIMEOUT_V1*/";
const LEGACY_SAND_CLIENT_MARKER = "/*KC_SAND_CLIENT_V1*/";
const LEGACY_SAND_ELIGIBILITY_MARKER = "/*KC_SAND_ELIGIBILITY_V1*/";

const CLIENT_MARKER_GUARD = /\/\*[A-Z0-9_]*SAND_CLIENT(?:_(?:MODE|EXISTING))?_V1\*\//;
const ELIGIBILITY_MARKER_RE = /return!1;\/\*[A-Z0-9_]*SAND_ELIGIBILITY(?:_MODE)?_V1\*\//g;

const TARGET_SPECS = [
  { rel: path.join("out", "main.js") },
  { rel: path.join("out", "vs", "workbench", "api", "worker", "extensionHostWorkerMain.js") },
  { rel: path.join("out", "vs", "workbench", "api", "node", "extensionHostProcess.js") },
  { rel: path.join("out", "vs", "workbench", "workbench.glass.main.js") },
  { rel: path.join("out", "vs", "workbench", "workbench.desktop.main.js") },
  { rel: path.join("extensions", "cursor-always-local", "dist", "main.js"), ext: "cursor-always-local" },
  { rel: path.join("extensions", "cursor-local-agent-runtime", "dist", "main.js"), ext: "cursor-local-agent-runtime" },
  { rel: path.join("extensions", "cursor-agent-host", "dist", "main.js"), ext: "cursor-agent-host" },
  { rel: path.join("extensions", "cursor-agent-exec", "dist", "main.js"), ext: "cursor-agent-exec" },
  { rel: path.join("extensions", "cursor-agent-host", "dist", "657.js") },
  { rel: path.join("extensions", "cursor-agent-host", "dist", "675.js") },
];

const EXT_HOST_REL = path.join("out", "vs", "workbench", "api", "node", "extensionHostProcess.js");
const PRODUCT_REL = "product.json";

const ELIGIBILITY_PREFIXES = [
  "function r4g(e){const{adminSettingsService:t",
  "function Vj_(t){const{adminSettingsService:e",
  "function inf(e){const{adminSettingsService:t",
  "function HSy(t){const{adminSettingsService:e",
  "function Q_f(e){const{adminSettingsService:t",
  "function BpS(t){const{adminSettingsService:e",
];

const MANAGED_LOCAL_ROUTE_ORIGINAL =
  'try{return(yield o.checkFeatureGate(ae))?{runtime:"managed-local",reason:"eligible"}:{runtime:"connect",reason:"gate-off"}}catch(e)';
const MANAGED_LOCAL_ROUTE_PATCHED =
  "try{return" + SAND_MANAGED_LOCAL_ROUTE_MARKER + '{runtime:"managed-local",reason:"sand-client"}}catch(e)';

const LOCAL_RUNTIME_LOAD_ORIGINAL = "let t=!1;try{t=await r.cursor.checkFeatureGate(Ds)}";
const LOCAL_RUNTIME_LOAD_PATCHED = "let t=!0;" + SAND_LOCAL_RUNTIME_LOAD_MARKER + "try{t=!0}";

const AGENT_HOST_MOVE_EXEC_ORIGINAL =
  "p=await Promise.resolve(r.cursor.checkFeatureGate(Us)).catch(()=>!1)";
const AGENT_HOST_MOVE_EXEC_PATCHED = "p=!0" + SAND_AGENT_HOST_MOVE_EXEC_MARKER;

const AGENT_HOST_IDENTITY_ORIGINAL = 'clientIdentity:{clientType:"ide"}';
const AGENT_HOST_IDENTITY_PATCHED =
  'clientIdentity:{clientType:"sand"' + SAND_AGENT_HOST_IDENTITY_MARKER + "}";

const MANAGED_SUBAGENT_ROUTE_ORIGINAL =
  "hasUnsupportedRunOptions:void 0!==e.runOptions.customSystemPrompt||" +
  "void 0!==e.runOptions.harness||" +
  "!0===e.runOptions.excludeWorkspaceContext||" +
  "void 0!==e.runOptions.subagentTypeName||" +
  "void 0!==e.runOptions.parentAgentToolCallId||" +
  "!0===e.runOptions.directMetaParentChildSubagent";
const MANAGED_SUBAGENT_ROUTE_PATCHED =
  "hasUnsupportedRunOptions:void 0!==e.runOptions.customSystemPrompt||" +
  "void 0!==e.runOptions.harness||" +
  "!0===e.runOptions.excludeWorkspaceContext" +
  SAND_MANAGED_SUBAGENT_ROUTE_MARKER +
  "||!0===e.runOptions.directMetaParentChildSubagent";

const MANAGED_ACTION_ROUTE_ORIGINAL =
  'return"userMessageAction"!==e.actionCase?"action-not-supported":' +
  "e.requestedMode!==oe.xyI.AGENT?\"mode-not-supported\":" +
  'e.simulatedUserMessage?"simulated-message-not-supported":' +
  'void 0===e.modelId?"model-not-supported":' +
  'e.hasModelCredentials?"private-model-not-supported":' +
  'e.hasUnsupportedRunOptions?"run-options-not-supported":void 0';
const MANAGED_ACTION_ROUTE_PATCHED =
  "return" +
  SAND_MANAGED_ACTION_ROUTE_MARKER +
  '!["userMessageAction","summarizeAction","resumeAction",' +
  '"backgroundTaskCompletionAction"].includes(e.actionCase)?' +
  '"action-not-supported":' +
  '"userMessageAction"===e.actionCase&&' +
  'e.requestedMode!==oe.xyI.AGENT?"mode-not-supported":' +
  '"userMessageAction"===e.actionCase&&' +
  'e.simulatedUserMessage?"simulated-message-not-supported":' +
  'void 0===e.modelId?"model-not-supported":' +
  'e.hasModelCredentials?"private-model-not-supported":' +
  'e.hasUnsupportedRunOptions?"run-options-not-supported":void 0';

const SUBAGENT_RESUME_MODE_ORIGINAL =
  "e.resumeAgentId&&e.mode===Mn.FL.UNSPECIFIED&&!e.readonly?" +
  "oe.xyI.UNSPECIFIED:";
const SUBAGENT_RESUME_MODE_PATCHED =
  "e.resumeAgentId&&e.mode===Mn.FL.UNSPECIFIED&&!e.readonly?" +
  SAND_SUBAGENT_RESUME_MODE_MARKER +
  "oe.xyI.AGENT:";

const SUBAGENT_COMPLETION_WAKE_RE =
  /([A-Za-z_$][A-Za-z0-9_$]*)\.source==="interactive-child"\|\|\1\.payload\.notificationContext==="user_driven_interactive_child"/g;
const SUBAGENT_COMPLETION_WAKE_PATCH_RE = new RegExp(
  "([A-Za-z_$][A-Za-z0-9_$]*)\\.source===\"subagent\"" +
    SAND_SUBAGENT_COMPLETION_WAKE_MARKER.replace(/[/*]/g, "\\$&") +
    "\\|\\|\\1\\.source===\"interactive-child\"\\|\\|\\1\\.payload\\.notificationContext===\"user_driven_interactive_child\"",
  "g"
);

const MANAGED_SUBAGENT_SESSION_ORIGINAL =
  "const Cre={enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0," +
  "enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0," +
  "nalLoopDetection:!0};";
const MANAGED_SUBAGENT_SESSION_PATCHED =
  "const Cre={enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0," +
  "enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0," +
  "nalLoopDetection:!0,useClientSideSubagent:!0" +
  SAND_MANAGED_SUBAGENT_SESSION_MARKER +
  "};";

const MANAGED_TASK_TOOL_ORIGINAL =
  "isGenerateImageModelRestricted:!1,taskToolProps:void 0},resolvers:";

const DIRECT_STREAM_ANCHOR =
  "function hre(e){return t=>{return n=this,o=void 0,s=function*(){";

// push_req_context 超时：缓存未命中时 getPushedRulesProto 最多等 1e4ms（10s），
// 走 Bot 时常等满。改成 200ms。标识符随压缩名变（3.18.9=Ykd/v$p，3.18.25=yCd/pWp），只锁字段形状。
const PUSH_CONTEXT_TIMEOUT_MS = 200;
const PUSH_CONTEXT_TIMEOUT_ORIGINAL_RE =
  /("\[push_req_context\]",)([A-Za-z_$][\w$]*)=1e4/g;
const PUSH_CONTEXT_TIMEOUT_PATCHED_RE = new RegExp(
  '("\\[push_req_context\\]",)([A-Za-z_$][\\w$]*)=(?:200|500)' +
    SAND_PUSH_CONTEXT_TIMEOUT_MARKER.replace(/[/*]/g, "\\$&"),
  "g"
);

function countUnpatchedPushContextTimeout(content) {
  return (content.match(/("\[push_req_context\]",)([A-Za-z_$][\w$]*)=1e4/g) || []).length;
}

function applyPushContextTimeout(content, stats) {
  return content.replace(PUSH_CONTEXT_TIMEOUT_PATCHED_RE, (full, prefix, ident) => {
    const next = prefix + ident + "=" + PUSH_CONTEXT_TIMEOUT_MS + SAND_PUSH_CONTEXT_TIMEOUT_MARKER;
    if (next !== full) stats.push_context_timeout += 1;
    return next;
  }).replace(PUSH_CONTEXT_TIMEOUT_ORIGINAL_RE, (full, prefix, ident) => {
    stats.push_context_timeout += 1;
    return prefix + ident + "=" + PUSH_CONTEXT_TIMEOUT_MS + SAND_PUSH_CONTEXT_TIMEOUT_MARKER;
  });
}

function removePushContextTimeout(content, stats) {
  return content.replace(PUSH_CONTEXT_TIMEOUT_PATCHED_RE, (full, prefix, ident) => {
    stats.push_context_timeout += 1;
    return prefix + ident + "=1e4";
  });
}

const AGENT_HOST_ENABLEMENT_RE = /(this\._agentHostEnabled=)([A-Za-z_$][A-Za-z0-9_$]*)(,)/;
const AGENT_HOST_ENABLEMENT_PATCH_RE = new RegExp(
  "([A-Za-z_$][A-Za-z0-9_$]*)=!0;" +
    SAND_AGENT_HOST_ENABLEMENT_MARKER.replace(/[/*]/g, "\\$&") +
    "(this\\._agentHostEnabled=)\\1(,)",
  "g"
);

function emptyStats() {
  return {
    is_glass: 0,
    object_header: 0,
    set_header: 0,
    eligibility: 0,
    adopted_sand: 0,
    migrated_client: 0,
    migrated_eligibility: 0,
    managed_local_route: 0,
    local_runtime_load: 0,
    agent_host_move_exec: 0,
    direct_stream: 0,
    agent_host_enablement: 0,
    agent_host_identity: 0,
    managed_subagent_route: 0,
    managed_subagent_session: 0,
    managed_task_tool: 0,
    migrated_task_tool: 0,
    managed_action_route: 0,
    subagent_resume_mode: 0,
    subagent_completion_wake: 0,
    push_context_timeout: 0,
  };
}

function sumStats(s) {
  return (
    s.is_glass +
    s.object_header +
    s.set_header +
    s.eligibility +
    s.migrated_client +
    s.migrated_eligibility +
    s.managed_local_route +
    s.local_runtime_load +
    s.agent_host_move_exec +
    s.direct_stream +
    s.agent_host_enablement +
    s.agent_host_identity +
    s.managed_subagent_route +
    s.managed_subagent_session +
    s.managed_task_tool +
    s.migrated_task_tool +
    s.managed_action_route +
    s.subagent_resume_mode +
    s.subagent_completion_wake +
    s.push_context_timeout
  );
}

function managedTaskToolProps(customSubagentNormalizer, marker, modelCatalog) {
  return (
    "{" +
    marker +
    "parentRequestedModelName:i," +
    "parentModelParameters:e.requestedModel.parameters," +
    "parentMaxMode:l," +
    "isModelBlocked:()=>!1," +
    "isModelValid:e=>e===i," +
    "requiresMaxMode:()=>!1," +
    "compareModelCosts:()=>0," +
    'subagentModelForcePolicy:"none",' +
    "requireServerSideSubagent:!1," +
    "subagentModels:{modelsBySlug:" +
    modelCatalog +
    "}," +
    "normalizeCustomSubagents:" +
    customSubagentNormalizer +
    "," +
    "getTaskToolConfig:async()=>({})" +
    "}"
  );
}

function managedTaskToolPatched() {
  return (
    "isGenerateImageModelRestricted:!1,taskToolProps:" +
    "void 0!==e.runOptions.subagentTypeName?void 0:" +
    managedTaskToolProps("()=>[]", SAND_MANAGED_TASK_TOOL_MARKER, "new Map([[i,{slug:i}]])") +
    "},resolvers:"
  );
}

function managedTaskToolPatchedV124() {
  return (
    "isGenerateImageModelRestricted:!1,taskToolProps:" +
    managedTaskToolProps("e=>e", LEGACY_SAND_MANAGED_TASK_TOOL_MARKER, "new Map") +
    "},resolvers:"
  );
}

function managedTaskToolPatchedV125() {
  return (
    "isGenerateImageModelRestricted:!1,taskToolProps:" +
    "void 0!==e.runOptions.subagentTypeName?void 0:" +
    managedTaskToolProps("()=>[]", LEGACY_SAND_MANAGED_TASK_TOOL_MARKER, "new Map") +
    "},resolvers:"
  );
}

function addStats(a, b) {
  const out = emptyStats();
  for (const k of Object.keys(out)) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
}

function directStreamInjection() {
  return (
    "{" +
    SAND_DIRECT_STREAM_MARKER +
    'const n=t.requestedModel;' +
    'if(void 0===n)throw new Error("Sand direct Stream requires requestedModel");' +
    'const o=String(n.modelId||""),i=o.toLowerCase(),' +
    "r=new Map(n.parameters.map(e=>[e.id,e.value]))," +
    "s=new Joe(e,n,void 0,void 0).getSession()," +
    "p={getExecutor:e=>new RK(s.getExecutor(e))}," +
    'a={vendor:i.includes("grok")?"xai":i.includes("gemini")?"gemini":' +
    'i.includes("claude")||i.includes("opus")||i.includes("sonnet")||i.includes("fable")?' +
    '"anthropic":i.includes("gpt")||i.includes("codex")?"openai":"unknown",' +
    'promptVersion:"latest",reasoningEffort:r.get("effort"),' +
    'isGrok45ProductPrompt:i.includes("grok"),' +
    'isClaude4x:i.includes("claude")||i.includes("opus")||i.includes("sonnet")||i.includes("fable"),' +
    'isFable5:i.includes("fable-5"),' +
    'isOpus5:i.includes("opus-5")||i.includes("opus5"),' +
    'isOpus48:i.includes("opus-4.8")||i.includes("opus48"),' +
    'isOpus46:i.includes("opus-4.6")||i.includes("opus46"),' +
    'isOpus45:i.includes("opus-4.5")||i.includes("opus45"),' +
    'isSonnet45:i.includes("sonnet-4.5")||i.includes("sonnet45"),' +
    'isSonnet4:i.includes("sonnet-4")||i.includes("sonnet4"),' +
    'isGemini3:i.includes("gemini-3")||i.includes("gemini3"),' +
    'isGpt56:i.includes("gpt-5.6")||i.includes("gpt5.6"),' +
    'isGpt55:i.includes("gpt-5.5")||i.includes("gpt5.5"),' +
    'isGpt54:i.includes("gpt-5.4")||i.includes("gpt5.4"),' +
    'isGpt53Codex:i.includes("gpt-5.3-codex"),' +
    'isGpt52Codex:i.includes("gpt-5.2-codex"),' +
    'isCodexFamily:i.includes("codex"),isGpt5Family:i.includes("gpt-5")};' +
    "return{promptSession:s,promptToolSession:p,attempt:{resolvedModel:cre(n)," +
    "supportsSelfSummary:!1,routedModelDisplayName:o," +
    "resolvedModelMetadata:nre(a,o)," +
    "finish:()=>Promise.resolve()}}}"
  );
}

function replaceClientRule(content, stats, key, re) {
  return content.replace(re, (full, prefix, quote, current) => {
    const end = full.slice((prefix + quote + current + quote).length);
    if (CLIENT_MARKER_GUARD.test(end)) return full;
    stats[key] += 1;
    const marker = current === "sand" ? SAND_CLIENT_EXISTING_MARKER : SAND_CLIENT_MARKER;
    if (current === "sand") stats.adopted_sand += 1;
    return prefix + quote + "sand" + quote + marker;
  });
}

function applySandPatches(content) {
  const stats = emptyStats();
  let next = content;

  const legacyClientRe = new RegExp("(['\"])sand\\1" + LEGACY_SAND_CLIENT_MARKER.replace(/[/*]/g, "\\$&"), "g");
  next = next.replace(legacyClientRe, (full, q) => {
    stats.migrated_client += 1;
    return q + "sand" + q + SAND_CLIENT_MARKER;
  });

  const legacyElig = "return!1;" + LEGACY_SAND_ELIGIBILITY_MARKER;
  const legacyEligCount = next.split(legacyElig).length - 1;
  if (legacyEligCount) {
    stats.migrated_eligibility += legacyEligCount;
    next = next.split(legacyElig).join("return!1;" + SAND_ELIGIBILITY_MARKER);
  }

  const clientGuard = "(?!\\/\\*[A-Z0-9_]*SAND_CLIENT(?:_(?:MODE|EXISTING))?_V1\\*\\/)";
  next = replaceClientRule(
    next,
    stats,
    "is_glass",
    new RegExp("(isGlass\\s*\\?\\s*[\"']glass[\"']\\s*:\\s*)([\"'])(ide|sand)\\2" + clientGuard, "g")
  );
  next = replaceClientRule(
    next,
    stats,
    "object_header",
    new RegExp("([\"']x-cursor-client-type[\"']\\s*:\\s*)([\"'])(ide|sand)\\2" + clientGuard, "g")
  );
  next = replaceClientRule(
    next,
    stats,
    "set_header",
    new RegExp(
      "(header\\.set\\(\\s*[\"']x-cursor-client-type[\"']\\s*,\\s*[A-Za-z_$][A-Za-z0-9_$.]*\\s*(?:\\?\\?|\\|\\|)\\s*)([\"'])(ide|sand)\\2" +
        clientGuard,
      "g"
    )
  );

  for (const prefix of ELIGIBILITY_PREFIXES) {
    const count = next.split(prefix).length - 1;
    if (!count) continue;
    const patched = prefix.replace(
      "{const{adminSettingsService:",
      "{return!1;" + SAND_ELIGIBILITY_MARKER + "const{adminSettingsService:"
    );
    next = next.split(prefix).join(patched);
    stats.eligibility += count;
  }

  const routeCount = next.split(MANAGED_LOCAL_ROUTE_ORIGINAL).length - 1;
  if (routeCount) {
    next = next.split(MANAGED_LOCAL_ROUTE_ORIGINAL).join(MANAGED_LOCAL_ROUTE_PATCHED);
    stats.managed_local_route += routeCount;
  }

  const runtimeCount = next.split(LOCAL_RUNTIME_LOAD_ORIGINAL).length - 1;
  if (runtimeCount) {
    next = next.split(LOCAL_RUNTIME_LOAD_ORIGINAL).join(LOCAL_RUNTIME_LOAD_PATCHED);
    stats.local_runtime_load += runtimeCount;
  }

  const moveExecCount = next.split(AGENT_HOST_MOVE_EXEC_ORIGINAL).length - 1;
  if (moveExecCount) {
    next = next.split(AGENT_HOST_MOVE_EXEC_ORIGINAL).join(AGENT_HOST_MOVE_EXEC_PATCHED);
    stats.agent_host_move_exec += moveExecCount;
  }

  if (CLIENT_SUBAGENT_ENABLED) {
  const subagentRouteCount = next.split(MANAGED_SUBAGENT_ROUTE_ORIGINAL).length - 1;
  if (subagentRouteCount) {
    next = next.split(MANAGED_SUBAGENT_ROUTE_ORIGINAL).join(MANAGED_SUBAGENT_ROUTE_PATCHED);
    stats.managed_subagent_route += subagentRouteCount;
  }

  const actionRouteCount = next.split(MANAGED_ACTION_ROUTE_ORIGINAL).length - 1;
  if (actionRouteCount) {
    next = next.split(MANAGED_ACTION_ROUTE_ORIGINAL).join(MANAGED_ACTION_ROUTE_PATCHED);
    stats.managed_action_route += actionRouteCount;
  }

  const resumeModeCount = next.split(SUBAGENT_RESUME_MODE_ORIGINAL).length - 1;
  if (resumeModeCount) {
    next = next.split(SUBAGENT_RESUME_MODE_ORIGINAL).join(SUBAGENT_RESUME_MODE_PATCHED);
    stats.subagent_resume_mode += resumeModeCount;
  }

  if (!next.includes(SAND_SUBAGENT_COMPLETION_WAKE_MARKER)) {
    next = next.replace(SUBAGENT_COMPLETION_WAKE_RE, (full, variable) => {
      stats.subagent_completion_wake += 1;
      return (
        variable +
        '.source==="subagent"' +
        SAND_SUBAGENT_COMPLETION_WAKE_MARKER +
        "||" +
        full
      );
    });
  }

  const subagentSessionCount = next.split(MANAGED_SUBAGENT_SESSION_ORIGINAL).length - 1;
  if (subagentSessionCount) {
    next = next.split(MANAGED_SUBAGENT_SESSION_ORIGINAL).join(MANAGED_SUBAGENT_SESSION_PATCHED);
    stats.managed_subagent_session += subagentSessionCount;
  }

  for (const previous of [managedTaskToolPatchedV125(), managedTaskToolPatchedV124()]) {
    const migrated = next.split(previous).length - 1;
    if (migrated) {
      next = next.split(previous).join(managedTaskToolPatched());
      stats.migrated_task_tool += migrated;
    }
  }

  const taskToolCount = next.split(MANAGED_TASK_TOOL_ORIGINAL).length - 1;
  if (taskToolCount) {
    next = next.split(MANAGED_TASK_TOOL_ORIGINAL).join(managedTaskToolPatched());
    stats.managed_task_tool += taskToolCount;
  }
  }

  const identityCount = next.split(AGENT_HOST_IDENTITY_ORIGINAL).length - 1;
  if (identityCount) {
    next = next.split(AGENT_HOST_IDENTITY_ORIGINAL).join(AGENT_HOST_IDENTITY_PATCHED);
    stats.agent_host_identity += identityCount;
  }

  if (!next.includes(SAND_DIRECT_STREAM_MARKER) && next.includes(DIRECT_STREAM_ANCHOR)) {
    next = next.replace(DIRECT_STREAM_ANCHOR, DIRECT_STREAM_ANCHOR + directStreamInjection());
    stats.direct_stream += 1;
  }

  if (!next.includes(SAND_AGENT_HOST_ENABLEMENT_MARKER)) {
    next = next.replace(AGENT_HOST_ENABLEMENT_RE, (full, left, variable, comma) => {
      stats.agent_host_enablement += 1;
      return variable + "=!0;" + SAND_AGENT_HOST_ENABLEMENT_MARKER + left + variable + comma;
    });
  }

  next = applyPushContextTimeout(next, stats);

  return { content: next, stats };
}

function removeSandPatches(content) {
  const stats = emptyStats();
  let next = content;

  const legacyClientRe = new RegExp("(['\"])sand\\1" + LEGACY_SAND_CLIENT_MARKER.replace(/[/*]/g, "\\$&"), "g");
  next = next.replace(legacyClientRe, (full, q) => {
    stats.object_header += 1;
    return q + "ide" + q;
  });

  const legacyElig = "return!1;" + LEGACY_SAND_ELIGIBILITY_MARKER;
  const legacyEligCount = next.split(legacyElig).length - 1;
  if (legacyEligCount) {
    stats.eligibility += legacyEligCount;
    next = next.split(legacyElig).join("");
  }

  const clientRe = new RegExp("(['\"])sand\\1" + SAND_CLIENT_MARKER.replace(/[/*]/g, "\\$&"), "g");
  next = next.replace(clientRe, (full, q) => {
    stats.object_header += 1;
    return q + "ide" + q;
  });

  const existingRe = new RegExp("(['\"])sand\\1" + SAND_CLIENT_EXISTING_MARKER.replace(/[/*]/g, "\\$&"), "g");
  next = next.replace(existingRe, (full, q) => {
    stats.object_header += 1;
    return q + "sand" + q;
  });

  next = next.replace(ELIGIBILITY_MARKER_RE, () => {
    stats.eligibility += 1;
    return "";
  });

  const routeCount = next.split(MANAGED_LOCAL_ROUTE_PATCHED).length - 1;
  if (routeCount) {
    next = next.split(MANAGED_LOCAL_ROUTE_PATCHED).join(MANAGED_LOCAL_ROUTE_ORIGINAL);
    stats.managed_local_route += routeCount;
  }

  const runtimeCount = next.split(LOCAL_RUNTIME_LOAD_PATCHED).length - 1;
  if (runtimeCount) {
    next = next.split(LOCAL_RUNTIME_LOAD_PATCHED).join(LOCAL_RUNTIME_LOAD_ORIGINAL);
    stats.local_runtime_load += runtimeCount;
  }

  const moveExecCount = next.split(AGENT_HOST_MOVE_EXEC_PATCHED).length - 1;
  if (moveExecCount) {
    next = next.split(AGENT_HOST_MOVE_EXEC_PATCHED).join(AGENT_HOST_MOVE_EXEC_ORIGINAL);
    stats.agent_host_move_exec += moveExecCount;
  }

  const subagentRouteCount = next.split(MANAGED_SUBAGENT_ROUTE_PATCHED).length - 1;
  if (subagentRouteCount) {
    next = next.split(MANAGED_SUBAGENT_ROUTE_PATCHED).join(MANAGED_SUBAGENT_ROUTE_ORIGINAL);
    stats.managed_subagent_route += subagentRouteCount;
  }

  const actionRouteCount = next.split(MANAGED_ACTION_ROUTE_PATCHED).length - 1;
  if (actionRouteCount) {
    next = next.split(MANAGED_ACTION_ROUTE_PATCHED).join(MANAGED_ACTION_ROUTE_ORIGINAL);
    stats.managed_action_route += actionRouteCount;
  }

  const resumeModeCount = next.split(SUBAGENT_RESUME_MODE_PATCHED).length - 1;
  if (resumeModeCount) {
    next = next.split(SUBAGENT_RESUME_MODE_PATCHED).join(SUBAGENT_RESUME_MODE_ORIGINAL);
    stats.subagent_resume_mode += resumeModeCount;
  }

  next = next.replace(SUBAGENT_COMPLETION_WAKE_PATCH_RE, (full, variable) => {
    stats.subagent_completion_wake += 1;
    return (
      variable +
      '.source==="interactive-child"||' +
      variable +
      '.payload.notificationContext==="user_driven_interactive_child"'
    );
  });

  const taskV2 = managedTaskToolPatched();
  const taskV2Count = next.split(taskV2).length - 1;
  if (taskV2Count) {
    next = next.split(taskV2).join(MANAGED_TASK_TOOL_ORIGINAL);
    stats.managed_task_tool += taskV2Count;
  }
  for (const previous of [managedTaskToolPatchedV125(), managedTaskToolPatchedV124()]) {
    const previousCount = next.split(previous).length - 1;
    if (previousCount) {
      next = next.split(previous).join(MANAGED_TASK_TOOL_ORIGINAL);
      stats.managed_task_tool += previousCount;
    }
  }

  const subagentSessionCount = next.split(MANAGED_SUBAGENT_SESSION_PATCHED).length - 1;
  if (subagentSessionCount) {
    next = next.split(MANAGED_SUBAGENT_SESSION_PATCHED).join(MANAGED_SUBAGENT_SESSION_ORIGINAL);
    stats.managed_subagent_session += subagentSessionCount;
  }

  const identityCount = next.split(AGENT_HOST_IDENTITY_PATCHED).length - 1;
  if (identityCount) {
    next = next.split(AGENT_HOST_IDENTITY_PATCHED).join(AGENT_HOST_IDENTITY_ORIGINAL);
    stats.agent_host_identity += identityCount;
  }

  const injection = directStreamInjection();
  const directCount = next.split(injection).length - 1;
  if (directCount) {
    next = next.split(injection).join("");
    stats.direct_stream += directCount;
  }

  next = next.replace(AGENT_HOST_ENABLEMENT_PATCH_RE, (full, variable, left, comma) => {
    stats.agent_host_enablement += 1;
    return left + variable + comma;
  });

  next = removePushContextTimeout(next, stats);

  return { content: next, stats };
}

function detectSand(content) {
  return {
    client: (content.split(SAND_CLIENT_MARKER).length - 1) + (content.split(SAND_CLIENT_EXISTING_MARKER).length - 1),
    eligibility: content.split(SAND_ELIGIBILITY_MARKER).length - 1,
    managedLocal: content.split(SAND_MANAGED_LOCAL_ROUTE_MARKER).length - 1,
    runtimeLoad: content.split(SAND_LOCAL_RUNTIME_LOAD_MARKER).length - 1,
    moveExec: content.split(SAND_AGENT_HOST_MOVE_EXEC_MARKER).length - 1,
    directStream: content.split(SAND_DIRECT_STREAM_MARKER).length - 1,
    agentHost: content.split(SAND_AGENT_HOST_ENABLEMENT_MARKER).length - 1,
    identity: content.split(SAND_AGENT_HOST_IDENTITY_MARKER).length - 1,
    subagentRoute: content.split(SAND_MANAGED_SUBAGENT_ROUTE_MARKER).length - 1,
    subagentSession: content.split(SAND_MANAGED_SUBAGENT_SESSION_MARKER).length - 1,
    taskTool: content.split(SAND_MANAGED_TASK_TOOL_MARKER).length - 1,
    legacyTaskTool: content.split(LEGACY_SAND_MANAGED_TASK_TOOL_MARKER).length - 1,
    actionRoute: content.split(SAND_MANAGED_ACTION_ROUTE_MARKER).length - 1,
    resumeMode: content.split(SAND_SUBAGENT_RESUME_MODE_MARKER).length - 1,
    completionWake: content.split(SAND_SUBAGENT_COMPLETION_WAKE_MARKER).length - 1,
    pushContextTimeout: content.split(SAND_PUSH_CONTEXT_TIMEOUT_MARKER).length - 1,
    legacy:
      (content.split(LEGACY_SAND_CLIENT_MARKER).length - 1) +
      (content.split(LEGACY_SAND_ELIGIBILITY_MARKER).length - 1),
  };
}

function hasSandMarkers(content) {
  const d = detectSand(content);
  return (
    d.client +
      d.eligibility +
      d.managedLocal +
      d.runtimeLoad +
      d.moveExec +
      d.directStream +
      d.agentHost +
      d.identity +
      d.subagentRoute +
      d.subagentSession +
      d.taskTool +
      d.legacyTaskTool +
      d.actionRoute +
      d.resumeMode +
      d.completionWake +
      d.pushContextTimeout +
      d.legacy >
    0
  );
}

function streamModeInstalled(d) {
  return (
    d.managedLocal > 0 &&
    d.runtimeLoad > 0 &&
    d.moveExec > 0 &&
    d.directStream > 0 &&
    d.agentHost > 0 &&
    d.identity > 0
  );
}

function streamLifecycleInstalled(d) {
  return (
    streamModeInstalled(d) &&
    d.subagentRoute > 0 &&
    d.subagentSession > 0 &&
    d.taskTool > 0 &&
    !d.legacyTaskTool &&
    d.actionRoute > 0 &&
    d.resumeMode > 0 &&
    d.completionWake > 0
  );
}

// 一次完整注入在 3.18.9 上每个生命周期补丁应命中的次数（与 sand_stream_installer 1.2.6 的
// 安装后校验一致：单点补丁各 1，agentHost/completionWake 在 desktop+glass 两个 workbench 各 1 = 2）。
// 用它做“注入前预检”：只要开始打 stream，就必须全部齐，缺哪条直接拒绝写入，绝不半补丁。
const EXPECTED_LIFECYCLE = {
  managedLocal: 1,
  runtimeLoad: 1,
  moveExec: 1,
  directStream: 1,
  agentHost: 2,
  identity: 1,
  subagentRoute: 1,
  subagentSession: 1,
  taskTool: 1,
  actionRoute: 1,
  resumeMode: 1,
  completionWake: 2
};

function lifecycleAttempted(d) {
  // 核心 Bot 路由标记在两种模式下都会有；子代理关掉时不看子代理那几项。
  return (
    (d.managedLocal || 0) +
      (d.runtimeLoad || 0) +
      (d.moveExec || 0) +
      (d.directStream || 0) +
      (d.agentHost || 0) +
      (d.identity || 0) >
    0
  );
}

// 返回没达标的生命周期补丁列表；每项 {key, have, want}。空数组表示齐了。
// 关掉客户端子代理时（CLIENT_SUBAGENT_ENABLED=false），不要求那 6 项子代理补丁。
function lifecycleShortfall(d) {
  const out = [];
  for (const key of Object.keys(EXPECTED_LIFECYCLE)) {
    if (!CLIENT_SUBAGENT_ENABLED && SUBAGENT_LIFECYCLE_KEYS.includes(key)) continue;
    const have = d[key] || 0;
    const want = EXPECTED_LIFECYCLE[key];
    if (have < want) out.push({ key, have, want });
  }
  if (CLIENT_SUBAGENT_ENABLED && (d.legacyTaskTool || 0) > 0) {
    out.push({ key: 'legacyTaskTool', have: d.legacyTaskTool, want: 0 });
  }
  return out;
}

function productChecksum(buf) {
  return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, "");
}

function updateExtensionHashes(extHostContent, changedMains) {
  let next = extHostContent;
  let changed = false;
  for (const { ext, bytes } of changedMains) {
    const extensionId = "anysphere." + ext;
    if (!next.includes(`"${extensionId}"`)) continue;
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const re = new RegExp(
      `("${extensionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\{[\\s\\S]{0,2400}?"main\\.js"\\s*:\\s*")[0-9a-f]{64}(")`
    );
    const updated = next.replace(re, `$1${digest}$2`);
    if (updated !== next) {
      next = updated;
      changed = true;
    }
  }
  return { content: next, changed };
}

function syncProductChecksums(productText, resolveOutFile) {
  const hasBom = productText.charCodeAt(0) === 0xfeff;
  const raw = hasBom ? productText.slice(1) : productText;
  let product;
  try {
    product = JSON.parse(raw);
  } catch (_) {
    return { content: productText, changed: false };
  }
  if (!product || typeof product !== "object" || !product.checksums || typeof product.checksums !== "object") {
    return { content: productText, changed: false };
  }
  let changed = false;
  for (const key of Object.keys(product.checksums)) {
    const data = resolveOutFile(key);
    if (!data) continue;
    const digest = productChecksum(data);
    if (product.checksums[key] !== digest) {
      product.checksums[key] = digest;
      changed = true;
    }
  }
  if (!changed) return { content: productText, changed: false };
  let text = JSON.stringify(product, null, "\t");
  if (hasBom) text = "\uFEFF" + text;
  return { content: text, changed: true };
}

module.exports = {
  TARGET_SPECS,
  EXT_HOST_REL,
  PRODUCT_REL,
  applySandPatches,
  removeSandPatches,
  detectSand,
  hasSandMarkers,
  streamModeInstalled,
  streamLifecycleInstalled,
  EXPECTED_LIFECYCLE,
  CLIENT_SUBAGENT_ENABLED,
  lifecycleAttempted,
  lifecycleShortfall,
  sumStats,
  addStats,
  emptyStats,
  productChecksum,
  updateExtensionHashes,
  syncProductChecksums,
  managedTaskToolPatched,
  managedTaskToolPatchedV124,
  managedTaskToolPatchedV125,
  countUnpatchedPushContextTimeout,
  SAND_PUSH_CONTEXT_TIMEOUT_MARKER,
};
