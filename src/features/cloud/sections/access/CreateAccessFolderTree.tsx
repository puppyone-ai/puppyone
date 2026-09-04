import { Check, FileText } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  STANDARD_CONTROL_SIZE,
  useCssPixelCustomProperty,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { PageLoading } from "../../../../components/loading";
import type {
  DesktopCloudSession,
  DesktopCloudTreeEntry,
} from "../../../../lib/cloudApi";
import {
  formatTreePath,
  normalizeAccessPath,
} from "./createAccessModel";
import { useCreateAccessFolderEntries } from "./useCreateAccessFolderEntries";

const AccessTreeRowHeightContext = createContext(STANDARD_CONTROL_SIZE);

export function CreateAccessFolderTree({
  projectId,
  cloudSession,
  apiBaseUrl,
  selectedPath,
  existingPathSet,
  initialExpandedPath,
  onCloudSessionChange,
  onSelect,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  selectedPath: string | null;
  existingPathSet: ReadonlySet<string>;
  initialExpandedPath?: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useLocalization();
  const treeRef = useRef<HTMLElement>(null);
  const rowHeight = useCssPixelCustomProperty(
    treeRef,
    "--po-control-size",
    STANDARD_CONTROL_SIZE,
  );
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(
    () => new Set(["", ...ancestorPaths(initialExpandedPath ?? "")]),
  );

  useEffect(() => {
    if (!selectedPath) return;
    setExpandedPaths((current) => {
      const next = new Set(current);
      next.add("");
      ancestorPaths(selectedPath).forEach((path) => next.add(path));
      return next;
    });
  }, [selectedPath]);

  const isExpanded = (path: string) => expandedPaths.has(normalizeAccessPath(path));
  const toggleExpanded = (path: string) => {
    const normalized = normalizeAccessPath(path);
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      next.add("");
      return next;
    });
  };

  return (
    <section ref={treeRef} className="desktop-cloud-create-access-tree">
      <header>{t("cloud.access.create.chooseFromFiles")}</header>
      <AccessTreeRowHeightContext.Provider value={rowHeight}>
        <div className="desktop-cloud-create-access-tree-body" data-po-scrollbar="content">
          <TreeRootRow />
          <FolderChildren
            projectId={projectId}
            cloudSession={cloudSession}
            apiBaseUrl={apiBaseUrl}
            parentPath=""
            depth={1}
            ancestorLastSiblings={[]}
            selectedPath={selectedPath}
            existingPathSet={existingPathSet}
            isExpanded={isExpanded}
            onToggle={toggleExpanded}
            onSelect={onSelect}
            onCloudSessionChange={onCloudSessionChange}
          />
        </div>
      </AccessTreeRowHeightContext.Provider>
    </section>
  );
}

export function TreeDisclosureMarker({ expanded = false, size = 12 }: { expanded?: boolean; size?: number }) {
  return (
    <svg
      className={`desktop-cloud-create-access-disclosure ${expanded ? "expanded" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}

function TreeRootRow() {
  const { t } = useLocalization();
  return (
    <div className="desktop-cloud-create-access-tree-row root">
      <span className="desktop-cloud-create-access-tree-marker">
        <TreeDisclosureMarker expanded />
      </span>
      <span className="desktop-cloud-create-access-tree-name">{t("cloud.common.root")}</span>
      <AccessStatusText />
    </div>
  );
}

function FolderChildren({
  projectId,
  cloudSession,
  apiBaseUrl,
  parentPath,
  depth,
  ancestorLastSiblings,
  selectedPath,
  existingPathSet,
  isExpanded,
  onToggle,
  onSelect,
  onCloudSessionChange,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  parentPath: string;
  depth: number;
  ancestorLastSiblings: readonly boolean[];
  selectedPath: string | null;
  existingPathSet: ReadonlySet<string>;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const { t } = useLocalization();
  const { entries, loading, error } = useCreateAccessFolderEntries({
    projectId,
    cloudSession,
    apiBaseUrl,
    path: parentPath,
    onCloudSessionChange,
  });

  if (loading) {
    return (
      <TreeMessage depth={depth}>
        <PageLoading label={t("cloud.common.loading")} size="xs" variant="fill" style={{ minHeight: 0, width: "auto", height: "auto" }} />
      </TreeMessage>
    );
  }
  if (error) return <TreeMessage depth={depth}>{t("cloud.access.create.folderLoadFailed")}</TreeMessage>;
  if (entries.length === 0) return <TreeMessage depth={depth}>{t("cloud.access.create.emptyFolder")}</TreeMessage>;

  return (
    <>
      {entries.map((entry, index) => {
        const normalizedPath = normalizeAccessPath(entry.path);
        const isLastSibling = index === entries.length - 1;
        if (entry.type !== "folder") {
          return (
            <FileRow
              key={entry.path || entry.name}
              entry={entry}
              depth={depth}
              isLastSibling={isLastSibling}
              ancestorLastSiblings={ancestorLastSiblings}
            />
          );
        }
        const expanded = isExpanded(normalizedPath);
        return (
          <div key={entry.path || entry.name}>
            <FolderRow
              entry={entry}
              depth={depth}
              isLastSibling={isLastSibling}
              ancestorLastSiblings={ancestorLastSiblings}
              expanded={expanded}
              selected={selectedPath === normalizedPath}
              alreadyExists={existingPathSet.has(normalizedPath)}
              onToggle={() => onToggle(normalizedPath)}
              onSelect={() => onSelect(normalizedPath)}
            />
            {expanded ? (
              <FolderChildren
                projectId={projectId}
                cloudSession={cloudSession}
                apiBaseUrl={apiBaseUrl}
                parentPath={normalizedPath}
                depth={depth + 1}
                ancestorLastSiblings={[...ancestorLastSiblings, isLastSibling]}
                selectedPath={selectedPath}
                existingPathSet={existingPathSet}
                isExpanded={isExpanded}
                onToggle={onToggle}
                onSelect={onSelect}
                onCloudSessionChange={onCloudSessionChange}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function FolderRow({
  entry,
  depth,
  isLastSibling,
  ancestorLastSiblings,
  expanded,
  selected,
  alreadyExists,
  onToggle,
  onSelect,
}: {
  entry: DesktopCloudTreeEntry;
  depth: number;
  isLastSibling: boolean;
  ancestorLastSiblings: readonly boolean[];
  expanded: boolean;
  selected: boolean;
  alreadyExists: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-cloud-create-access-tree-row-wrap">
      <TreeGuides depth={depth} isLastSibling={isLastSibling} ancestorLastSiblings={ancestorLastSiblings} />
      <button
        className={`desktop-cloud-create-access-tree-row folder ${selected ? "selected" : ""}`}
        type="button"
        title={t(expanded ? "cloud.access.create.collapseFolder" : "cloud.access.create.expandFolder", { path: formatTreePath(entry.path, t) })}
        style={{ paddingInlineStart: 8 + depth * 16 }}
        onClick={onToggle}
      >
        <span className="desktop-cloud-create-access-tree-marker">
          <TreeDisclosureMarker expanded={expanded} />
        </span>
        <span className="desktop-cloud-create-access-tree-name" dir="auto">{entry.name}</span>
        <FolderRowStatus selected={selected} alreadyExists={alreadyExists} onSelect={onSelect} />
      </button>
    </div>
  );
}

function FileRow({
  entry,
  depth,
  isLastSibling,
  ancestorLastSiblings,
}: {
  entry: DesktopCloudTreeEntry;
  depth: number;
  isLastSibling: boolean;
  ancestorLastSiblings: readonly boolean[];
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-cloud-create-access-tree-row-wrap">
      <TreeGuides depth={depth} isLastSibling={isLastSibling} ancestorLastSiblings={ancestorLastSiblings} />
      <div
        className="desktop-cloud-create-access-tree-row file"
        title={formatTreePath(entry.path, t)}
        aria-disabled="true"
        style={{ paddingInlineStart: 8 + depth * 16 }}
      >
        <span className="desktop-cloud-create-access-tree-marker" />
        <FileText size={15} />
        <span className="desktop-cloud-create-access-tree-name" dir="auto">{entry.name}</span>
      </div>
    </div>
  );
}

function FolderRowStatus({
  selected,
  alreadyExists,
  onSelect,
}: {
  selected: boolean;
  alreadyExists: boolean;
  onSelect: () => void;
}) {
  const { t } = useLocalization();
  if (alreadyExists) return <AccessStatusText onSelect={onSelect} />;
  return (
    <button
      className={`desktop-cloud-create-access-tree-status action ${selected ? "selected" : ""}`}
      type="button"
      title={t(selected ? "cloud.access.create.selectedFolder" : "cloud.access.create.selectFolder")}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <span>{t(selected ? "cloud.common.selected" : "cloud.common.select")}</span>
      <span aria-hidden="true">
        {selected ? <Check size={13} strokeWidth={2.6} /> : null}
      </span>
    </button>
  );
}

function AccessStatusText({ onSelect }: { onSelect?: () => void }) {
  const { t } = useLocalization();
  if (!onSelect) {
    return <span className="desktop-cloud-create-access-tree-status">{t("cloud.access.create.hasAccess")}</span>;
  }
  return (
    <button
      className="desktop-cloud-create-access-tree-status existing"
      type="button"
      title={t("cloud.access.create.openThisAccess")}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {t("cloud.access.create.hasAccess")}
    </button>
  );
}

function TreeMessage({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div className="desktop-cloud-create-access-tree-message" style={{ paddingInlineStart: 8 + depth * 16 + 24 }}>
      {children}
    </div>
  );
}

function TreeGuides({
  depth,
  isLastSibling,
  ancestorLastSiblings,
}: {
  depth: number;
  isLastSibling: boolean;
  ancestorLastSiblings: readonly boolean[];
}) {
  const rowHeight = useContext(AccessTreeRowHeightContext);
  if (depth <= 0) return null;
  const width = 8 + depth * 16 + 8;
  const lineOverdraw = 2;
  const lineHeight = rowHeight + lineOverdraw * 2;
  const hookY = lineOverdraw + rowHeight / 2;
  return (
    <svg
      className="desktop-cloud-create-access-tree-guides"
      width={width}
      height={lineHeight}
      viewBox={`0 0 ${width} ${lineHeight}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ width, height: lineHeight, top: -lineOverdraw } as CSSProperties}
    >
      {ancestorLastSiblings.map((last, index) => {
        if (last) return null;
        const level = index + 1;
        return <rect key={level} x={level * 16} y={0} width={1} height={lineHeight} fill="var(--po-tree-guide)" />;
      })}
      <rect x={depth * 16} y={0} width={1} height={isLastSibling ? hookY : lineHeight} fill="var(--po-tree-guide)" />
      <rect x={depth * 16} y={hookY} width={8} height={1} fill="var(--po-tree-guide)" />
    </svg>
  );
}

function ancestorPaths(path: string) {
  const parts = normalizeAccessPath(path).split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("/"));
  }
  return ancestors;
}
