import type { CapabilityPrincipal } from "../security/capabilityPrincipal";
import {
  evaluateMarkdownAssetHref,
  isBrokerSafeResolvedAssetUrl,
  MARKDOWN_ASSET_MAX_IN_FLIGHT,
  type MarkdownAssetPolicyContext,
  type MarkdownAssetKind,
  type MarkdownRemoteAssetPolicy,
} from "../policy/markdownAssetPolicy";

export type AssetBrokerRequest = {
  kind: MarkdownAssetKind;
  principal: CapabilityPrincipal;
  sourcePath: string;
  href: string;
  signal?: AbortSignal;
  workspaceRoot?: string | null;
};

export type AssetBrokerHandle = {
  id: string;
  url: string;
  mimeType: string | null;
  kind: MarkdownAssetKind;
  principal: CapabilityPrincipal;
  revoke(): void;
  subscribe?: (listener: (url: string | null) => void) => () => void;
};

export type ResolvedAssetUrl = {
  url: string;
  revoke?: () => void | Promise<void>;
  subscribe?: (listener: (url: string | null) => void) => () => void;
};

export type AssetUrlResolverResult = string | ResolvedAssetUrl | null;

export type AssetUrlResolver = (
  documentPath: string,
  href: string,
  signal?: AbortSignal,
) => AssetUrlResolverResult | Promise<AssetUrlResolverResult>;

export type AssetBrokerOptions = {
  workspaceRoot?: string | null;
  resolveTimeoutMs?: number;
  remotePolicy?: Partial<Record<MarkdownAssetKind, MarkdownRemoteAssetPolicy>>;
};

const DEFAULT_RESOLVE_TIMEOUT_MS = 15_000;

/**
 * Narrow asset capability broker. Workspace-relative non-executable assets are
 * part of the broad-safe profile, but adapters never receive raw file:// URLs.
 * Policy evaluation happens before any host resolver call.
 */
export function createAssetBroker(
  resolveAssetUrl: AssetUrlResolver | null,
  options: AssetBrokerOptions = {},
) {
  const handles = new Map<string, AssetBrokerHandle>();
  let sequence = 0;
  let inFlight = 0;
  let disposed = false;
  const queue: Array<{
    resolve(acquired: boolean): void;
    signal?: AbortSignal;
    abortListener?: () => void;
  }> = [];
  const defaultWorkspaceRoot = options.workspaceRoot ?? null;
  const remotePolicy: Readonly<Record<MarkdownAssetKind, MarkdownRemoteAssetPolicy>> = {
    image: options.remotePolicy?.image ?? "deny",
    video: options.remotePolicy?.video ?? "deny",
  };
  const resolveTimeoutMs = Math.max(1, options.resolveTimeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS);

  const acquire = async (signal?: AbortSignal): Promise<boolean> => {
    if (disposed || signal?.aborted) return false;
    if (inFlight < MARKDOWN_ASSET_MAX_IN_FLIGHT) {
      inFlight += 1;
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const waiter: (typeof queue)[number] = { resolve, signal };
      queue.push(waiter);
      waiter.abortListener = () => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        resolve(false);
      };
      signal?.addEventListener("abort", waiter.abortListener, { once: true });
    });
  };

  const release = () => {
    inFlight = Math.max(0, inFlight - 1);
    while (queue.length > 0) {
      const waiter = queue.shift();
      if (!waiter || waiter.signal?.aborted || disposed) {
        if (waiter?.abortListener) waiter.signal?.removeEventListener("abort", waiter.abortListener);
        waiter?.resolve(false);
        continue;
      }
      if (waiter.abortListener) waiter.signal?.removeEventListener("abort", waiter.abortListener);
      inFlight += 1;
      waiter.resolve(true);
      break;
    }
  };

  const runExclusive = async <T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T | null> => {
    if (!(await acquire(signal))) return null;
    try {
      return await task();
    } finally {
      release();
    }
  };

  return {
    async resolve(request: AssetBrokerRequest): Promise<AssetBrokerHandle | null> {
      if (disposed || request.signal?.aborted) return null;
      if (request.principal.purpose !== "asset-read") return null;
      if (request.principal.documentPath !== request.sourcePath) return null;

      const policyContext: MarkdownAssetPolicyContext = {
        documentPath: request.sourcePath,
        workspaceRoot: request.workspaceRoot ?? defaultWorkspaceRoot,
        remotePolicy: remotePolicy[request.kind],
      };
      const policy = evaluateMarkdownAssetHref(request.href, policyContext, request.kind);
      if (!policy.ok) return null;

      if (policy.kind === "safe-direct" || policy.kind === "data-image") {
        return registerHandle(
          policy.url,
          policy.mimeType,
          request.kind,
          request.principal,
          request.signal,
        );
      }

      if (!resolveAssetUrl) return null;

      return runExclusive(request.signal, async () => {
        if (request.signal?.aborted) return null;
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(request.signal?.reason);
        request.signal?.addEventListener("abort", abortFromCaller, { once: true });
        const timeout = globalThis.setTimeout(() => controller.abort("asset-resolve-timeout"), resolveTimeoutMs);
        try {
          const resolverPromise = Promise.resolve(
            resolveAssetUrl(request.sourcePath, request.href, controller.signal),
          ).then((resolved) => {
            if (controller.signal.aborted) {
              revokeResolvedAsset(resolved);
              return null;
            }
            return resolved;
          });
          const abortPromise = new Promise<null>((resolve) => {
            controller.signal.addEventListener("abort", () => resolve(null), { once: true });
          });
          const resolved = await Promise.race([resolverPromise, abortPromise]);
          if (!resolved || controller.signal.aborted || request.signal?.aborted) {
            revokeResolvedAsset(resolved);
            return null;
          }
          const resolvedUrl = typeof resolved === "string" ? resolved : resolved.url;
          if (!isBrokerSafeResolvedAssetUrl(resolvedUrl, request.kind)) {
            revokeResolvedAsset(resolved);
            return null;
          }
          return registerHandle(
            resolvedUrl,
            policy.mimeType,
            request.kind,
            request.principal,
            request.signal,
            typeof resolved === "string" ? undefined : resolved.revoke,
            typeof resolved === "string" ? undefined : resolved.subscribe,
          );
        } finally {
          globalThis.clearTimeout(timeout);
          request.signal?.removeEventListener("abort", abortFromCaller);
        }
      });
    },

    revokePrincipal(principal: CapabilityPrincipal) {
      for (const [id, handle] of Array.from(handles.entries())) {
        if (samePrincipalScope(handle.principal, principal)) {
          handle.revoke();
          handles.delete(id);
        }
      }
    },

    revokeExecutionSession(executionSessionId: string) {
      for (const [id, handle] of Array.from(handles.entries())) {
        if (handle.principal.executionSessionId === executionSessionId) {
          handle.revoke();
          handles.delete(id);
        }
      }
    },

    disposeAll() {
      disposed = true;
      for (const waiter of queue.splice(0)) {
        if (waiter.abortListener) waiter.signal?.removeEventListener("abort", waiter.abortListener);
        waiter.resolve(false);
      }
      for (const handle of handles.values()) handle.revoke();
      handles.clear();
    },
  };

  function registerHandle(
    url: string,
    mimeType: string | null,
    kind: MarkdownAssetKind,
    principal: CapabilityPrincipal,
    signal?: AbortSignal,
    revokeResolved?: () => void | Promise<void>,
    subscribeResolved?: ResolvedAssetUrl["subscribe"],
  ): AssetBrokerHandle {
    const id = `asset:${++sequence}`;
    const abortListener = () => handle.revoke();
    const subscriptions = new Set<() => void>();
    const handle: AssetBrokerHandle = {
      id,
      url,
      mimeType,
      kind,
      principal,
      subscribe: subscribeResolved ? (listener) => {
        const stop = subscribeResolved((nextUrl) => {
          if (!handles.has(id)) return;
          if (nextUrl && !isBrokerSafeResolvedAssetUrl(nextUrl, kind)) return;
          handle.url = nextUrl ?? "";
          listener(nextUrl);
        });
        subscriptions.add(stop);
        return () => { subscriptions.delete(stop); stop(); };
      } : undefined,
      revoke() {
        if (!handles.has(id)) return;
        handles.delete(id);
        signal?.removeEventListener("abort", abortListener);
        subscriptions.forEach((stop) => stop());
        subscriptions.clear();
        if (revokeResolved) {
          try {
            void Promise.resolve(revokeResolved()).catch(() => undefined);
          } catch {
            // Revocation is best-effort at the transport boundary; the handle
            // is already unusable in this renderer scope.
          }
        }
        if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
      },
    };
    handles.set(id, handle);
    signal?.addEventListener("abort", abortListener, { once: true });
    return handle;
  }
}

function revokeResolvedAsset(resolved: AssetUrlResolverResult | undefined) {
  if (!resolved || typeof resolved === "string" || !resolved.revoke) return;
  try {
    void Promise.resolve(resolved.revoke()).catch(() => undefined);
  } catch {
    // Resolver cleanup cannot make an already rejected URL authoritative.
  }
}

function samePrincipalScope(left: CapabilityPrincipal, right: CapabilityPrincipal): boolean {
  return (
    left.editorViewId === right.editorViewId &&
    left.workspaceId === right.workspaceId &&
    left.documentPath === right.documentPath &&
    left.documentRevision === right.documentRevision &&
    left.purpose === right.purpose &&
    left.executionSessionId === right.executionSessionId
  );
}

export type AssetBroker = ReturnType<typeof createAssetBroker>;
