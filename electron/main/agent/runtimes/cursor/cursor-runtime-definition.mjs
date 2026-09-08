import { createCursorDiscovery } from "./cursor-discovery.mjs";
import { CursorAcpAdapter } from "./cursor-acp-adapter.mjs";
import { CURSOR_RUNTIME_DESCRIPTOR, CURSOR_RUNTIME_MANIFEST } from "./cursor-identity.mjs";

export { CURSOR_RUNTIME_DESCRIPTOR, CURSOR_RUNTIME_MANIFEST } from "./cursor-identity.mjs";

export function createCursorRuntimeDefinition({
  discovery = createCursorDiscovery(),
  logger = console,
  appVersion = "0.0.0",
  adapterFactory = (options) => new CursorAcpAdapter(options),
} = {}) {
  return {
    manifest: CURSOR_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
        ...options,
        readiness,
        appVersion,
        logger,
        runtimeDescriptor: CURSOR_RUNTIME_DESCRIPTOR,
    }),
  };
}
