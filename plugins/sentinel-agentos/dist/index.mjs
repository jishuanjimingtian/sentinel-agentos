import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { sentinelPlugin } from "sentinel-agentos";
import * as path from "node:path";
let plugin = null;
let pluginStartTime = 0;
let workspaceRoot = "";
let pluginApi = null;
function detectWorkspace() {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return path.join(home, ".openclaw", "workspace");
}
function log(msg) {
  const text = `[Sentinel] ${msg}`;
  if (pluginApi?.logger?.info) pluginApi.logger.info(text);
  else console.log(text);
}
function warn(msg) {
  const text = `[Sentinel] ${msg}`;
  if (pluginApi?.logger?.warn) pluginApi.logger.warn(text);
  else console.warn(text);
}
const entry = definePluginEntry({
  id: "sentinel-agentos",
  name: "Sentinel AgentOS",
  description: "v1.5 \u667A\u80FD\u5BA1\u6279: \u6838\u5FC3\u5305\u5B8C\u6574\u529F\u80FD\u6620\u5C04",
  register(api) {
    pluginApi = api;
    workspaceRoot = detectWorkspace();
    try {
      plugin = sentinelPlugin({ workspaceRoot });
      pluginStartTime = Date.now();
      log(`\u6838\u5FC3\u5305\u5DF2\u52A0\u8F7D (\u767D\u540D\u5355 ${plugin.whitelist.getRules().length} \u6761\u89C4\u5219)`);
    } catch (e) {
      warn(`\u6838\u5FC3\u5305\u52A0\u8F7D\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    api.on("before_prompt_build", async (event) => {
      try {
        if (event?.sessionId) {
          plugin.sessionStart(event.sessionId);
        }
      } catch {
      }
    });
    api.on("before_tool_call", async (event) => {
      const { toolName, params } = event;
      const result = plugin.onBeforeTool(toolName, params || {});
      if (result.whitelisted) {
        return;
      }
      if (result.confidenceDecision === "auto-approve" || result.confidenceDecision === "silent-allow") {
        return;
      }
      const isBlock = result.confidenceDecision === "block";
      const isStrict = result.confidenceDecision === "strict-confirm";
      return {
        requireApproval: {
          title: isBlock ? "Sentinel \u62E6\u622A (\u7F6E\u4FE1\u5EA6\u8FC7\u4F4E)" : isStrict ? "\u64CD\u4F5C\u9700\u4E25\u683C\u786E\u8BA4" : "\u64CD\u4F5C\u9700\u8981\u786E\u8BA4",
          description: [
            `\u7F6E\u4FE1\u5EA6: ${result.confidence ?? "?"}/100 (${result.confidenceDecision ?? "?"})`,
            `\u4FE1\u7528\u7B49\u7EA7: L${result.creditLevel ?? 1}`,
            result.reason ? `\u539F\u56E0: ${result.reason}` : "",
            `\u64CD\u4F5C: ${toolName}`
          ].filter(Boolean).join("\n"),
          severity: isBlock || isStrict ? "critical" : "warning",
          timeoutMs: isStrict ? 12e4 : 6e4,
          timeoutBehavior: "deny"
        }
      };
    }, { priority: 100 });
    api.on("after_tool_call", async (event) => {
      const { toolName, params, error, startedAt, agentId } = event;
      if (!plugin) return;
      setImmediate(() => {
        try {
          const afterResult = plugin.onAfterTool(
            toolName,
            params || {},
            { error: error ? String(error) : void 0, ok: !error },
            startedAt || Date.now(),
            { retryCount: 0, wasSelfCorrected: false, hadTimeout: false, userAccepted: !error, resultWasUsed: !error }
          );
          log(`\u5BA1\u8BA1: ${toolName} \u2192 ${afterResult.verifyDetail} (L${afterResult.creditLevel})`);
        } catch (e) {
          warn(`after_tool_call \u5F02\u5E38: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    }, { priority: 90 });
    api.on("session_start", async (event) => {
      const sid = event?.sessionId || `session_${Date.now()}`;
      if (!plugin) return;
      setImmediate(() => {
        try {
          plugin.sessionStart(sid);
        } catch {
        }
      });
    });
    api.on("session_end", async (event) => {
      const sid = event?.sessionId;
      if (!plugin || !sid) return;
      setImmediate(() => {
        try {
          const summary = plugin.sessionEnd(sid);
          if (summary) {
            log(`\u4F1A\u8BDD\u7ED3\u675F: ${summary.summary}`);
          }
        } catch (e) {
          warn(`session_end \u5F02\u5E38: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    });
    setInterval(() => {
      if (!plugin) return;
      try {
        const evolution = plugin.wrapped.aos.scoring.behavior.evolve();
        plugin.wrapped.aos.scoring.credit.applyInactivityDecay();
        if (evolution.evolved > 0) log(`\u5468\u671F\u81EA\u8FDB\u5316: ${evolution.evolved} \u6761\u8FC7\u671F\u6E05\u7406`);
      } catch {
      }
    }, 30 * 60 * 1e3).unref();
    const status = plugin.healthCheck();
    log(`\u2705 \u6838\u5FC3\u5305\u5B8C\u6574\u6620\u5C04\u5DF2\u6CE8\u518C`);
    log(`\u767D\u540D\u5355\u89C4\u5219: ${plugin.whitelist.getRules().length} \u6761`);
    log(`\u914D\u7F6E\u76EE\u5F55: ${workspaceRoot}`);
  }
});
var index_default = entry;
export {
  index_default as default
};
//# sourceMappingURL=index.mjs.map
