export type CapabilityPurpose =
  | "asset-read"
  | "link-open"
  | "async-render"
  | "transaction-commit"
  | "web-embed";

export type CapabilityPrincipal = {
  editorViewId: string;
  workspaceId: string;
  documentPath: string;
  documentRevision: string;
  purpose: CapabilityPurpose;
  executionSessionId?: string;
};

export type AuthorizationGrant = {
  id: string;
  principal: CapabilityPrincipal;
  capability: "local-active-html" | "external-web-embed" | "remote-asset";
  policyVersion: string;
  revoked: boolean;
};

export type BrokerHandle = {
  id: string;
  principal: CapabilityPrincipal;
  revoke(): void;
};

export function createCapabilityPrincipal(
  partial: Omit<CapabilityPrincipal, "purpose"> & { purpose: CapabilityPurpose },
): CapabilityPrincipal {
  return { ...partial };
}

/**
 * Stable workspace scope for broker principals. Prefer the open document path
 * over a shared literal so grants/revokes do not collide across files.
 */
export function workspaceIdForDocument(documentPath: string): string {
  const trimmed = documentPath.trim();
  return trimmed ? `doc:${trimmed}` : "workspace:anonymous";
}
