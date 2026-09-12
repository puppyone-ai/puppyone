import { CodexAppServerAdapter } from "../../../../../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs";
import { createCodexDiscovery } from "../../../../../electron/main/agent/runtimes/codex/codex-discovery.mjs";

if (process.env.RUN_CODEX_AGENT_SMOKE !== "1") {
  console.log("Skipped. Set RUN_CODEX_AGENT_SMOKE=1 to initialize the installed Codex app-server without starting a turn.");
  process.exit(0);
}

const discovery = createCodexDiscovery();
const readiness = await discovery.discover({ refresh: true });
if (readiness.status !== "ready") {
  throw new Error(readiness.message || "Codex is not ready.");
}

const adapter = new CodexAppServerAdapter({
  executablePath: readiness.executablePath,
  environment: readiness.environment,
  workspaceRoot: process.cwd(),
  appVersion: "smoke",
});

try {
  const inspection = await adapter.inspect();
  console.log(JSON.stringify({
    status: "ready",
    version: readiness.version,
    authenticated: Boolean(inspection.account?.account) || !inspection.account?.requiresOpenaiAuth,
    modelCount: inspection.models.length,
  }, null, 2));
} finally {
  adapter.dispose();
}
