import type { Workspace } from "@puppyone/shared-ui";
import { Cloud, FolderClosed } from "lucide-react";

export type ProjectContextAssetKind = "cloud" | "local";

export function resolveProjectContextAssetKind(
  workspace: Pick<Workspace, "puppyoneGitRemote">,
): ProjectContextAssetKind {
  return workspace.puppyoneGitRemote?.projectId ? "cloud" : "local";
}

export function ProjectContextAssetMark({
  className = "",
  kind,
  size = 15,
}: Readonly<{
  className?: string;
  kind: ProjectContextAssetKind;
  size?: number;
}>) {
  const Icon = kind === "cloud" ? Cloud : FolderClosed;
  return (
    <span
      className={`desktop-project-context-asset-mark ${className}`.trim()}
      data-context-asset-kind={kind}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={kind === "cloud" ? 1.8 : 1.65} />
    </span>
  );
}
