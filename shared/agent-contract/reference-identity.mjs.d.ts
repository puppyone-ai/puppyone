export type AgentReferenceMentionIdentity = {
  kind?: "workspace-entry" | "staged-attachment" | string;
  relativePath?: string;
  workspaceName?: string;
  displayName?: string;
  name?: string;
};

export function normalizeAgentWorkspaceRelativePath(value: unknown): string | null;
export function agentReferenceMentionLabel(reference: AgentReferenceMentionIdentity | null | undefined): string;
export function agentReferenceMentionText(reference: AgentReferenceMentionIdentity | null | undefined): string;
export const agentReferenceIdentityLimits: Readonly<{
  maxWorkspaceRelativePathLength: number;
  maxReferenceLabelLength: number;
}>;
