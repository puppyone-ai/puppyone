export const CLOUD_WORKSPACE_SECTIONS = [
  "overview",
  "cloud-team",
  "cloud-billing",
  "contents",
  "branches",
  "access",
  "mcp-cli",
  "git-sync",
  "team",
  "settings",
] as const;

export type CloudWorkspaceSection = (typeof CLOUD_WORKSPACE_SECTIONS)[number];
