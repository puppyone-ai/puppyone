import { CodexAppServerAdapter } from "./codex-app-server-adapter.mjs";
import { createCodexDiscovery } from "./codex-discovery.mjs";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_MANIFEST,
} from "./codex-identity.mjs";

export { CODEX_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_MANIFEST } from "./codex-identity.mjs";

export function createCodexRuntimeDefinition({
  appVersion = "0.0.0",
  discovery = createCodexDiscovery(),
  adapterFactory = (options) => new CodexAppServerAdapter(options),
} = {}) {
  return {
    manifest: CODEX_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
      ...options,
      executablePath: readiness.executablePath,
      environment: readiness.environment,
      appVersion,
    }),
  };
}
