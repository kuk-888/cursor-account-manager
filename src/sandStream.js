// Sand Stream 补丁（Cursor 3.18.9 / 3.18.25 / 3.19.13）
// 先打 3.18 旧字面量，再打 3.19 新形态；卸载兼容 2.1.0–2.3.11 全部历史标记。
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
const SAND_RULES_PRESEED_MARKER = "/*SAND_RULES_PRESEED_V1*/";
const LEGACY_SAND_CLIENT_MARKER = "/*KC_SAND_CLIENT_V1*/";
const LEGACY_SAND_ELIGIBILITY_MARKER = "/*KC_SAND_ELIGIBILITY_V1*/";
const ROUTE_HINT_MARKER = "/*ROUTE_HINT_V1*/";
const ROUTE_HINT_LINE = "> grok-bot route to ";
const ROUTE_LABEL_MARKER = "/*ROUTE_LABEL_V1*/";
const ROUTE_LABEL_ORIGINAL = '["Routed to "';
const ROUTE_LABEL_PATCHED = ROUTE_LABEL_MARKER + '["本次使用 "';

const ROUTE_HINT_HANDLE_RE =
  /handleRoutedModel\(([A-Za-z_$][\w$]*)\)\{if\(\1\.length===0\)return;this\.pendingRoutedModelLabel=\1;(?!\/\*ROUTE_HINT_V1\*\/)/g;
const ROUTE_HINT_HANDLE_PAYLOAD_RE =
  /\/\*ROUTE_HINT_V1\*\/try\{this\._routeHintLast!==([A-Za-z_$][\w$]*)&&\(this\._routeHintLast=\1,this\.handleTextDelta\(void 0,"(?:\\"|[^"])*"\+\1\+"\\n"\)\)\}catch\(_\)\{\};/g;
const ROUTE_HINT_HANDLE_PATCH_RE =
  /handleRoutedModel\(([A-Za-z_$][\w$]*)\)\{if\(\1\.length===0\)return;this\.pendingRoutedModelLabel=\1;\/\*ROUTE_HINT_V1\*\/try\{this\._routeHintLast!==\1&&\(this\._routeHintLast=\1,this\.handleTextDelta\(void 0,"(?:\\"|[^"])*"\+\1\+"\\n"\)\)\}catch\(_\)\{\};/g;
const ROUTE_HINT_STATUS_RE =
  /([A-Za-z_$][\w$]*)\.serviceStatusUpdate&&([A-Za-z_$][\w$]*)\.push\(\{kind:"hostRow",id:`\$\{([A-Za-z_$][\w$]*)\}:service-status`,sourceIds:([A-Za-z_$][\w$]*),subtype:"serviceStatus",content:"Status update"\}/g;
const ROUTE_HINT_STATUS_PATCH_RE =
  /([A-Za-z_$][\w$]*)\.serviceStatusUpdate&&([A-Za-z_$][\w$]*)\.push\(\{kind:"hostRow",id:`\$\{([A-Za-z_$][\w$]*)\}:service-status`,sourceIds:([A-Za-z_$][\w$]*),subtype:"serviceStatus",content:\/\*ROUTE_HINT_V1\*\/\(\1\.serviceStatusUpdate\.message\|\|"Status update"\)\}/g;

function routeHintInjectCall(v) {
  return (
    "try{this._routeHintLast!==" + v + "&&(this._routeHintLast=" + v +
    ",this.handleTextDelta(void 0," + JSON.stringify(ROUTE_HINT_LINE) + "+" + v + "+\"\\n\"))}catch(_){};"
  );
}

function routeHintHandlePatched(v) {
  return (
    "handleRoutedModel(" + v + "){if(" + v + ".length===0)return;" +
    "this.pendingRoutedModelLabel=" + v + ";" +
    ROUTE_HINT_MARKER +
    routeHintInjectCall(v)
  );
}

function applyRouteHint(content, stats) {
  // 3.19.13 官方已有「Routed to …」+ 点赞行（routedModelLabel）。
  // 再往气泡 handleTextDelta 塞 `> grok-bot route to` 会变成 markdown 引用竖杠，
  // 和下方正文叠在一起。注入时拆掉旧气泡行，不再打回去。
  let next = content.replace(ROUTE_HINT_HANDLE_PATCH_RE, (full, v) => {
    stats.route_hint += 1;
    return (
      "handleRoutedModel(" + v + "){if(" + v + ".length===0)return;" +
      "this.pendingRoutedModelLabel=" + v + ";"
    );
  });
  next = next.replace(ROUTE_HINT_HANDLE_PAYLOAD_RE, () => {
    stats.route_hint += 1;
    return "";
  });
  next = next.replace(ROUTE_HINT_STATUS_RE, (full, obj, arr, bid, src) => {
    stats.route_hint += 1;
    return (
      obj + ".serviceStatusUpdate&&" + arr +
      ".push({kind:\"hostRow\",id:`${" + bid + "}:service-status`,sourceIds:" + src +
      ",subtype:\"serviceStatus\",content:" + ROUTE_HINT_MARKER +
      "(" + obj + ".serviceStatusUpdate.message||\"Status update\")}"
    );
  });
  const labelCount = next.split(ROUTE_LABEL_ORIGINAL).length - 1;
  if (labelCount) {
    next = next.split(ROUTE_LABEL_ORIGINAL).join(ROUTE_LABEL_PATCHED);
    stats.route_label += labelCount;
  }
  return next;
}

function removeRouteHint(content, stats) {
  let next = content.replace(ROUTE_HINT_HANDLE_PATCH_RE, (full, v) => {
    stats.route_hint += 1;
    return (
      "handleRoutedModel(" + v + "){if(" + v + ".length===0)return;" +
      "this.pendingRoutedModelLabel=" + v + ";"
    );
  });
  next = next.replace(ROUTE_HINT_STATUS_PATCH_RE, (full, obj, arr, bid, src) => {
    stats.route_hint += 1;
    return (
      obj + ".serviceStatusUpdate&&" + arr +
      ".push({kind:\"hostRow\",id:`${" + bid + "}:service-status`,sourceIds:" + src +
      ",subtype:\"serviceStatus\",content:\"Status update\"}"
    );
  });
  const labelCount = next.split(ROUTE_LABEL_PATCHED).length - 1;
  if (labelCount) {
    next = next.split(ROUTE_LABEL_PATCHED).join(ROUTE_LABEL_ORIGINAL);
    stats.route_label += labelCount;
  }
  return next;
}

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
  { rel: path.join("extensions", "cursor-agent-host", "dist", "61.js") },
  { rel: path.join("extensions", "cursor-agent-host", "dist", "675.js") },
  { rel: path.join("extensions", "cursor-agent-host", "dist", "4884.js") },
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
  "function Z1S(t){const{adminSettingsService:e",
  "function m$f(e){const{adminSettingsService:t",
];
const ELIGIBILITY_GENERIC_RE =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$])\)\{const\{adminSettingsService:([A-Za-z_$])/g;

const MANAGED_LOCAL_ROUTE_ORIGINAL =
  'try{return(yield o.checkFeatureGate(ae))?{runtime:"managed-local",reason:"eligible"}:{runtime:"connect",reason:"gate-off"}}catch(e)';
const MANAGED_LOCAL_ROUTE_PATCHED =
  "try{return" + SAND_MANAGED_LOCAL_ROUTE_MARKER + '{runtime:"managed-local",reason:"sand-client"}}catch(e)';

// 3.19.13：gate-off 会先 return connect，只改 eligible 不够。插入 early-return，原文原样留下便于卸载。
const MANAGED_LOCAL_ROUTE_319_ANCHOR =
  'if(!o)return{runtime:"connect",reason:"gate-off"};const s=g(t),i=A(s,e,r);return void 0!==i?f(i,s):{runtime:"managed-local",reason:"eligible"}';
const MANAGED_LOCAL_ROUTE_319_PATCHED =
  "return" +
  SAND_MANAGED_LOCAL_ROUTE_MARKER +
  '{runtime:"managed-local",reason:"sand-client"};' +
  MANAGED_LOCAL_ROUTE_319_ANCHOR;

const LOCAL_RUNTIME_LOAD_ORIGINAL = "let t=!1;try{t=await r.cursor.checkFeatureGate(Ds)}";
const LOCAL_RUNTIME_LOAD_PATCHED = "let t=!0;" + SAND_LOCAL_RUNTIME_LOAD_MARKER + "try{t=!0}";
const LOCAL_RUNTIME_LOAD_319_ORIGINAL = "let t=!1;try{t=await r.cursor.checkFeatureGate(Ms)}";
const LOCAL_RUNTIME_LOAD_319_PATCHED = "let t=!0;" + SAND_LOCAL_RUNTIME_LOAD_MARKER + "/*Ms*/try{t=!0}";

const AGENT_HOST_MOVE_EXEC_ORIGINAL =
  "p=await Promise.resolve(r.cursor.checkFeatureGate(Us)).catch(()=>!1)";
const AGENT_HOST_MOVE_EXEC_PATCHED = "p=!0" + SAND_AGENT_HOST_MOVE_EXEC_MARKER;
const AGENT_HOST_MOVE_EXEC_319_ORIGINAL =
  "h=await Promise.resolve(r.cursor.checkFeatureGate(Js)).catch(()=>!1)";
const AGENT_HOST_MOVE_EXEC_319_PATCHED = "h=!0" + SAND_AGENT_HOST_MOVE_EXEC_MARKER + "/*Js*/";

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

// 3.19.13：background 已在 A() 里单独放行；这里补 summarize/resume。
const MANAGED_ACTION_ROUTE_319_ORIGINAL =
  '"userMessageAction"!==e.actionCase?"action-not-supported":' +
  "function(e){return e.requestedMode===o.xy.AGENT||e.isHostedSubagentChild&&e.requestedMode===o.xy.UNSPECIFIED}(e)?" +
  'e.simulatedUserMessage?"simulated-message-not-supported":y(e,r):"mode-not-supported"';
const MANAGED_ACTION_ROUTE_319_PATCHED =
  SAND_MANAGED_ACTION_ROUTE_MARKER +
  '!["userMessageAction","summarizeAction","resumeAction"].includes(e.actionCase)?' +
  '"action-not-supported":' +
  '"userMessageAction"===e.actionCase&&' +
  "!(e.requestedMode===o.xy.AGENT||e.isHostedSubagentChild&&e.requestedMode===o.xy.UNSPECIFIED)?" +
  '"mode-not-supported":' +
  '"userMessageAction"===e.actionCase&&e.simulatedUserMessage?"simulated-message-not-supported":y(e,r)';

const MANAGED_SUBAGENT_ROUTE_319_ANCHOR =
  "isHostedSubagentChild:Boolean(e.runOptions.subagentTypeName||e.runOptions.parentAgentToolCallId)";
const MANAGED_SUBAGENT_ROUTE_319_PATCHED =
  MANAGED_SUBAGENT_ROUTE_319_ANCHOR + SAND_MANAGED_SUBAGENT_ROUTE_MARKER;

const MANAGED_SUBAGENT_SESSION_319_ANCHOR =
  "outputNotificationLimit:1e3,useClientSideSubagent:!0}";
const MANAGED_SUBAGENT_SESSION_319_PATCHED =
  "outputNotificationLimit:1e3,useClientSideSubagent:!0" +
  SAND_MANAGED_SUBAGENT_SESSION_MARKER +
  "}";

const MANAGED_TASK_TOOL_319_ORIGINAL =
  "isGenerateImageModelRestricted:!1,taskToolProps:Ne({parentModelId:null!=p?p:n.modelName,modelInfo:n})},resolvers:";
const MANAGED_TASK_TOOL_319_PATCHED =
  "isGenerateImageModelRestricted:!1,taskToolProps:Object.assign(Ne({parentModelId:null!=p?p:n.modelName,modelInfo:n}),{isModelBlocked:()=>!1})" +
  SAND_MANAGED_TASK_TOOL_MARKER +
  "},resolvers:";

const SUBAGENT_RESUME_MODE_RE =
  /e\.resumeAgentId&&e\.mode===([A-Za-z_$][\w$]*)\.FL\.UNSPECIFIED&&!e\.readonly\?([A-Za-z_$][\w$]*)\.(xyI|xy)\.UNSPECIFIED:/g;
const SUBAGENT_RESUME_MODE_PATCH_RE = new RegExp(
  "e\\.resumeAgentId&&e\\.mode===([A-Za-z_$][\\w$]*)\\.FL\\.UNSPECIFIED&&!e\\.readonly\\?" +
    SAND_SUBAGENT_RESUME_MODE_MARKER.replace(/[/*]/g, "\\$&") +
    "([A-Za-z_$][\\w$]*)\\.(xyI|xy)\\.AGENT:",
  "g"
);

const SUBAGENT_COMPLETION_WAKE_RE =
  /([A-Za-z_$][A-Za-z0-9_$]*)\.source==="interactive-child"\|\|\1\.payload\.notificationContext==="user_driven_interactive_child"/g;
const SUBAGENT_COMPLETION_WAKE_PATCH_RE = new RegExp(
  "([A-Za-z_$][A-Za-z0-9_$]*)\\.source===\"subagent\"" +
    SAND_SUBAGENT_COMPLETION_WAKE_MARKER.replace(/[/*]/g, "\\$&") +
    "\\|\\|\\1\\.source===\"interactive-child\"\\|\\|\\1\\.payload\\.notificationContext===\"user_driven_interactive_child\"",
  "g"
);

const MANAGED_SUBAGENT_SESSION_RE =
  /const ([A-Za-z_$][\w$]*)=\{enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0,enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0,nalLoopDetection:!0\};/g;
const MANAGED_SUBAGENT_SESSION_PATCH_RE = new RegExp(
  "const ([A-Za-z_$][\\w$]*)=\\{enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0," +
    "enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0," +
    "nalLoopDetection:!0,useClientSideSubagent:!0" +
    SAND_MANAGED_SUBAGENT_SESSION_MARKER.replace(/[/*]/g, "\\$&") +
    "\\};",
  "g"
);

const MANAGED_TASK_TOOL_ORIGINAL =
  "isGenerateImageModelRestricted:!1,taskToolProps:void 0},resolvers:";

const DIRECT_STREAM_ANCHOR_RE =
  /function ([A-Za-z_$][\w$]*)\(e\)\{return t=>\{return n=this,([a-z])=void 0,s=function\*\(\)\{/;

// push_req_context 超时：缓存未命中时 getPushedRulesProto 最多等 1e4ms（10s），
// 走 Bot 时常等满。改成 50ms 作为安全网（预填充补丁通常让 peek 直接命中，不走这条路）。
const PUSH_CONTEXT_TIMEOUT_MS = 50;
const PUSH_CONTEXT_TIMEOUT_ORIGINAL_RE =
  /("\[push_req_context\]",)([A-Za-z_$][\w$]*)=1e4/g;
const PUSH_CONTEXT_TIMEOUT_PATCHED_RE = new RegExp(
  '("\\[push_req_context\\]",)([A-Za-z_$][\\w$]*)=(?:50|200|500)' +
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

// 预填充：cursorRulesService 构造时 _lastPushedRulesProto=void 0，
// 导致首问 peek 返回 undefined、走 timeout 等待。改成 [] 让 peek 直接返回空数组，
// agent-host 随后推送真规则覆盖。效果：首问零等待（可能少带规则），后续问正常。
const RULES_PRESEED_ORIGINAL = "this._lastPushedRulesProto=void 0,this._providerRulesCache=new Map";
const RULES_PRESEED_PATCHED =
  "this._lastPushedRulesProto=[]" + SAND_RULES_PRESEED_MARKER + ",this._providerRulesCache=new Map";

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
    rules_preseed: 0,
    route_hint: 0,
    route_label: 0,
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
    s.push_context_timeout +
    s.rules_preseed +
    s.route_hint +
    s.route_label
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

function directStreamInjection319Legacy() {
  return (
    "{" +
    SAND_DIRECT_STREAM_MARKER +
    "const req=t.requestedModel;" +
    'if(void 0===req)throw new Error("Sand direct Stream requires requestedModel");' +
    'const mid=String(req.modelId||""),low=mid.toLowerCase(),' +
    "pmap=new Map((req.parameters||[]).map(e=>[e.id,e.value]))," +
    "sess=new J(e,req,void 0,void 0).getSession()," +
    "tools={getExecutor:x=>new o.Ycw(sess.getExecutor(x))}," +
    'meta={vendor:low.includes("grok")?"xai":low.includes("gemini")?"gemini":' +
    'low.includes("claude")||low.includes("opus")||low.includes("sonnet")||low.includes("fable")?' +
    '"anthropic":low.includes("gpt")||low.includes("codex")?"openai":"unknown",' +
    'promptVersion:"latest",reasoningEffort:pmap.get("effort"),' +
    'isGrok45ProductPrompt:low.includes("grok"),' +
    'isClaude4x:low.includes("claude")||low.includes("opus")||low.includes("sonnet")||low.includes("fable"),' +
    'isFable5:low.includes("fable-5"),' +
    'isOpus5:low.includes("opus-5")||low.includes("opus5"),' +
    'isOpus48:low.includes("opus-4.8")||low.includes("opus48"),' +
    'isOpus46:low.includes("opus-4.6")||low.includes("opus46"),' +
    'isOpus45:low.includes("opus-4.5")||low.includes("opus45"),' +
    'isSonnet45:low.includes("sonnet-4.5")||low.includes("sonnet45"),' +
    'isSonnet4:low.includes("sonnet-4")||low.includes("sonnet4"),' +
    'isGemini3:low.includes("gemini-3")||low.includes("gemini3"),' +
    'isGpt56:low.includes("gpt-5.6")||low.includes("gpt5.6"),' +
    'isGpt55:low.includes("gpt-5.5")||low.includes("gpt5.5"),' +
    'isGpt54:low.includes("gpt-5.4")||low.includes("gpt5.4"),' +
    'isGpt53Codex:low.includes("gpt-5.3-codex"),' +
    'isGpt52Codex:low.includes("gpt-5.2-codex"),' +
    'isCodexFamily:low.includes("codex"),isGpt5Family:low.includes("gpt-5")};' +
    "return{promptSession:sess,promptToolSession:tools,attempt:{resolvedModel:req," +
    "supportsSelfSummary:!1,routedModelDisplayName:mid," +
    "resolvedModelMetadata:oe(meta,mid)," +
    "finish:()=>Promise.resolve()}}}"
  );
}

function directStreamInjection319() {
  return (
    "{" +
    SAND_DIRECT_STREAM_MARKER +
    "const req=t.requestedModel;" +
    'if(void 0===req)throw new Error("Sand direct Stream requires requestedModel");' +
    'const mid=String(req.modelId||""),low=mid.toLowerCase(),' +
    "pmap=new Map((req.parameters||[]).map(e=>[e.id,e.value]))," +
    "sess=new J(e,req,void 0,void 0).getSession()," +
    "tools={getExecutor:x=>new o.Ycw(sess.getExecutor(x))}," +
    'grok46=low.includes("grok")&&(low.includes("4.6")||low.includes("grok46")),' +
    'meta={vendor:low.includes("grok")?"xai":low.includes("gemini")?"gemini":' +
    'low.includes("claude")||low.includes("opus")||low.includes("sonnet")||low.includes("fable")?' +
    '"anthropic":low.includes("gpt")||low.includes("codex")?"openai":"unknown",' +
    'promptVersion:"latest",reasoningEffort:pmap.get("effort"),' +
    "isGrok45ProductPrompt:low.includes(\"grok\")&&!grok46," +
    "isGrok46ProductPrompt:grok46," +
    'isClaude4x:low.includes("claude")||low.includes("opus")||low.includes("sonnet")||low.includes("fable"),' +
    'isFable5:low.includes("fable-5"),' +
    'isOpus5:low.includes("opus-5")||low.includes("opus5"),' +
    'isOpus48:low.includes("opus-4.8")||low.includes("opus48"),' +
    'isOpus46:low.includes("opus-4.6")||low.includes("opus46"),' +
    'isOpus45:low.includes("opus-4.5")||low.includes("opus45"),' +
    'isSonnet45:low.includes("sonnet-4.5")||low.includes("sonnet45"),' +
    'isSonnet4:low.includes("sonnet-4")||low.includes("sonnet4"),' +
    'isGemini3:low.includes("gemini-3")||low.includes("gemini3"),' +
    'isGpt56:low.includes("gpt-5.6")||low.includes("gpt5.6"),' +
    'isGpt55:low.includes("gpt-5.5")||low.includes("gpt5.5"),' +
    'isGpt54:low.includes("gpt-5.4")||low.includes("gpt5.4"),' +
    'isGpt53Codex:low.includes("gpt-5.3-codex"),' +
    'isGpt52Codex:low.includes("gpt-5.2-codex"),' +
    'isCodexFamily:low.includes("codex"),isGpt5Family:low.includes("gpt-5")};' +
    "return{promptSession:sess,promptToolSession:tools,attempt:{resolvedModel:req," +
    "supportsSelfSummary:!1,routedModelDisplayName:mid," +
    "resolvedModelMetadata:{promptModelInfo:oe(meta,mid),useDsv3Harness:!1}," +
    "finish:()=>Promise.resolve()}}}"
  );
}

function pickDirectStreamInjection(content) {
  if (content.includes("class J{constructor(e,t,n,o)") && content.includes(".Ycw(")) {
    return directStreamInjection319();
  }
  if (content.includes("new Joe(") || content.includes("function gre(") || content.includes("function hre(")) {
    return directStreamInjection();
  }
  return null;
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
  next = next.replace(ELIGIBILITY_GENERIC_RE, (full) => {
    if (full.includes(SAND_ELIGIBILITY_MARKER)) return full;
    stats.eligibility += 1;
    return full.replace(
      "{const{adminSettingsService:",
      "{return!1;" + SAND_ELIGIBILITY_MARKER + "const{adminSettingsService:"
    );
  });

  const routeCount = next.split(MANAGED_LOCAL_ROUTE_ORIGINAL).length - 1;
  if (routeCount) {
    next = next.split(MANAGED_LOCAL_ROUTE_ORIGINAL).join(MANAGED_LOCAL_ROUTE_PATCHED);
    stats.managed_local_route += routeCount;
  }
  if (!next.includes(SAND_MANAGED_LOCAL_ROUTE_MARKER)) {
    const route319 = next.split(MANAGED_LOCAL_ROUTE_319_ANCHOR).length - 1;
    if (route319) {
      next = next.split(MANAGED_LOCAL_ROUTE_319_ANCHOR).join(MANAGED_LOCAL_ROUTE_319_PATCHED);
      stats.managed_local_route += route319;
    }
  }

  const runtimeCount = next.split(LOCAL_RUNTIME_LOAD_ORIGINAL).length - 1;
  if (runtimeCount) {
    next = next.split(LOCAL_RUNTIME_LOAD_ORIGINAL).join(LOCAL_RUNTIME_LOAD_PATCHED);
    stats.local_runtime_load += runtimeCount;
  }
  if (!next.includes(SAND_LOCAL_RUNTIME_LOAD_MARKER)) {
    const runtime319 = next.split(LOCAL_RUNTIME_LOAD_319_ORIGINAL).length - 1;
    if (runtime319) {
      next = next.split(LOCAL_RUNTIME_LOAD_319_ORIGINAL).join(LOCAL_RUNTIME_LOAD_319_PATCHED);
      stats.local_runtime_load += runtime319;
    }
  }

  const moveExecCount = next.split(AGENT_HOST_MOVE_EXEC_ORIGINAL).length - 1;
  if (moveExecCount) {
    next = next.split(AGENT_HOST_MOVE_EXEC_ORIGINAL).join(AGENT_HOST_MOVE_EXEC_PATCHED);
    stats.agent_host_move_exec += moveExecCount;
  }
  if (!next.includes(SAND_AGENT_HOST_MOVE_EXEC_MARKER)) {
    const move319 = next.split(AGENT_HOST_MOVE_EXEC_319_ORIGINAL).length - 1;
    if (move319) {
      next = next.split(AGENT_HOST_MOVE_EXEC_319_ORIGINAL).join(AGENT_HOST_MOVE_EXEC_319_PATCHED);
      stats.agent_host_move_exec += move319;
    }
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
  if (!next.includes(SAND_MANAGED_ACTION_ROUTE_MARKER)) {
    const action319 = next.split(MANAGED_ACTION_ROUTE_319_ORIGINAL).length - 1;
    if (action319) {
      next = next.split(MANAGED_ACTION_ROUTE_319_ORIGINAL).join(MANAGED_ACTION_ROUTE_319_PATCHED);
      stats.managed_action_route += action319;
    }
  }

  if (!next.includes(SAND_MANAGED_SUBAGENT_ROUTE_MARKER)) {
    const sub319 = next.split(MANAGED_SUBAGENT_ROUTE_319_ANCHOR).length - 1;
    if (sub319) {
      next = next.split(MANAGED_SUBAGENT_ROUTE_319_ANCHOR).join(MANAGED_SUBAGENT_ROUTE_319_PATCHED);
      stats.managed_subagent_route += sub319;
    }
  }

  if (!next.includes(SAND_SUBAGENT_RESUME_MODE_MARKER)) {
    next = next.replace(SUBAGENT_RESUME_MODE_RE, (full, ident, modeObj, xy) => {
      stats.subagent_resume_mode += 1;
      return "e.resumeAgentId&&e.mode===" + ident + ".FL.UNSPECIFIED&&!e.readonly?" +
        SAND_SUBAGENT_RESUME_MODE_MARKER + modeObj + "." + xy + ".AGENT:";
    });
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

  if (!next.includes(SAND_MANAGED_SUBAGENT_SESSION_MARKER)) {
    next = next.replace(MANAGED_SUBAGENT_SESSION_RE, (full, ident) => {
      stats.managed_subagent_session += 1;
      return "const " + ident + "={enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0," +
        "enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0," +
        "nalLoopDetection:!0,useClientSideSubagent:!0" +
        SAND_MANAGED_SUBAGENT_SESSION_MARKER + "};";
    });
  }
  if (!next.includes(SAND_MANAGED_SUBAGENT_SESSION_MARKER)) {
    const sess319 = next.split(MANAGED_SUBAGENT_SESSION_319_ANCHOR).length - 1;
    if (sess319) {
      next = next.split(MANAGED_SUBAGENT_SESSION_319_ANCHOR).join(MANAGED_SUBAGENT_SESSION_319_PATCHED);
      stats.managed_subagent_session += sess319;
    }
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
  if (!next.includes(SAND_MANAGED_TASK_TOOL_MARKER)) {
    const task319 = next.split(MANAGED_TASK_TOOL_319_ORIGINAL).length - 1;
    if (task319) {
      next = next.split(MANAGED_TASK_TOOL_319_ORIGINAL).join(MANAGED_TASK_TOOL_319_PATCHED);
      stats.managed_task_tool += task319;
    }
  }
  }

  const identityCount = next.split(AGENT_HOST_IDENTITY_ORIGINAL).length - 1;
  if (identityCount) {
    next = next.split(AGENT_HOST_IDENTITY_ORIGINAL).join(AGENT_HOST_IDENTITY_PATCHED);
    stats.agent_host_identity += identityCount;
  }

  const oldDirect319 = directStreamInjection319Legacy();
  if (next.includes(oldDirect319)) {
    next = next.split(oldDirect319).join(directStreamInjection319());
    stats.direct_stream += 1;
  }

  if (!next.includes(SAND_DIRECT_STREAM_MARKER) && DIRECT_STREAM_ANCHOR_RE.test(next)) {
    const injection = pickDirectStreamInjection(next);
    if (injection) {
      next = next.replace(DIRECT_STREAM_ANCHOR_RE, (match) => match + injection);
      stats.direct_stream += 1;
    }
  }

  if (!next.includes(SAND_AGENT_HOST_ENABLEMENT_MARKER)) {
    next = next.replace(AGENT_HOST_ENABLEMENT_RE, (full, left, variable, comma) => {
      stats.agent_host_enablement += 1;
      return variable + "=!0;" + SAND_AGENT_HOST_ENABLEMENT_MARKER + left + variable + comma;
    });
  }

  next = applyPushContextTimeout(next, stats);
  next = applyRouteHint(next, stats);

  if (!next.includes(SAND_RULES_PRESEED_MARKER)) {
    const preseedCount = next.split(RULES_PRESEED_ORIGINAL).length - 1;
    if (preseedCount) {
      next = next.split(RULES_PRESEED_ORIGINAL).join(RULES_PRESEED_PATCHED);
      stats.rules_preseed += preseedCount;
    }
  }

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
  const route319 = next.split(MANAGED_LOCAL_ROUTE_319_PATCHED).length - 1;
  if (route319) {
    next = next.split(MANAGED_LOCAL_ROUTE_319_PATCHED).join(MANAGED_LOCAL_ROUTE_319_ANCHOR);
    stats.managed_local_route += route319;
  }

  const runtime319 = next.split(LOCAL_RUNTIME_LOAD_319_PATCHED).length - 1;
  if (runtime319) {
    next = next.split(LOCAL_RUNTIME_LOAD_319_PATCHED).join(LOCAL_RUNTIME_LOAD_319_ORIGINAL);
    stats.local_runtime_load += runtime319;
  }
  const runtimeCount = next.split(LOCAL_RUNTIME_LOAD_PATCHED).length - 1;
  if (runtimeCount) {
    next = next.split(LOCAL_RUNTIME_LOAD_PATCHED).join(LOCAL_RUNTIME_LOAD_ORIGINAL);
    stats.local_runtime_load += runtimeCount;
  }

  const move319 = next.split(AGENT_HOST_MOVE_EXEC_319_PATCHED).length - 1;
  if (move319) {
    next = next.split(AGENT_HOST_MOVE_EXEC_319_PATCHED).join(AGENT_HOST_MOVE_EXEC_319_ORIGINAL);
    stats.agent_host_move_exec += move319;
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
  const sub319 = next.split(MANAGED_SUBAGENT_ROUTE_319_PATCHED).length - 1;
  if (sub319) {
    next = next.split(MANAGED_SUBAGENT_ROUTE_319_PATCHED).join(MANAGED_SUBAGENT_ROUTE_319_ANCHOR);
    stats.managed_subagent_route += sub319;
  }

  const actionRouteCount = next.split(MANAGED_ACTION_ROUTE_PATCHED).length - 1;
  if (actionRouteCount) {
    next = next.split(MANAGED_ACTION_ROUTE_PATCHED).join(MANAGED_ACTION_ROUTE_ORIGINAL);
    stats.managed_action_route += actionRouteCount;
  }
  const action319 = next.split(MANAGED_ACTION_ROUTE_319_PATCHED).length - 1;
  if (action319) {
    next = next.split(MANAGED_ACTION_ROUTE_319_PATCHED).join(MANAGED_ACTION_ROUTE_319_ORIGINAL);
    stats.managed_action_route += action319;
  }

  next = next.replace(SUBAGENT_RESUME_MODE_PATCH_RE, (full, ident, modeObj, xy) => {
    stats.subagent_resume_mode += 1;
    return "e.resumeAgentId&&e.mode===" + ident + ".FL.UNSPECIFIED&&!e.readonly?" +
      modeObj + "." + xy + ".UNSPECIFIED:";
  });

  next = next.replace(SUBAGENT_COMPLETION_WAKE_PATCH_RE, (full, variable) => {
    stats.subagent_completion_wake += 1;
    return (
      variable +
      '.source==="interactive-child"||' +
      variable +
      '.payload.notificationContext==="user_driven_interactive_child"'
    );
  });

  const task319 = next.split(MANAGED_TASK_TOOL_319_PATCHED).length - 1;
  if (task319) {
    next = next.split(MANAGED_TASK_TOOL_319_PATCHED).join(MANAGED_TASK_TOOL_319_ORIGINAL);
    stats.managed_task_tool += task319;
  }
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

  next = next.replace(MANAGED_SUBAGENT_SESSION_PATCH_RE, (full, ident) => {
    stats.managed_subagent_session += 1;
    return "const " + ident + "={enableEmptyResponseRetry:!0,enableGrepBroadGlobGuard:!0," +
      "enableReadToolNegativeOffset:!0,enableSandboxSharedBuildCache:!0," +
      "nalLoopDetection:!0};";
  });
  const sess319 = next.split(MANAGED_SUBAGENT_SESSION_319_PATCHED).length - 1;
  if (sess319) {
    next = next.split(MANAGED_SUBAGENT_SESSION_319_PATCHED).join(MANAGED_SUBAGENT_SESSION_319_ANCHOR);
    stats.managed_subagent_session += sess319;
  }

  const identityCount = next.split(AGENT_HOST_IDENTITY_PATCHED).length - 1;
  if (identityCount) {
    next = next.split(AGENT_HOST_IDENTITY_PATCHED).join(AGENT_HOST_IDENTITY_ORIGINAL);
    stats.agent_host_identity += identityCount;
  }

  for (const injection of [
    directStreamInjection(),
    directStreamInjection319(),
    directStreamInjection319Legacy()
  ]) {
    const directCount = next.split(injection).length - 1;
    if (directCount) {
      next = next.split(injection).join("");
      stats.direct_stream += directCount;
    }
  }

  next = next.replace(AGENT_HOST_ENABLEMENT_PATCH_RE, (full, variable, left, comma) => {
    stats.agent_host_enablement += 1;
    return left + variable + comma;
  });

  next = removePushContextTimeout(next, stats);
  next = removeRouteHint(next, stats);

  const preseedCount = next.split(RULES_PRESEED_PATCHED).length - 1;
  if (preseedCount) {
    next = next.split(RULES_PRESEED_PATCHED).join(RULES_PRESEED_ORIGINAL);
    stats.rules_preseed += preseedCount;
  }

  return { content: next, stats };
}

function countOf(text, needle) {
  let n = 0, i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function detectSand(content) {
  return {
    client: countOf(content, SAND_CLIENT_MARKER) + countOf(content, SAND_CLIENT_EXISTING_MARKER),
    eligibility: countOf(content, SAND_ELIGIBILITY_MARKER),
    managedLocal: countOf(content, SAND_MANAGED_LOCAL_ROUTE_MARKER),
    runtimeLoad: countOf(content, SAND_LOCAL_RUNTIME_LOAD_MARKER),
    moveExec: countOf(content, SAND_AGENT_HOST_MOVE_EXEC_MARKER),
    directStream: countOf(content, SAND_DIRECT_STREAM_MARKER),
    agentHost: countOf(content, SAND_AGENT_HOST_ENABLEMENT_MARKER),
    identity: countOf(content, SAND_AGENT_HOST_IDENTITY_MARKER),
    subagentRoute: countOf(content, SAND_MANAGED_SUBAGENT_ROUTE_MARKER),
    subagentSession: countOf(content, SAND_MANAGED_SUBAGENT_SESSION_MARKER),
    taskTool: countOf(content, SAND_MANAGED_TASK_TOOL_MARKER),
    legacyTaskTool: countOf(content, LEGACY_SAND_MANAGED_TASK_TOOL_MARKER),
    actionRoute: countOf(content, SAND_MANAGED_ACTION_ROUTE_MARKER),
    resumeMode: countOf(content, SAND_SUBAGENT_RESUME_MODE_MARKER),
    completionWake: countOf(content, SAND_SUBAGENT_COMPLETION_WAKE_MARKER),
    pushContextTimeout: countOf(content, SAND_PUSH_CONTEXT_TIMEOUT_MARKER),
    rulesPreseed: countOf(content, SAND_RULES_PRESEED_MARKER),
    routeHint: countOf(content, ROUTE_HINT_MARKER),
    routeLabel: countOf(content, ROUTE_LABEL_MARKER),
    legacy: countOf(content, LEGACY_SAND_CLIENT_MARKER) + countOf(content, LEGACY_SAND_ELIGIBILITY_MARKER),
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
      d.rulesPreseed +
      d.routeHint +
      d.routeLabel +
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

// 一次完整注入在 3.18.9 / 3.18.25 / 3.19.13 上每个生命周期补丁应命中的次数
// （单点各 1，agentHost/completionWake 在 desktop+glass 各 1 = 2）。
// 注入前预检：缺哪条拒写，绝不半补丁。
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
  directStreamInjection319,
  directStreamInjection319Legacy,
};
