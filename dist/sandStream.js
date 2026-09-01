// Sand Stream 补丁（对齐 sand_stream_installer 1.2.2 / Cursor 3.18.9）
// 注入与卸载都走同一套标记，兼容该脚本装过的客户端。
const crypto = require("crypto");
const path = require("path");

const SAND_CLIENT_MARKER = "/*SAND_CLIENT_MODE_V1*/";
const SAND_CLIENT_EXISTING_MARKER = "/*SAND_CLIENT_EXISTING_V1*/";
const SAND_ELIGIBILITY_MARKER = "/*SAND_ELIGIBILITY_MODE_V1*/";
const SAND_MANAGED_LOCAL_ROUTE_MARKER = "/*SAND_MANAGED_LOCAL_ROUTE_V1*/";
const SAND_DIRECT_STREAM_MARKER = "/*SAND_DIRECT_INFERENCE_STREAM_V1*/";
const SAND_AGENT_HOST_ENABLEMENT_MARKER = "/*SAND_AGENT_HOST_ENABLEMENT_V1*/";
const SAND_LOCAL_RUNTIME_LOAD_MARKER = "/*SAND_LOCAL_RUNTIME_LOAD_V1*/";
const SAND_AGENT_HOST_IDENTITY_MARKER = "/*SAND_AGENT_HOST_IDENTITY_V1*/";
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

const AGENT_HOST_IDENTITY_ORIGINAL = 'clientIdentity:{clientType:"ide"}';
const AGENT_HOST_IDENTITY_PATCHED =
  'clientIdentity:{clientType:"sand"' + SAND_AGENT_HOST_IDENTITY_MARKER + "}";

const DIRECT_STREAM_ANCHOR =
  "function hre(e){return t=>{return n=this,o=void 0,s=function*(){";

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
    direct_stream: 0,
    agent_host_enablement: 0,
    agent_host_identity: 0,
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
    s.direct_stream +
    s.agent_host_enablement +
    s.agent_host_identity
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
    "resolvedModelMetadata:nre(a,o),finish:()=>Promise.resolve()}}}"
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

  const identityCount = next.split(AGENT_HOST_IDENTITY_ORIGINAL).length - 1;
  if (identityCount) {
    next = next.split(AGENT_HOST_IDENTITY_ORIGINAL).join(AGENT_HOST_IDENTITY_PATCHED);
    stats.agent_host_identity += identityCount;
  }

  const injection = directStreamInjection();
  if (!next.includes(SAND_DIRECT_STREAM_MARKER) && next.includes(DIRECT_STREAM_ANCHOR)) {
    next = next.replace(DIRECT_STREAM_ANCHOR, DIRECT_STREAM_ANCHOR + injection);
    stats.direct_stream += 1;
  }

  if (!next.includes(SAND_AGENT_HOST_ENABLEMENT_MARKER)) {
    next = next.replace(AGENT_HOST_ENABLEMENT_RE, (full, left, variable, comma) => {
      stats.agent_host_enablement += 1;
      return variable + "=!0;" + SAND_AGENT_HOST_ENABLEMENT_MARKER + left + variable + comma;
    });
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

  const runtimeCount = next.split(LOCAL_RUNTIME_LOAD_PATCHED).length - 1;
  if (runtimeCount) {
    next = next.split(LOCAL_RUNTIME_LOAD_PATCHED).join(LOCAL_RUNTIME_LOAD_ORIGINAL);
    stats.local_runtime_load += runtimeCount;
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

  return { content: next, stats };
}

function detectSand(content) {
  return {
    client: (content.split(SAND_CLIENT_MARKER).length - 1) + (content.split(SAND_CLIENT_EXISTING_MARKER).length - 1),
    eligibility: content.split(SAND_ELIGIBILITY_MARKER).length - 1,
    managedLocal: content.split(SAND_MANAGED_LOCAL_ROUTE_MARKER).length - 1,
    runtimeLoad: content.split(SAND_LOCAL_RUNTIME_LOAD_MARKER).length - 1,
    directStream: content.split(SAND_DIRECT_STREAM_MARKER).length - 1,
    agentHost: content.split(SAND_AGENT_HOST_ENABLEMENT_MARKER).length - 1,
    identity: content.split(SAND_AGENT_HOST_IDENTITY_MARKER).length - 1,
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
      d.directStream +
      d.agentHost +
      d.identity +
      d.legacy >
    0
  );
}

function streamModeInstalled(d) {
  return d.managedLocal > 0 && d.runtimeLoad > 0 && d.directStream > 0 && d.agentHost > 0 && d.identity > 0;
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
  sumStats,
  addStats,
  emptyStats,
  productChecksum,
  updateExtensionHashes,
  syncProductChecksums,
};
