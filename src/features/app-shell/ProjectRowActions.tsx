import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { MoreVertical, Pencil, Unlink } from "lucide-react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
} from "../../components/DesktopDialog";
import {
  DesktopMenuItem,
  DesktopMenuSeparator,
  DesktopMenuSurface,
} from "../../components/DesktopMenu";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";

type ProjectActionSurface = "menu" | "rename" | "unlink" | null;

export type ProjectRowActionsProps = Readonly<{
  workspace: Workspace;
  onRenameProject?: (path: string, name: string) => Promise<void>;
  onUnlinkProject?: (path: string) => Promise<void>;
}>;

export function ProjectRowActions({
  workspace,
  onRenameProject,
  onUnlinkProject,
}: ProjectRowActionsProps) {
  const { t } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [surface, setSurface] = useState<ProjectActionSurface>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [name, setName] = useState(workspace.name);
  const [pending, setPending] = useState<"rename" | "unlink" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (surface !== "rename") setName(workspace.name);
  }, [surface, workspace.name]);

  useLayoutEffect(() => {
    if (surface === "menu") {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } else if (surface === "rename") {
      inputRef.current?.select();
    }
  }, [surface]);

  useEffect(() => {
    if (surface !== "menu") return undefined;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setSurface(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSurface(null);
    };
    const dismissOnViewportChange = () => setSurface(null);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    window.addEventListener("resize", dismissOnViewportChange);
    window.addEventListener("scroll", dismissOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
      window.removeEventListener("resize", dismissOnViewportChange);
      window.removeEventListener("scroll", dismissOnViewportChange, true);
    };
  }, [surface]);

  const openMenu = (anchor: HTMLElement) => {
    setError(null);
    setMenuPosition(resolveProjectRowMenuPosition(anchor.getBoundingClientRect()));
    setSurface((current) => current === "menu" ? null : "menu");
  };

  const renameProject = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!onRenameProject || !nextName || pending) return;
    setPending("rename");
    setError(null);
    try {
      await onRenameProject(workspace.path, nextName);
      setSurface(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPending(null);
    }
  };

  const unlinkProject = async () => {
    if (!onUnlinkProject || pending) return;
    setPending("unlink");
    setError(null);
    try {
      await onUnlinkProject(workspace.path);
      setPending(null);
      setSurface(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setPending(null);
    }
  };

  return (
    <>
      <button
        className="desktop-project-switcher-row-action"
        type="button"
        aria-label={t("shell.workspaceSwitcher.projectActionsFor", {
          project: bidiIsolate(workspace.name),
        })}
        aria-haspopup="menu"
        aria-expanded={surface === "menu"}
        title={t("shell.workspaceSwitcher.projectActions")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.currentTarget);
        }}
      >
        <MoreVertical aria-hidden="true" />
      </button>

      {surface === "menu" && (
        <DesktopOverlayLayer>
          <DesktopMenuSurface
            ref={menuRef}
            className="desktop-project-row-actions-menu"
            ariaLabel={t("shell.workspaceSwitcher.projectActionsFor", {
              project: bidiIsolate(workspace.name),
            })}
            style={menuPosition as CSSProperties}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {onRenameProject && (
              <DesktopMenuItem
                icon={<Pencil size={14} />}
                label={t("shell.workspaceSwitcher.renameProject")}
                onClick={() => {
                  setName(workspace.name);
                  setError(null);
                  setSurface("rename");
                }}
              />
            )}
            {onRenameProject && onUnlinkProject && <DesktopMenuSeparator />}
            {onUnlinkProject && (
              <DesktopMenuItem
                destructive
                icon={<Unlink size={14} />}
                label={t("shell.workspaceSwitcher.unlinkProject")}
                onClick={() => {
                  setError(null);
                  setSurface("unlink");
                }}
              />
            )}
          </DesktopMenuSurface>
        </DesktopOverlayLayer>
      )}

      {surface === "rename" && (
        <DesktopOverlayLayer>
          <DesktopDialogRoot
            dismissOnBackdrop={pending === null}
            onClose={pending ? undefined : () => setSurface(null)}
          >
            <form
              className="desktop-dialog-surface desktop-project-row-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="desktop-project-rename-title"
              onSubmit={(event) => void renameProject(event)}
            >
              <header className="desktop-dialog-header">
                <div className="desktop-dialog-title-row">
                  <h2 id="desktop-project-rename-title">
                    {t("shell.workspaceSwitcher.renameProjectTitle")}
                  </h2>
                </div>
                <DesktopDialogCloseButton
                  title={t("common.action.close")}
                  disabled={pending !== null}
                  onClick={() => setSurface(null)}
                />
              </header>
              <div className="desktop-dialog-body">
                <label className="desktop-dialog-field">
                  <span>{t("shell.workspaceSwitcher.projectName")}</span>
                  <input
                    ref={inputRef}
                    value={name}
                    maxLength={120}
                    disabled={pending !== null}
                    data-desktop-dialog-initial-focus="true"
                    onChange={(event) => {
                      setName(event.target.value);
                      setError(null);
                    }}
                  />
                </label>
                <p className="desktop-dialog-note">
                  {t("shell.workspaceSwitcher.renameProjectDescription")}
                </p>
                {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
              </div>
              <footer className="desktop-dialog-footer">
                <button
                  className="desktop-dialog-button"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => setSurface(null)}
                >
                  {t("common.action.cancel")}
                </button>
                <button
                  className="desktop-dialog-button primary"
                  type="submit"
                  disabled={pending !== null || !name.trim() || name.trim() === workspace.name}
                >
                  {pending === "rename"
                    ? t("shell.workspaceSwitcher.renameProjectProgress")
                    : t("common.action.save")}
                </button>
              </footer>
            </form>
          </DesktopDialogRoot>
        </DesktopOverlayLayer>
      )}

      {surface === "unlink" && (
        <DesktopOverlayLayer>
          <DesktopDialogRoot
            dismissOnBackdrop={pending === null}
            onClose={pending ? undefined : () => setSurface(null)}
          >
            <div
              className="desktop-dialog-surface desktop-project-row-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="desktop-project-unlink-title"
              tabIndex={-1}
            >
              <header className="desktop-dialog-header">
                <div className="desktop-dialog-title-row">
                  <h2 id="desktop-project-unlink-title">
                    {t("shell.workspaceSwitcher.unlinkProjectTitle")}
                  </h2>
                </div>
                <DesktopDialogCloseButton
                  title={t("common.action.close")}
                  disabled={pending !== null}
                  onClick={() => setSurface(null)}
                />
              </header>
              <div className="desktop-dialog-body">
                <p>
                  {t("shell.workspaceSwitcher.unlinkProjectDescription", {
                    project: bidiIsolate(workspace.name),
                  })}
                </p>
                {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
              </div>
              <footer className="desktop-dialog-footer">
                <button
                  className="desktop-dialog-button"
                  type="button"
                  disabled={pending !== null}
                  data-desktop-dialog-initial-focus="true"
                  onClick={() => setSurface(null)}
                >
                  {t("common.action.cancel")}
                </button>
                <button
                  className="desktop-dialog-button destructive"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void unlinkProject()}
                >
                  {pending === "unlink"
                    ? t("shell.workspaceSwitcher.unlinkProjectProgress")
                    : t("shell.workspaceSwitcher.unlinkProjectAction")}
                </button>
              </footer>
            </div>
          </DesktopDialogRoot>
        </DesktopOverlayLayer>
      )}
    </>
  );
}

export function resolveProjectRowMenuPosition(
  anchor: Pick<DOMRect, "bottom" | "right">,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): Readonly<{ top: number; left: number }> {
  const margin = 8;
  const width = 184;
  const estimatedHeight = 82;
  return {
    top: Math.max(margin, Math.min(anchor.bottom + 4, viewportHeight - estimatedHeight - margin)),
    left: Math.max(margin, Math.min(anchor.right - width, viewportWidth - width - margin)),
  };
}
