import { readAgentOperationFailure } from "../../../../../shared/agent-contract/operation-error.mjs";
import { AgentOperationError } from "../../application/agent-error";
import type { AgentClientPort, AgentClientProvider } from "../../application/AgentClientPort";
import type { ProjectSessionContext } from "../../../../../shared/project-session-contract/types";

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

/** A project-owned client captures its generation once, including deferred commands. */
export function createProjectAgentClientProvider(context: ProjectSessionContext, getClient: AgentClientProvider = getElectronAgentClient): AgentClientProvider {
  let source: AgentClientPort | undefined;
  let client: AgentClientPort | undefined;
  const instances = new Map<string, string>();
  return () => {
    const current = getClient();
    if (!current) return undefined;
    if (source === current && client) return client;
    source = current;
    client = Object.fromEntries(Object.entries(current).map(([name, method]) => [name,
      typeof method === "function" && !name.startsWith("on")
        ? (request: Record<string, unknown> = {}) => {
          const input = { ...request, projectContext: context,
            ...(typeof request.sessionId === "string" && !request.instanceId && instances.has(request.sessionId) ? { instanceId: instances.get(request.sessionId) } : {}),
          };
          return Promise.resolve(method(input)).then((value: unknown) => {
            const result = value as { session?: { id: string; instanceId?: string }; snapshot?: { session?: { id: string; instanceId?: string } } } | null;
            const session = result?.session ?? result?.snapshot?.session;
            if (session?.instanceId) instances.set(session.id, session.instanceId);
            return value;
          });
        }
        : method,
    ])) as unknown as AgentClientPort;
    return client;
  };
}

/** Routes Agent-authored external links through the Main-owned URL policy. */
export function openExternalAgentUrl(href: string) {
  const openExternalUrl = window.puppyoneDesktop?.openExternalUrl;
  if (!openExternalUrl) return;
  void openExternalUrl(href).catch(() => {});
}
