import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";
import { FileText, Folder, MoreVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { FileGlyphIcon, getMatchedExtension, type DataNode, type FileIconThemeId } from "@puppyone/shared-ui";

export type DesktopCreateEntryKind = "folder" | "markdown" | "text" | "json" | "csv";
export type DesktopCreateEntryAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
export type DesktopCreateEntryDraft = {
  parentPath: string | null;
  anchor: DesktopCreateEntryAnchor;
  error: string | null;
  creatingKind: DesktopCreateEntryKind | null;
  selectedKind: DesktopCreateEntryKind | null;
  name: string;
};
export type DesktopNodeActionMenuDraft = {
  node: DataNode;
  anchor: DesktopCreateEntryAnchor;
  mode: "actions" | "rename";
  renameNameValue: string;
  renameExtensionValue: string;
  renameFocus: "name" | "type";
  error: string | null;
  operation: "rename" | "delete" | null;
};

const CREATE_ENTRY_MENU_MARGIN = 12;
const CREATE_ENTRY_MENU_WIDTH = 184;
const CREATE_ENTRY_MENU_ESTIMATED_HEIGHT = 166;
const NODE_ACTION_MENU_WIDTH = 176;
const NODE_ACTION_MENU_ESTIMATED_HEIGHT = 144;

const CREATE_ENTRY_OPTIONS = [
  {
    kind: "folder",
    label: "Folder",
    dialogTitle: "New Folder",
    iconName: "folder",
    iconType: "folder",
    defaultName: "New Folder",
  },
  {
    kind: "markdown",
    label: "Markdown",
    dialogTitle: "New Markdown",
    iconName: "Untitled.md",
    iconType: "markdown",
    defaultName: "Untitled.md",
  },
  {
    kind: "text",
    label: "Text",
    dialogTitle: "New Text File",
    iconName: "Untitled.txt",
    iconType: "text",
    defaultName: "Untitled.txt",
  },
  {
    kind: "json",
    label: "JSON",
    dialogTitle: "New JSON File",
    iconName: "Untitled.json",
    iconType: "json",
    defaultName: "Untitled.json",
  },
  {
    kind: "csv",
    label: "CSV",
    dialogTitle: "New CSV File",
    iconName: "Untitled.csv",
    iconType: "spreadsheet",
    defaultName: "Untitled.csv",
  },
] as const satisfies Array<{
  kind: DesktopCreateEntryKind;
  label: string;
  dialogTitle: string;
  iconName: string;
  iconType: DataNode["type"];
  defaultName: string;
}>;

type CreateEntryOption = (typeof CREATE_ENTRY_OPTIONS)[number];

export function DesktopExplorerRowActions({
  node,
  parentPath,
  onCreate,
  onOpenNodeMenu,
}: {
  node?: DataNode;
  parentPath: string | null;
  onCreate: (parentPath: string | null, anchorRect: DOMRect) => void;
  onOpenNodeMenu: (node: DataNode, anchorRect: DOMRect) => void;
}) {
  const canCreate = node?.type === "folder" || !node;

  return (
    <>
      {canCreate && (
        <button
          className="tree-row-action-button"
          type="button"
          title="Create new"
          aria-label="Create new"
          onClick={(event) => onCreate(parentPath, event.currentTarget.getBoundingClientRect())}
        >
          <Plus size={13} />
        </button>
      )}
      {node && (
        <button
          className="tree-row-action-button"
          type="button"
          title="More actions"
          aria-label={`More actions for ${node.name}`}
          onClick={(event) => onOpenNodeMenu(node, event.currentTarget.getBoundingClientRect())}
        >
          <MoreVertical size={13} />
        </button>
      )}
    </>
  );
}

export function DesktopCreateEntryMenu({
  draft,
  fileIconTheme,
  onCancel,
  onSelectKind,
}: {
  draft: DesktopCreateEntryDraft;
  fileIconTheme?: FileIconThemeId | null;
  onCancel: () => void;
  onSelectKind: (kind: DesktopCreateEntryKind) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = getCreateEntryMenuPosition(draft.anchor);
  const menuStyle = {
    "--node-action-menu-left": `${position.left}px`,
    "--node-action-menu-top": `${position.top}px`,
    "--node-action-menu-width": `${CREATE_ENTRY_MENU_WIDTH}px`,
  } as CSSProperties;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    const handleViewportChange = () => onCancel();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onCancel]);

  return (
    <div
      ref={menuRef}
      className="desktop-create-entry-menu desktop-node-action-menu"
      role="menu"
      aria-label="Create new"
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {CREATE_ENTRY_OPTIONS.map((option) => (
        <DesktopNodeActionMenuItem
          key={option.kind}
          icon={<CreateEntryGlyph option={option} theme={fileIconTheme} />}
          label={option.label}
          onClick={() => onSelectKind(option.kind)}
        />
      ))}
    </div>
  );
}

export function DesktopCreateEntryDialog({
  draft,
  fileIconTheme,
  onChange,
  onCancel,
  onCreate,
}: {
  draft: DesktopCreateEntryDraft;
  fileIconTheme?: FileIconThemeId | null;
  onChange: Dispatch<SetStateAction<DesktopCreateEntryDraft | null>>;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedKind = draft.selectedKind;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && draft.creatingKind === null) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [draft.creatingKind, onCancel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!selectedKind) return null;

  const selectedOption = getCreateEntryOption(selectedKind);
  const extensionNote = getCreateEntryExtensionNote(selectedKind);

  return (
    <div
      className="desktop-dialog-backdrop"
      role="presentation"
      onClick={draft.creatingKind === null ? onCancel : undefined}
    >
      <form
        className="desktop-dialog-surface desktop-file-dialog desktop-create-entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-create-entry-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading file" aria-hidden="true">
              <CreateEntryGlyph option={selectedOption} theme={fileIconTheme} size={16} />
            </span>
            <div>
              <h2 id="desktop-create-entry-title">{selectedOption.dialogTitle}</h2>
              <p>{draft.parentPath ? `Create in ${draft.parentPath}` : "Create in workspace root"}</p>
            </div>
          </div>
          <button
            className="desktop-dialog-icon-button"
            type="button"
            disabled={draft.creatingKind !== null}
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </header>

        <div className="desktop-dialog-body desktop-file-dialog-body">
          <label className="desktop-dialog-field">
            <span>Name</span>
            <input
              ref={inputRef}
              value={draft.name}
              disabled={draft.creatingKind !== null}
              aria-label={`${selectedOption.label} name`}
              placeholder={`${selectedOption.label} name`}
              onChange={(event) => {
                const value = event.target.value;
                onChange((current) => current ? { ...current, name: value, error: null } : current);
              }}
            />
          </label>

          {extensionNote && (
            <div className="desktop-dialog-note">{extensionNote}</div>
          )}
          {draft.error && <div className="desktop-dialog-error">{draft.error}</div>}
        </div>

        <footer className="desktop-dialog-footer">
          <button
            className="desktop-dialog-button"
            type="button"
            disabled={draft.creatingKind !== null}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="desktop-dialog-button primary file"
            type="submit"
            disabled={draft.creatingKind !== null || !draft.name.trim()}
          >
            {draft.creatingKind ? "Creating..." : "Create"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function DesktopNodeActionMenu({
  draft,
  onChange,
  onCancel,
  onRename,
  onDelete,
}: {
  draft: DesktopNodeActionMenuDraft;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  if (draft.mode === "rename") {
    return (
      <DesktopNodeRenameDialog
        draft={draft}
        onChange={onChange}
        onCancel={onCancel}
        onRename={onRename}
      />
    );
  }

  return (
    <DesktopNodeActionPopover
      draft={draft}
      onChange={onChange}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}

function DesktopNodeActionPopover({
  draft,
  onChange,
  onCancel,
  onDelete,
}: {
  draft: DesktopNodeActionMenuDraft;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = getNodeActionMenuPosition(draft.anchor, NODE_ACTION_MENU_WIDTH, NODE_ACTION_MENU_ESTIMATED_HEIGHT);
  const menuStyle = {
    "--node-action-menu-left": `${position.left}px`,
    "--node-action-menu-top": `${position.top}px`,
    "--node-action-menu-width": `${NODE_ACTION_MENU_WIDTH}px`,
  } as CSSProperties;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    const handleViewportChange = () => onCancel();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onCancel]);

  return (
    <div
      ref={menuRef}
      className="desktop-node-action-menu"
      role="menu"
      aria-label={`Actions for ${draft.node.name}`}
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <DesktopNodeActionMenuItem
        icon={<Pencil size={14} />}
        label="Rename"
        disabled={draft.operation !== null}
        onClick={() => onChange((current) => current ? {
          ...current,
          mode: "rename",
          renameFocus: "name",
          error: null,
        } : current)}
      />
      {draft.node.type !== "folder" && (
        <DesktopNodeActionMenuItem
          icon={<FileText size={14} />}
          label="Change Type"
          disabled={draft.operation !== null}
          onClick={() => onChange((current) => current ? {
            ...current,
            mode: "rename",
            renameFocus: "type",
            error: null,
          } : current)}
        />
      )}
      <DesktopNodeActionMenuItem
        icon={<Trash2 size={14} />}
        label={draft.operation === "delete" ? "Deleting..." : "Delete"}
        destructive
        disabled={draft.operation !== null}
        onClick={onDelete}
      />
      {draft.error && <div className="desktop-node-action-error">{draft.error}</div>}
    </div>
  );
}

function DesktopNodeRenameDialog({
  draft,
  onChange,
  onCancel,
  onRename,
}: {
  draft: DesktopNodeActionMenuDraft;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onRename: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const isFile = draft.node.type !== "folder";
  const fileTypeOptions = useMemo(
    () => getDesktopFileTypeOptions(draft.renameExtensionValue),
    [draft.renameExtensionValue],
  );
  const title = draft.renameFocus === "type" && isFile ? "Change type" : "Rename";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && draft.operation === null) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [draft.operation, onCancel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (draft.renameFocus === "type" && isFile) {
        selectRef.current?.focus();
        return;
      }
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft.renameFocus, isFile]);

  return (
    <div
      className="desktop-dialog-backdrop"
      role="presentation"
      onClick={draft.operation === null ? onCancel : undefined}
    >
      <form
        className="desktop-dialog-surface desktop-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-node-rename-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onRename();
        }}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading file" aria-hidden="true">
              {isFile ? <FileText size={16} /> : <Folder size={16} />}
            </span>
            <div>
              <h2 id="desktop-node-rename-title">{title}</h2>
              <p>{draft.node.name}</p>
            </div>
          </div>
          <button
            className="desktop-dialog-icon-button"
            type="button"
            disabled={draft.operation !== null}
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </header>

        <div className="desktop-dialog-body desktop-file-dialog-body">
          <label className="desktop-dialog-field">
            <span>Name</span>
            <input
              ref={inputRef}
              value={draft.renameNameValue}
              disabled={draft.operation !== null}
              onChange={(event) => {
                const value = event.target.value;
                onChange((current) => current ? { ...current, renameNameValue: value, error: null } : current);
              }}
            />
          </label>
          {isFile && (
            <label className="desktop-dialog-field">
              <span>Type</span>
              <select
                ref={selectRef}
                value={normalizeDesktopExtension(draft.renameExtensionValue)}
                disabled={draft.operation !== null}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange((current) => current ? {
                    ...current,
                    renameExtensionValue: value,
                    renameFocus: "type",
                    error: null,
                  } : current);
                }}
              >
                {fileTypeOptions.map((option) => (
                  <option key={option.extension || "__none__"} value={option.extension}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.error && <div className="desktop-dialog-error">{draft.error}</div>}
        </div>

        <footer className="desktop-dialog-footer">
          <button
            className="desktop-dialog-button"
            type="button"
            disabled={draft.operation !== null}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="desktop-dialog-button primary file"
            type="submit"
            disabled={draft.operation !== null || !draft.renameNameValue.trim()}
          >
            {draft.operation === "rename" ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function DesktopNodeActionMenuItem({
  icon,
  label,
  destructive,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`desktop-node-action-menu-item ${destructive ? "danger" : ""}`}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <span className="desktop-node-action-menu-icon">{icon}</span>
      <span className="desktop-node-action-menu-label">{label}</span>
    </button>
  );
}

function CreateEntryGlyph({
  option,
  theme,
  size = 18,
}: {
  option: CreateEntryOption;
  theme?: FileIconThemeId | null;
  size?: number;
}) {
  return (
    <FileGlyphIcon
      name={option.iconName}
      type={option.iconType}
      size={size}
      theme={theme}
    />
  );
}

function getCreateEntryOption(kind: DesktopCreateEntryKind): CreateEntryOption {
  return CREATE_ENTRY_OPTIONS.find((option) => option.kind === kind) ?? CREATE_ENTRY_OPTIONS[0];
}

const DESKTOP_FILE_TYPE_OPTIONS = [
  { label: "No extension", extension: "" },
  { label: "Markdown (.md)", extension: ".md" },
  { label: "JSON (.json)", extension: ".json" },
  { label: "JSON Lines (.jsonl)", extension: ".jsonl" },
  { label: "Text (.txt)", extension: ".txt" },
  { label: "CSV (.csv)", extension: ".csv" },
  { label: "HTML (.html)", extension: ".html" },
  { label: "JavaScript (.js)", extension: ".js" },
  { label: "TypeScript (.ts)", extension: ".ts" },
  { label: "TSX (.tsx)", extension: ".tsx" },
  { label: "YAML (.yml)", extension: ".yml" },
  { label: "TOML (.toml)", extension: ".toml" },
  { label: "PDF (.pdf)", extension: ".pdf" },
  { label: "PNG image (.png)", extension: ".png" },
  { label: "JPEG image (.jpg)", extension: ".jpg" },
  { label: "Archive (.zip)", extension: ".zip" },
  { label: "Tarball (.tar.gz)", extension: ".tar.gz" },
] as const;

export function getDesktopRenameDraft(node: DataNode): { nameValue: string; extensionValue: string } {
  if (node.type === "folder") return { nameValue: node.name, extensionValue: "" };

  const extension = getDesktopNodeExtension(node.name);
  if (!extension) return { nameValue: node.name, extensionValue: "" };

  return {
    nameValue: node.name.slice(0, -extension.length),
    extensionValue: extension,
  };
}

export function normalizeDesktopRenameName(draft: DesktopNodeActionMenuDraft): string {
  const baseName = draft.renameNameValue.trim();
  validateDesktopNodeName(baseName);

  if (draft.node.type === "folder") return baseName;

  const selectedExtension = normalizeDesktopExtension(draft.renameExtensionValue);
  const currentExtension = getDesktopNodeExtension(draft.node.name);
  const extension = selectedExtension === normalizeDesktopExtension(currentExtension)
    ? currentExtension
    : selectedExtension;
  const normalizedBaseName = extension && baseName.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
    ? baseName.slice(0, -extension.length)
    : baseName;
  const nextName = `${normalizedBaseName}${extension}`;
  validateDesktopNodeName(nextName);
  return nextName;
}

export function validateDesktopNodeName(name: string): void {
  if (!name) throw new Error("Name is required.");
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error("Name must be a single file or folder name.");
  }
  if (name.includes("\0")) {
    throw new Error("Name contains unsupported characters.");
  }
}

export function getDesktopFileTypeOptions(currentExtension: string): Array<{ label: string; extension: string }> {
  const extension = normalizeDesktopExtension(currentExtension);
  const options = [...DESKTOP_FILE_TYPE_OPTIONS];
  if (!extension || options.some((option) => option.extension === extension)) return options;

  return [
    options[0],
    { label: `Current (${extension})`, extension },
    ...options.slice(1),
  ];
}

export function normalizeDesktopExtension(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function getDesktopNodeExtension(name: string): string {
  if (!name) return "";
  if (name.startsWith(".") && name.indexOf(".", 1) === -1) return "";

  const extension = getMatchedExtension(name);
  if (!extension) return "";

  const suffix = `.${extension}`;
  if (!name.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) return "";
  if (name.length <= suffix.length) return "";
  return name.slice(-suffix.length);
}

export function formatDesktopExtensionLabel(extension: string): string {
  return extension || "no extension";
}

export function defaultCreateName(kind: DesktopCreateEntryKind): string {
  return getCreateEntryOption(kind).defaultName;
}

export function getCreateEntryInitialContent(kind: DesktopCreateEntryKind): string {
  if (kind === "json") return "{}\n";
  if (kind === "csv") return "Column 1,Column 2\n";
  return "";
}

export function normalizeCreateEntryName(kind: DesktopCreateEntryKind, value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error("Name must be a single file or folder name.");
  }
  if (name.includes("\0")) {
    throw new Error("Name contains unsupported characters.");
  }
  if (kind === "markdown") {
    return ensureCreateEntryExtension(name, /\.(md|markdown|mdx)$/i, ".md");
  }
  if (kind === "text") {
    return getDesktopNodeExtension(name) ? name : `${name}.txt`;
  }
  if (kind === "json") {
    return ensureCreateEntryExtension(name, /\.(json|jsonl)$/i, ".json");
  }
  if (kind === "csv") {
    return ensureCreateEntryExtension(name, /\.(csv|tsv)$/i, ".csv");
  }
  return name;
}

function ensureCreateEntryExtension(name: string, extensionPattern: RegExp, fallbackExtension: string): string {
  if (extensionPattern.test(name)) return name;
  return `${name}${fallbackExtension}`;
}

function getCreateEntryExtensionNote(kind: DesktopCreateEntryKind): string | null {
  if (kind === "markdown") return "Names without a Markdown extension are saved as .md.";
  if (kind === "text") return "Names without an extension are saved as .txt.";
  if (kind === "json") return "Names without a JSON extension are saved as .json.";
  if (kind === "csv") return "Names without a table extension are saved as .csv.";
  return null;
}

export function uniqueCreateEntryName(defaultName: string, existingNames: Set<string>): string {
  if (!existingNames.has(defaultName)) return defaultName;

  const extensionIndex = defaultName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? defaultName.slice(0, extensionIndex) : defaultName;
  const extension = hasExtension ? defaultName.slice(extensionIndex) : "";

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} ${index}${extension}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${stem} ${Date.now()}${extension}`;
}

export function rectToCreateEntryAnchor(rect: DOMRect): DesktopCreateEntryAnchor {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function getNodeActionMenuPosition(anchor: DesktopCreateEntryAnchor, menuWidth: number, estimatedHeight: number) {
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const maxLeft = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportWidth - menuWidth - CREATE_ENTRY_MENU_MARGIN);
  const maxTop = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportHeight - estimatedHeight - CREATE_ENTRY_MENU_MARGIN);

  return {
    left: clampNumber(anchor.left, CREATE_ENTRY_MENU_MARGIN, maxLeft),
    top: clampNumber(anchor.bottom + 4, CREATE_ENTRY_MENU_MARGIN, maxTop),
  };
}

function getCreateEntryMenuPosition(anchor: DesktopCreateEntryAnchor) {
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const maxLeft = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportWidth - CREATE_ENTRY_MENU_WIDTH - CREATE_ENTRY_MENU_MARGIN);
  const maxTop = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportHeight - CREATE_ENTRY_MENU_ESTIMATED_HEIGHT - CREATE_ENTRY_MENU_MARGIN);

  return {
    left: clampNumber(anchor.left, CREATE_ENTRY_MENU_MARGIN, maxLeft),
    top: clampNumber(anchor.bottom + 6, CREATE_ENTRY_MENU_MARGIN, maxTop),
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
