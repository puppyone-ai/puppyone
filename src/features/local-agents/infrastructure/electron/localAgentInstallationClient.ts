export function discoverLocalAgentInstallations(refresh: boolean, requestId: string): Promise<unknown> {
  const discover = window.puppyoneDesktop?.discoverLocalAgentInstallations;
  if (!discover) return Promise.reject(new Error("Local Agent installation discovery is unavailable."));
  return discover({ refresh, requestId });
}

export function subscribeToLocalAgentInstallationProgress(callback: (event: unknown) => void): () => void {
  const subscribe = window.puppyoneDesktop?.onLocalAgentInstallationProgress;
  return typeof subscribe === "function" ? subscribe(callback) : () => {};
}

export function subscribeToLocalAgentInstallationChanges(callback: (snapshot: unknown) => void): () => void {
  const subscribe = window.puppyoneDesktop?.onLocalAgentInstallationsChanged;
  return typeof subscribe === "function" ? subscribe(callback) : () => {};
}
