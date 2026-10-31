import type { CapabilityPrincipal } from "../security/capabilityPrincipal";

export const MARKDOWN_TRUST_POLICY_VERSION = "2026-07-10";

export type MarkdownTrustCapability = "local-active-html" | "external-web-embed" | "remote-asset";

export type DocumentTrustContext = {
  workspaceId: string;
  documentPath: string;
  provenance: "local-workspace" | "imported" | "synced" | "unknown";
  explicitGrants: readonly MarkdownTrustCapability[];
};

export type AuthorizationGrant = {
  id: string;
  principal: CapabilityPrincipal;
  capability: MarkdownTrustCapability;
  policyVersion: string;
  revoked: boolean;
};

/**
 * Provenance alone never enables active HTML. An explicit grant is required
 * and remains independent of document revision / execution sessions.
 */
export function evaluateAuthorizationGrant(
  context: DocumentTrustContext,
  principal: CapabilityPrincipal,
  capability: MarkdownTrustCapability,
): AuthorizationGrant | null {
  if (!context.explicitGrants.includes(capability)) return null;
  if (context.workspaceId !== principal.workspaceId) return null;
  if (context.documentPath && principal.documentPath && context.documentPath !== principal.documentPath) {
    return null;
  }

  return {
    id: `grant:${capability}:${principal.workspaceId}:${principal.documentPath}`,
    principal,
    capability,
    policyVersion: MARKDOWN_TRUST_POLICY_VERSION,
    revoked: false,
  };
}

export function createDocumentTrustContext(partial: {
  workspaceId: string;
  documentPath: string;
  provenance?: DocumentTrustContext["provenance"];
  explicitGrants?: readonly MarkdownTrustCapability[];
}): DocumentTrustContext {
  return {
    workspaceId: partial.workspaceId,
    documentPath: partial.documentPath,
    provenance: partial.provenance ?? "unknown",
    explicitGrants: partial.explicitGrants ?? [],
  };
}

export function allowsLocalActiveHtml(context: DocumentTrustContext, principal: CapabilityPrincipal): boolean {
  const grant = evaluateAuthorizationGrant(context, principal, "local-active-html");
  return Boolean(grant && !grant.revoked);
}
