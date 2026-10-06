import { useDesktopPreference, selectFileIconTheme } from "../../../preferencesStore";
import {
  FileGlyphIcon,
  Tooltip,
  createDocumentIdentity,
  getDocumentIdentityKey,
  getDocumentWorkingCopyStatuses,
  subscribeDocumentWorkingCopyStatuses,
  type DocumentSessionStatus,
  type EditorInput,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AlertCircle, LoaderCircle, Plus, X } from "lucide-react";

const EDITOR_TAB_DRAG_TYPE = "application/x-puppyone-editor-tab";
const EMPTY_STATUSES: ReadonlyMap<string, DocumentSessionStatus> = new Map();

type EditorHeaderTabsProps = Readonly<{
  activeEditorId: string | null;
  editors: readonly EditorInput[];
  storageIdentity: string | null;
  onActivate: (editorId: string) => void;
  onClose: (editorId: string) => Promise<void> | void;
  onCreate?: (anchor: DOMRect) => void;
  onMove: (editorId: string, targetEditorId: string) => void;
}>;

export function EditorHeaderTabs({
  activeEditorId,
  editors,
  storageIdentity,
  onActivate,
  onClose,
  onCreate,
  onMove,
}: EditorHeaderTabsProps) {
  const fileIconTheme = useDesktopPreference(selectFileIconTheme);
  const { t } = useLocalization();
  const statuses = useSyncExternalStore(
    subscribeDocumentWorkingCopyStatuses,
    getDocumentWorkingCopyStatuses,
    () => EMPTY_STATUSES,
  );
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(() => new Set());
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggedEditorIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeEditorId) return;
    tabRefs.current.get(activeEditorId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeEditorId, editors.length]);

  const close = async (editorId: string) => {
    if (closingIds.has(editorId)) return;
    setClosingIds((current) => new Set(current).add(editorId));
    try {
      await onClose(editorId);
    } finally {
      setClosingIds((current) => {
        const next = new Set(current);
        next.delete(editorId);
        return next;
      });
    }
  };

  const activateFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    editorId: string,
  ) => {
    const currentIndex = editors.findIndex((editor) => editor.id === editorId);
    if (currentIndex < 0) return;
    const direction = document.documentElement.dir === "rtl" ? -1 : 1;
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? editors.length - 1
        : event.key === "ArrowLeft"
          ? (currentIndex - direction + editors.length) % editors.length
          : event.key === "ArrowRight"
            ? (currentIndex + direction + editors.length) % editors.length
            : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    const target = editors[targetIndex];
    if (!target) return;
    onActivate(target.id);
    requestAnimationFrame(() => tabRefs.current.get(target.id)?.focus());
  };

  const beginDrag = (event: ReactDragEvent<HTMLDivElement>, editorId: string) => {
    draggedEditorIdRef.current = editorId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(EDITOR_TAB_DRAG_TYPE, editorId);
  };

  const moveBefore = (event: ReactDragEvent<HTMLDivElement>, targetEditorId: string) => {
    const editorId = draggedEditorIdRef.current
      ?? event.dataTransfer.getData(EDITOR_TAB_DRAG_TYPE);
    draggedEditorIdRef.current = null;
    if (!editorId || editorId === targetEditorId) return;
    event.preventDefault();
    onMove(editorId, targetEditorId);
  };

  return (
    <div
      className="desktop-titlebar-editor-tabs"
      role="tablist"
      aria-label={t("shell.editorTabs.label")}
      data-po-scrollbar="hidden"
    >
      {editors.map((editor) => {
        const active = editor.id === activeEditorId;
        const closing = closingIds.has(editor.id);
        const status = getEditorStatus(statuses, storageIdentity, editor.resource);
        return (
          <div
            className="desktop-titlebar-editor-tab"
            data-active={active ? "true" : undefined}
            data-closing={closing ? "true" : undefined}
            data-status={status ?? undefined}
            draggable={!closing}
            key={editor.id}
            onDragEnd={() => { draggedEditorIdRef.current = null; }}
            onDragOver={(event) => {
              if (draggedEditorIdRef.current) event.preventDefault();
            }}
            onDragStart={(event) => beginDrag(event, editor.id)}
            onDrop={(event) => moveBefore(event, editor.id)}
          >
            <button
              ref={(element) => {
                if (element) tabRefs.current.set(editor.id, element);
                else tabRefs.current.delete(editor.id);
              }}
              type="button"
              className="desktop-titlebar-editor-tab-select"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-editor-tab-id={editor.id}
              onClick={() => onActivate(editor.id)}
              onAuxClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                if (event.button === 1) void close(editor.id);
              }}
              onKeyDown={(event) => activateFromKeyboard(event, editor.id)}
            >
              <span className="desktop-titlebar-editor-tab-icon" aria-hidden="true">
                <FileGlyphIcon name={editor.label} size={15} theme={fileIconTheme} />
              </span>
              <span className="desktop-titlebar-editor-tab-label" dir="auto">{editor.label}</span>
            </button>
            <span className="desktop-titlebar-editor-tab-state" aria-hidden="true">
              {status === "saving" || closing
                ? <LoaderCircle className="is-spinning" size={12} />
                : status === "error"
                  ? <AlertCircle size={12} />
                  : status === "dirty"
                    ? <span className="desktop-titlebar-editor-tab-dirty" />
                    : null}
            </span>
            <Tooltip content={t("shell.editorTabs.close", { name: editor.label })}><button
              type="button"
              className="desktop-titlebar-editor-tab-close"
              aria-label={t("shell.editorTabs.close", { name: editor.label })}
              disabled={closing}
              onClick={(event) => {
                event.stopPropagation();
                void close(editor.id);
              }}
            >
              <X size={12} strokeWidth={1.8} aria-hidden="true" />
            </button></Tooltip>
          </div>
        );
      })}
      {onCreate && <Tooltip content={t("shell.editorTabs.new")}>
        <button
          type="button"
          className="desktop-titlebar-editor-tab-new"
          aria-label={t("shell.editorTabs.new")}
          onClick={(event) => onCreate(event.currentTarget.getBoundingClientRect())}
        >
          <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Tooltip>}
    </div>
  );
}

function getEditorStatus(
  statuses: ReadonlyMap<string, DocumentSessionStatus>,
  storageIdentity: string | null,
  resource: string,
) {
  if (!storageIdentity) return null;
  try {
    return statuses.get(getDocumentIdentityKey(createDocumentIdentity(
      { storageIdentity },
      resource,
    ))) ?? null;
  } catch {
    return null;
  }
}
