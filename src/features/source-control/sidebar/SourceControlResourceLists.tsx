import {
  STANDARD_CONTROL_SIZE,
  VirtualSidebarList,
  shouldVirtualizeSidebarList,
  type FileIconThemeId,
  useCssPixelCustomProperty,
} from "@puppyone/shared-ui";
import type { GitSourceControlResource } from "../../../types/electron";
import { Fragment, useRef } from "react";
import { SourceControlWorkingTreeRow } from "../components";
import type { GitWorkingSelection } from "../types";

export function SourceControlWorkingResourceList({
  resources,
  selectedWorkingFile,
  operationLoading,
  fileIconTheme,
  onSelectWorkingFile,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
}: {
  resources: readonly GitSourceControlResource[];
  selectedWorkingFile: GitWorkingSelection | null;
  operationLoading: string | null;
  fileIconTheme: FileIconThemeId;
  onSelectWorkingFile: (selection: GitWorkingSelection) => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
}) {
  const virtualListRef = useRef<HTMLOListElement | null>(null);
  const virtualRowSize = useCssPixelCustomProperty(
    virtualListRef,
    "--desktop-sidebar-virtual-row-size",
    STANDARD_CONTROL_SIZE + 2,
  );
  const renderResource = (resource: GitSourceControlResource) => (
    <SourceControlWorkingTreeRow
      resource={resource}
      selected={selectedWorkingFile?.staged === (resource.group === "index")
        && selectedWorkingFile.path === resource.path}
      operationLoading={operationLoading}
      fileIconTheme={fileIconTheme}
      onSelect={onSelectWorkingFile}
      onStagePaths={onStagePaths}
      onUnstagePaths={onUnstagePaths}
      onDiscardPaths={onDiscardPaths}
    />
  );

  if (shouldVirtualizeSidebarList(resources.length)) {
    return (
      <VirtualSidebarList
        className="desktop-working-tree-list desktop-working-tree-virtual-list"
        items={resources}
        listRef={virtualListRef}
        rowSize={virtualRowSize}
        getKey={(resource) => resource.id}
        renderRow={renderResource}
      />
    );
  }

  return (
    <div className="desktop-working-tree-list" data-po-scrollbar="sidebar">
      {resources.map((resource) => (
        <Fragment key={resource.id}>{renderResource(resource)}</Fragment>
      ))}
    </div>
  );
}
