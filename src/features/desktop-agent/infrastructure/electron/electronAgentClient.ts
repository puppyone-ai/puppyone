import { readAgentOperationFailure } from "../../../../../shared/agent-contract/operation-error.mjs";
import { AgentOperationError } from "../../application/agent-error";
import type { AgentClientPort, AgentClientProvider } from "../../application/AgentClientPort";

const clients = new WeakMap<object, AgentClientPort>();

/** The only Agent feature module that reads the Electron window bridge. */
export const getElectronAgentClient: AgentClientProvider = () => {
  const bridge = window.puppyoneDesktop;
  if (!bridge) return undefined;
  const cached = clients.get(bridge);
  if (cached) return cached;
  const methods = Object.fromEntries(Object.entries(bridge).map(([name, method]) => [name,
    typeof method === "function" && name.includes("Agent") && !name.startsWith("on")
      ? (...args: unknown[]) => Promise.resolve((method as (...values: unknown[]) => unknown)(...args)).then(value => {
          const failure = readAgentOperationFailure(value);
          if (failure) throw new AgentOperationError(failure);
          return value;
        })
      : method,
  ]));
  const client = {
    ...methods,
    // `agent:providers-discover` is the stable IPC compatibility name. The
    // feature-facing port uses product-accurate runtime vocabulary.
    discoverAgentRuntimes: methods.discoverAgentProviders,
  } as unknown as AgentClientPort;
  clients.set(bridge, client);
  return client;
};

export function getElectronFilePath(file: File) {
  return window.puppyoneDesktop?.getPathForFile?.(file) || null;
}

/** Routes Agent-authored external links through the Main-owned URL policy. */
export function openExternalAgentUrl(href: string) {
  const openExternalUrl = window.puppyoneDesktop?.openExternalUrl;
  if (!openExternalUrl) return;
  void openExternalUrl(href).catch(() => {});
}
