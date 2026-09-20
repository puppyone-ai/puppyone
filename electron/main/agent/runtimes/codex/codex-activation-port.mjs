import { parseCodexVersion, compareVersions, MIN_SUPPORTED_CODEX_VERSION } from "./codex-discovery.mjs";
import { inspectCodexProtocol } from "../../connections/probes/codex-local-probe.mjs";

export function createCodexActivationPort({ inspectProtocol = inspectCodexProtocol } = {}) {
  return {
    async verifyInstallation(context) {
      const result = await context.run(["--version"]);
      const version = parseCodexVersion(`${result.stdout}\n${result.stderr}`);
      if (result.code !== 0 || !version || compareVersions(version, MIN_SUPPORTED_CODEX_VERSION) < 0) throw new Error("Unsupported Codex version.");
    },
    async authentication(context) {
      const result = await context.run(["login", "status"]);
      const output = `${result.stdout}\n${result.stderr}`;
      if (/not logged in|not authenticated/iu.test(output)) return "signed-out";
      if (result.code === 0 && /logged in|authenticated/iu.test(output)) return "signed-in";
      return "unknown";
    },
    async login(context) {
      const result = await context.run(["login"], { timeoutMs: 10 * 60_000 });
      if (result.code !== 0) throw new Error("Codex login did not complete.");
    },
    async verifyReady(context) {
      await context.assertIdentity();
      const result = await inspectProtocol({ candidate: context.candidate, env: context.env,
        workspaceRoot: context.cwd, appVersion: context.appVersion, signal: context.signal });
      context.signal.throwIfAborted();
      if (!result.protocolCompatible || result.authentication !== "signed-in") throw new Error("Codex verification failed.");
    },
  };
}
