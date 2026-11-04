import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocalization } from "@puppyone/localization";
import {
  DisclosureIcon,
  FileGlyphIcon,
  getMatchedExtension,
  Tooltip,
  type FileIconThemeId,
} from "@puppyone/shared-ui";
import type { ExplorerPinnedFile } from "./explorerPins";

/**
 * Pinned files sit above the file tree like pinned browser tabs: always in
 * the same place, one click away, whatever the tree below is showing. The
 * tree itself can fold away under them.
 */
export function ExplorerPinnedFiles({
  files,
  activePath,
  filesCollapsed,
  fileIconTheme,
  onOpen,
  onContextMenu,
  onFilesCollapsedChange,
}: Readonly<{
  files: readonly ExplorerPinnedFile[];
  activePath: string | null;
  filesCollapsed: boolean;
  fileIconTheme: FileIconThemeId;
  onOpen: (file: ExplorerPinnedFile) => void;
  onContextMenu: (file: ExplorerPinnedFile, event: ReactMouseEvent<HTMLElement>) => void;
  onFilesCollapsedChange: (collapsed: boolean) => void;
}>) {
  const { t } = useLocalization();
  if (files.length === 0) return null;

  return (
    <div className="desktop-explorer-pins">
      <div className="desktop-explorer-pin-grid" role="list" aria-label={t("workspace.explorer.pinned")}>
        {files.map((file) => {
          const active = file.path === activePath;
          return (
            <div key={file.path} className="desktop-explorer-pin-item" role="listitem">
              {/* The full name on hover, as the product's tooltip: a pin shows only its start. */}
              <Tooltip content={file.name}>
                <button
                  className="desktop-explorer-pin"
                  type="button"
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onOpen(file)}
                  onContextMenu={(event) => onContextMenu(file, event)}
                >
                  <span className="desktop-explorer-pin-icon">
                    <FileGlyphIcon name={file.name} type={file.type} size={18} theme={fileIconTheme} />
                  </span>
                  <span className="desktop-explorer-pin-label" dir="auto">{getPinnedFileLabel(file.name)}</span>
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
      {/* Only a chevron on a hairline: the tree under it needs no title. */}
      <button
        className="desktop-explorer-files-toggle"
        type="button"
        aria-label={t("workspace.explorer.allFiles")}
        aria-expanded={!filesCollapsed}
        onClick={() => onFilesCollapsedChange(!filesCollapsed)}
      >
        <span className="desktop-explorer-files-toggle-icon">
          <DisclosureIcon expanded={!filesCollapsed} size={12} />
        </span>
        <span className="desktop-explorer-files-toggle-rule" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Same name the tree shows: known extensions are left off. */
function getPinnedFileLabel(name: string): string {
  const extension = getMatchedExtension(name);
  if (!extension) return name;
  const primary = name.slice(0, -(extension.length + 1));
  return primary || name;
}
