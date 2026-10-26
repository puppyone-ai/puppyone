import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { ExplorerTree, ExplorerTreeSkeleton, FilePreview, createResourceUri, getFileSemanticKind, type DataNode, type DocumentDataNode } from "@puppyone/shared-ui";
import { selectFileIconTheme, useDesktopPreference } from "../../../preferencesStore";
import { DEFAULT_EXPLORER_WIDTH } from "../../../lib/desktopPaneLayout";
import type { CloudWorkspaceShareResource } from "./cloudWorkspaceShareResource";
// The illustration carries its own styles: both share screens render it, and
// neither of them should have to know which stylesheet it needs.
import "./workspace-share.css";

export type SharePreviewEntry = { name: string; type: string };
const NO_EXPANDED_FOLDERS: ReadonlySet<string> = new Set();
const ignoreSelection = () => {};

/** The product's actual Explorer and read-only Viewer, uniformly reduced as an inert illustration. */
export function CloudWorkspaceSharePreview({ entries, file }: {
  entries?: readonly SharePreviewEntry[];
  file?: CloudWorkspaceShareResource["file"];
}) {
  const { t } = useLocalization();
  const fileIconTheme = useDesktopPreference(selectFileIconTheme);
  const nodes = useMemo(() => {
    const visible = entries?.filter(entry => ![".DS_Store", "Thumbs.db", ".git"].includes(entry.name)).slice(0, 8) ?? [];
    if (file && !visible.some(entry => entry.name === file.name)) visible.push({ name: file.name, type: file.type });
    return visible.map((entry, index): DataNode => ({
      id: `share-preview-${index}`,
      name: entry.name,
      path: createResourceUri({ scheme: "puppyone-preview", authority: "share", path: entry.name }),
      type: entry.type === "folder" ? "folder" : getFileSemanticKind(entry.name),
      children: entry.type === "folder" ? [] : undefined,
    }));
  }, [entries, file]);
  const document = file ? nodes.find((node): node is DocumentDataNode => node.name === file.name && node.type !== "folder") : undefined;
  const content = file?.content?.content ?? "";
  return <section className="desktop-cloud-share-preview">
    <div className="desktop-cloud-share-preview-window" aria-hidden="true" {...{ inert: "" }}>
      <div className="desktop-cloud-share-preview-canvas desktop-data-workspace-wrap data-content">
        <div className="desktop-cloud-share-preview-files data-explorer-rail" style={{ width: DEFAULT_EXPLORER_WIDTH }}>
          {nodes.length ? <ExplorerTree nodes={nodes} activePath={document?.path ?? null} expandedPaths={NO_EXPANDED_FOLDERS}
            showRoot={false} fileIconTheme={fileIconTheme} canMoveNodes={false} onSelectNode={ignoreSelection} /> : <ExplorerTreeSkeleton loadingLabel={t("cloud.common.loading")} />}
        </div>
        <div className="desktop-cloud-share-preview-document">
          <FilePreview node={document ?? null} fileContent={document ? { path: document.path, name: document.name, type: document.type, content } : null}
            documentSourceKind="cloud" workspaceId="share-preview" fileIconTheme={fileIconTheme}
            showHeader={false} hideSourceView />
        </div>
      </div>
    </div>
  </section>;
}
