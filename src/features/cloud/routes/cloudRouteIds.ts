export const CLOUD_WORKSPACE_SECTIONS = [
  "initialize",
  "cloud-team",
  "cloud-billing",
  "contents",
  "share",
  "project",
  "history",
  "branches",
  "access",
  "cli",
  "mcp",
  "git-sync",
  "team",
  "settings",
] as const;

export type CloudWorkspaceSection = (typeof CLOUD_WORKSPACE_SECTIONS)[number];
