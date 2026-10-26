import { Tooltip } from "@puppyone/shared-ui";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
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
} from "../../components/DesktopMenu";
import {
  DesktopSidebarActionMenu,
  resolveDesktopSidebarActionMenuPosition,
} from "../../components/DesktopSidebarActionMenu";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";
import { ProjectMenuHeader } from "./ProjectMenuHeader";

export type ProjectActionSurface = "menu" | "rename" | "unlink" | null;

const PROJECT_ACTION_MENU_WIDTH = 288;
const PROJECT_ACTION_MENU_ESTIMATED_HEIGHT = 180;
/** Two place rows and their divider, so the first frame lands where it stays. */
const PROJECT_ACTION_LOCATION_ESTIMATED_HEIGHT = 82;

export type ProjectRowActionsProps = Readonly<{
  workspace: Workspace;
  /**
   * The Local / Cloud switch, present only on the open Project's row. The
   * place a Project is worked on is a fact about that Project, so it is
   * chosen where the Project is, not in the Header.
   */
  locationControls?: ReactNode;
  surface: ProjectActionSurface;
  onSurfaceChange: (surface: ProjectActionSurface) => void;
  onRenameProject?: (path: string, name: string) => Promise<void>;
  onUnlinkProject?: (path: string) => Promise<void>;
}>;

export function ProjectRowActions({
  workspace,
  locationControls,
  surface,
  onSurfaceChange,
  onRenameProject,
  onUnlinkProject,
}: ProjectRowActionsProps) {
  const { t } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [name, setName] = useState(workspace.name);
  const [pending, setPending] = useState<"rename" | "unlink" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (surface !== "rename") setName(workspace.name);
  }, [surface, workspace.name]);

  useLayoutEffect(() => {
    if (surface === "menu") {
      menuRef.current?.querySelector<HTMLButtonElement>(".desktop-menu-item:not(:disabled)")?.focus();
    } else if (surface === "rename") {
      inputRef.current?.select();
    }
  }, [surface]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = menuAnchorRef.current;
    if (surface !== "menu" || !menu || !anchor) return;
    const reposition = () => {
      const bounds = menu.getBoundingClientRect();
      if (!bounds.height) return;
      const next = resolveDesktopSidebarActionMenuPosition(anchor.getBoundingClientRect(), {
        menuWidth: bounds.width,
        estimatedHeight: bounds.height,
      });
      setMenuPosition(current => current.top === next.top && current.left === next.left ? current : next);
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [surface]);

  useEffect(() => {
    if (surface !== "menu") return undefined;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onSurfaceChange(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSurfaceChange(null);
    };
    const dismissOnViewportChange = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onSurfaceChange(null);
    };
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
  }, [onSurfaceChange, surface]);

  const openMenu = (anchor: HTMLElement) => {
    menuAnchorRef.current = anchor;
    setError(null);
    setMenuPosition(resolveDesktopSidebarActionMenuPosition(
      anchor.getBoundingClientRect(),
      {
        menuWidth: PROJECT_ACTION_MENU_WIDTH,
        estimatedHeight: PROJECT_ACTION_MENU_ESTIMATED_HEIGHT
          + (locationControls ? PROJECT_ACTION_LOCATION_ESTIMATED_HEIGHT : 0),
      },
    ));
    onSurfaceChange(surface === "menu" ? null : "menu");
  };

  const renameProject = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!onRenameProject || !nextName || pending) return;
    setPending("rename");
    setError(null);
    try {
      await onRenameProject(workspace.path, nextName);
      onSurfaceChange(null);
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
      onSurfaceChange(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setPending(null);
    }
  };

  return (
    <>
      <Tooltip content={t("shell.workspaceSwitcher.projectActions")}><button
        className="desktop-project-switcher-row-action"
        type="button"
        aria-label={t("shell.workspaceSwitcher.projectActionsFor", {
          project: bidiIsolate(workspace.name),
        })}
        aria-haspopup="menu"
        aria-expanded={surface === "menu"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.currentTarget);
        }}
      >
        <MoreVertical aria-hidden="true" />
      </button></Tooltip>

      {surface === "menu" && (
        <DesktopOverlayLayer>
          <DesktopSidebarActionMenu
            ref={menuRef}
            className="desktop-project-row-actions-menu"
            ariaLabel={t("shell.workspaceSwitcher.projectActionsFor", {
              project: bidiIsolate(workspace.name),
            })}
            style={{ ...menuPosition, width: PROJECT_ACTION_MENU_WIDTH }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ProjectMenuHeader key={workspace.path} name={workspace.name} path={workspace.path} />
            {locationControls && (
              <>
                {/* Choosing a place acts on the open Project, so the session
                    ends with the choice instead of outliving it. */}
                <div
                  className="desktop-project-row-actions-location"
                  onClick={() => onSurfaceChange(null)}
                >
                  {locationControls}
                </div>
                <DesktopMenuSeparator />
              </>
            )}
            {onRenameProject && (
              <DesktopMenuItem
                icon={<Pencil size={14} />}
                label={t("shell.workspaceSwitcher.renameProject")}
                onClick={() => {
                  setName(workspace.name);
                  setError(null);
                  onSurfaceChange("rename");
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
                  onSurfaceChange("unlink");
                }}
              />
            )}
          </DesktopSidebarActionMenu>
        </DesktopOverlayLayer>
      )}

      {surface === "rename" && (
        <ProjectRowDialog
          labelledBy="desktop-project-rename-title"
          pending={pending !== null}
          onClose={() => onSurfaceChange(null)}
          onSubmit={(event) => void renameProject(event)}
        >
          <ProjectRowDialogHeader
            titleId="desktop-project-rename-title"
            title={t("shell.workspaceSwitcher.renameProjectTitle")}
            pending={pending !== null}
            onClose={() => onSurfaceChange(null)}
          />
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
              onClick={() => onSurfaceChange(null)}
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
        </ProjectRowDialog>
      )}

      {surface === "unlink" && (
        <ProjectRowDialog
          labelledBy="desktop-project-unlink-title"
          pending={pending !== null}
          onClose={() => onSurfaceChange(null)}
        >
          <ProjectRowDialogHeader
            titleId="desktop-project-unlink-title"
            title={t("shell.workspaceSwitcher.unlinkProjectTitle")}
            pending={pending !== null}
            onClose={() => onSurfaceChange(null)}
          />
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
              onClick={() => onSurfaceChange(null)}
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
        </ProjectRowDialog>
      )}
    </>
  );
}

/**
 * The confirmation surfaces a Project row can raise. They share one frame so
 * renaming and unlinking cannot drift apart in focus, dismissal or elevation.
 */
function ProjectRowDialog({
  children,
  labelledBy,
  pending,
  onClose,
  onSubmit,
}: Readonly<{
  children: ReactNode;
  labelledBy: string;
  pending: boolean;
  onClose: () => void;
  onSubmit?: (event: FormEvent) => void;
}>) {
  const surfaceProps = {
    className: "desktop-dialog-surface desktop-project-row-dialog",
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": labelledBy,
  } as const;
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot
        dismissOnBackdrop={!pending}
        onClose={pending ? undefined : onClose}
      >
        {onSubmit
          ? <form {...surfaceProps} onSubmit={onSubmit}>{children}</form>
          : <div {...surfaceProps} tabIndex={-1}>{children}</div>}
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function ProjectRowDialogHeader({
  title,
  titleId,
  pending,
  onClose,
}: Readonly<{
  title: string;
  titleId: string;
  pending: boolean;
  onClose: () => void;
}>) {
  const { t } = useLocalization();
  return (
    <header className="desktop-dialog-header">
      <div className="desktop-dialog-title-row">
        <h2 id={titleId}>{title}</h2>
      </div>
      <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
        label={t("common.action.close")}
        disabled={pending}
        onClick={onClose}
      /></Tooltip>
    </header>
  );
}
