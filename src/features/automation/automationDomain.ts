import type { DesktopCloudSynchronizeBinding } from "../../lib/cloudApi";

/** A source step carries its real resource identity, never an Access ID. */
export type CloudAutomationRow = {
  id: string;
  resourceKind: "synchronize";
  binding: DesktopCloudSynchronizeBinding;
};

export function normalizeAutomationProviderKey(provider: string) {
  return provider.trim().toLowerCase().replace(/-/g, "_");
}

export function buildCloudAutomationRows({
  projectId,
  bindings,
}: {
  projectId: string;
  bindings: readonly DesktopCloudSynchronizeBinding[];
}): CloudAutomationRow[] {
  return bindings.filter((binding) => binding.project_id === projectId).map((binding) => ({
    id: `synchronize:${projectId}:${binding.id}`,
    resourceKind: "synchronize",
    binding,
  }));
}

export function cloudAutomationRowMatchesProvider(
  row: CloudAutomationRow,
  providerFilter: string | null,
) {
  if (!providerFilter) return true;
  return normalizeAutomationProviderKey(row.binding.provider) === normalizeAutomationProviderKey(providerFilter);
}

export function getAutomationBindingName(binding: DesktopCloudSynchronizeBinding) {
  const source = binding.config.source;
  return source && typeof source === "object" && "resource_name" in source && typeof source.resource_name === "string"
    ? source.resource_name
    : "";
}

export function getAutomationBindingPath(binding: DesktopCloudSynchronizeBinding) {
  // path is the persisted destination; do not infer it from an unrelated Scope.
  return binding.path?.replace(/^\/+|\/+$/g, "") || "";
}

/** The Cloud web app still exposes its established workflow route. */
export function getCloudAutomationWebPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/workflows`;
}
