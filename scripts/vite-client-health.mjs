export const VITE_CLIENT_RUNTIME_PLACEHOLDERS = Object.freeze([
  "__HMR_CONFIG_NAME__",
  "__BASE__",
  "__SERVER_HOST__",
  "__HMR_PROTOCOL__",
  "__HMR_PORT__",
  "__HMR_HOSTNAME__",
  "__HMR_BASE__",
  "__HMR_DIRECT_TARGET__",
  "__HMR_TIMEOUT__",
  "__WS_TOKEN__",
  "__BUNDLED_DEV__",
  "__SERVER_FORWARD_CONSOLE__",
  "__HMR_ENABLE_OVERLAY__",
]);

export function findUnresolvedViteClientPlaceholders(source) {
  if (typeof source !== "string") return [];

  return VITE_CLIENT_RUNTIME_PLACEHOLDERS.filter((placeholder) =>
    source.includes(placeholder),
  );
}

export async function probeViteDevServer(
  devUrl,
  { fetchImpl = globalThis.fetch, signal, instanceToken } = {},
) {
  try {
    if (instanceToken) {
      const ownership = await fetchImpl(new URL("/__puppyone_dev_instance", devUrl), { cache: "no-store", signal });
      if (!ownership.ok || await ownership.text() !== instanceToken) {
        return { ready: false, reason: "different-instance" };
      }
    }
    const documentResponse = await fetchImpl(devUrl, {
      cache: "no-store",
      signal,
    });
    if (!documentResponse.ok) {
      return {
        ready: false,
        reason: "document-http-error",
        status: documentResponse.status,
      };
    }

    const clientUrl = new URL("/@vite/client", devUrl);
    const clientResponse = await fetchImpl(clientUrl, {
      cache: "no-store",
      signal,
    });
    if (!clientResponse.ok) {
      return {
        ready: false,
        reason: "client-http-error",
        status: clientResponse.status,
      };
    }

    const clientSource = await clientResponse.text();
    const placeholders = findUnresolvedViteClientPlaceholders(clientSource);
    if (placeholders.length > 0) {
      return {
        ready: false,
        reason: "unresolved-client-placeholders",
        placeholders,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: "unreachable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
