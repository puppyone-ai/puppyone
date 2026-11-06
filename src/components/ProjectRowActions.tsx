import { LocalIcon, Tooltip } from "@puppyone/shared-ui";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { MoreVertical, Pencil, Trash2, Unlink } from "lucide-react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
} from "./DesktopDialog";
import {
  DesktopMenuItem,
  DesktopMenuSeparator,
} from "./DesktopMenu";
import {
  DesktopSidebarActionMenu,
  resolveDesktopActionMenuPositionBeside,
  resolveDesktopSidebarActionMenuPosition,
} from "./DesktopSidebarActionMenu";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";
import { desktopMenuItems, walkDesktopMenu } from "./desktopMenuKeyboard";
import { ProjectMenuHeader } from "./ProjectMenuHeader";

export type ProjectActionSurface = "menu" | "rename" | "unlink" | "delete" | null;

/** The local menu carries the folder's path; a Cloud project has only its commands. */
const PROJECT_ACTION_MENU_WIDTH = { local: 224, cloud: 184 } as const;
const PROJECT_ACTION_MENU_ESTIMATED_HEIGHT = 180;
const PROJECT_NAME_MAX_LENGTH = { local: 120, cloud: 200 } as const;
const PROJECT_ACTION_MENU_POSITION = {
  sidebar: resolveDesktopSidebarActionMenuPosition,
  beside: resolveDesktopActionMenuPositionBeside,
} as const;

const PROJECT_CONFIRMATIONS = {
  unlink: {
    title: "shell.workspaceSwitcher.unlinkProjectTitle",
    description: "shell.workspaceSwitcher.unlinkProjectDescription",
    action: "shell.workspaceSwitcher.unlinkProjectAction",
    progress: "shell.workspaceSwitcher.unlinkProjectProgress",
  },
  delete: {
    title: "shell.workspaceSwitcher.deleteProjectTitle",
    description: "shell.workspaceSwitcher.deleteProjectDescription",
    action: "shell.workspaceSwitcher.deleteProjectAction",
    progress: "shell.workspaceSwitcher.deleteProjectProgress",
  },
} as const;

export type ProjectRowActionsProps = Readonly<{
  /** A Cloud project has no path, so no folder to show or to leave in place. */
  project: Readonly<{ name: string; path?: string }>;
  surface: ProjectActionSurface;
  onSurfaceChange: (surface: ProjectActionSurface) => void;
  onRename?: (name: string) => Promise<void>;
  onUnlink?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  /** What the owner's other computers may do with this folder; only where it is open to them. */
  onSharingSettings?: () => void;
  disabled?: boolean;
  triggerClassName?: string;
  /** For a list that keeps its rows out of the way of the Tab key. */
  triggerTabIndex?: number;
  menuPlacement?: keyof typeof PROJECT_ACTION_MENU_POSITION;
}>;

export function ProjectRowActions({
  project,
  surface,
  onSurfaceChange,
  onRename,
  onUnlink,
  onDelete,
  onSharingSettings,
  disabled = false,
  triggerClassName = "desktop-project-switcher-row-action",
  triggerTabIndex,
  menuPlacement = "sidebar",
}: ProjectRowActionsProps) {
  const { t } = useLocalization();
  const place = project.path ? "local" : "cloud";
  const menuWidth = PROJECT_ACTION_MENU_WIDTH[place];
  const resolveMenuPosition = PROJECT_ACTION_MENU_POSITION[menuPlacement];
  // State, not a ref: the overlay layer mounts a commit after the surface opens,
  // so effects have to run again once the menu really exists to be measured.
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const surfaceWasOpenRef = useRef(false);
  const pressedElsewhereRef = useRef(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [name, setName] = useState(project.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (surface !== "rename") setName(project.name);
  }, [surface, project.name]);

  useLayoutEffect(() => {
    if (surface === "menu") {
      desktopMenuItems(menu)[0]?.focus();
    } else if (surface === "rename") {
      inputRef.current?.select();
    }
  }, [menu, surface]);

  // Whatever closes, focus goes back to the button that opened it, unless a press
  // elsewhere is already taking it somewhere of its own.
  useLayoutEffect(() => {
    const closed = surfaceWasOpenRef.current && surface === null;
    surfaceWasOpenRef.current = surface !== null;
    if (!closed) return;
    if (!pressedElsewhereRef.current) menuAnchorRef.current?.focus({ preventScroll: true });
    pressedElsewhereRef.current = false;
  }, [surface]);

  useLayoutEffect(() => {
    const anchor = menuAnchorRef.current;
    if (surface !== "menu" || !menu || !anchor) return;
    const reposition = () => {
      const bounds = menu.getBoundingClientRect();
      if (!bounds.height) return;
      const next = resolveMenuPosition(anchor.getBoundingClientRect(), {
        menuWidth: bounds.width,
        estimatedHeight: bounds.height,
      });
      setMenuPosition(current => current.top === next.top && current.left === next.left ? current : next);
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [menu, resolveMenuPosition, surface]);

  useEffect(() => {
    if (surface !== "menu") return undefined;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      pressedElsewhereRef.current = true;
      onSurfaceChange(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSurfaceChange(null);
    };
    const dismissOnViewportChange = (event: Event) => {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
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
  }, [menu, onSurfaceChange, surface]);

  const openMenu = (anchor: HTMLElement) => {
    menuAnchorRef.current = anchor;
    setError(null);
    setMenuPosition(resolveMenuPosition(
      anchor.getBoundingClientRect(),
      { menuWidth, estimatedHeight: PROJECT_ACTION_MENU_ESTIMATED_HEIGHT },
    ));
    onSurfaceChange(surface === "menu" ? null : "menu");
  };

  /** The surface stays up, with the reason, when the project refuses the change. */
  const run = async (change: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await change();
      setPending(false);
      onSurfaceChange(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setPending(false);
    }
  };

  const renameProject = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (onRename && nextName) void run(() => onRename(nextName));
  };

  const projectActionsLabel = t("shell.workspaceSwitcher.projectActionsFor", {
    project: bidiIsolate(project.name),
  });
  const confirming = surface === "unlink" || surface === "delete" ? surface : null;
  const confirmedChange = confirming ? { unlink: onUnlink, delete: onDelete }[confirming] : undefined;

  return (
    <>
      <Tooltip content={t("shell.workspaceSwitcher.projectActions")}><button
        className={triggerClassName}
        type="button"
        tabIndex={triggerTabIndex}
        disabled={disabled}
        aria-label={projectActionsLabel}
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
            ref={setMenu}
            className="desktop-project-row-actions-menu"
            ariaLabel={projectActionsLabel}
            style={{ ...menuPosition, width: menuWidth }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Tab") {
                walkDesktopMenu(event, menu);
                return;
              }
              event.preventDefault();
              onSurfaceChange(null);
            }}
          >
            {project.path && <ProjectMenuHeader key={project.path} path={project.path} />}
            {onRename && (
              <DesktopMenuItem
                icon={<Pencil size={14} />}
                label={t("shell.workspaceSwitcher.renameProject")}
                onClick={() => {
                  setName(project.name);
                  setError(null);
                  onSurfaceChange("rename");
                }}
              />
            )}
            {onSharingSettings && (
              <DesktopMenuItem
                icon={<LocalIcon size={14} />}
                label={t("hosts.home.sharingSettings")}
                onClick={() => {
                  onSurfaceChange(null);
                  onSharingSettings();
                }}
              />
            )}
            {(onRename || onSharingSettings) && (onUnlink || onDelete) && <DesktopMenuSeparator />}
            {onUnlink && (
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
            {onDelete && (
              <DesktopMenuItem
                destructive
                icon={<Trash2 size={14} />}
                label={t("shell.workspaceSwitcher.deleteProject")}
                onClick={() => {
                  setError(null);
                  onSurfaceChange("delete");
                }}
              />
            )}
          </DesktopSidebarActionMenu>
        </DesktopOverlayLayer>
      )}

      {surface === "rename" && (
        <ProjectRowDialog
          labelledBy="desktop-project-rename-title"
          pending={pending}
          onClose={() => onSurfaceChange(null)}
          onSubmit={renameProject}
        >
          <ProjectRowDialogHeader
            titleId="desktop-project-rename-title"
            title={t("shell.workspaceSwitcher.renameProjectTitle")}
            pending={pending}
            onClose={() => onSurfaceChange(null)}
          />
          <div className="desktop-dialog-body">
            <label className="desktop-dialog-field">
              <span>{t("shell.workspaceSwitcher.projectName")}</span>
              <input
                ref={inputRef}
                value={name}
                maxLength={PROJECT_NAME_MAX_LENGTH[place]}
                disabled={pending}
                data-desktop-dialog-initial-focus="true"
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </label>
            <p className="desktop-dialog-note">
              {t(place === "cloud"
                ? "shell.workspaceSwitcher.renameCloudProjectDescription"
                : "shell.workspaceSwitcher.renameProjectDescription")}
            </p>
            {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
          </div>
          <footer className="desktop-dialog-footer">
            <button
              className="desktop-dialog-button"
              type="button"
              disabled={pending}
              onClick={() => onSurfaceChange(null)}
            >
              {t("common.action.cancel")}
            </button>
            <button
              className="desktop-dialog-button primary"
              type="submit"
              disabled={pending || !name.trim() || name.trim() === project.name}
            >
              {pending
                ? t("shell.workspaceSwitcher.renameProjectProgress")
                : t("common.action.save")}
            </button>
          </footer>
        </ProjectRowDialog>
      )}

      {confirming && confirmedChange && (
        <ProjectRowConfirmDialog
          kind={confirming}
          name={project.name}
          pending={pending}
          error={error}
          onClose={() => onSurfaceChange(null)}
          onConfirm={() => void run(confirmedChange)}
        />
      )}
    </>
  );
}

/** Cancel holds the focus: neither of these should be one Enter away. */
function ProjectRowConfirmDialog({
  kind,
  name,
  pending,
  error,
  onClose,
  onConfirm,
}: Readonly<{
  kind: keyof typeof PROJECT_CONFIRMATIONS;
  name: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  const { t } = useLocalization();
  const copy = PROJECT_CONFIRMATIONS[kind];
  const titleId = `desktop-project-${kind}-title`;
  return (
    <ProjectRowDialog labelledBy={titleId} pending={pending} onClose={onClose}>
      <ProjectRowDialogHeader titleId={titleId} title={t(copy.title)} pending={pending} onClose={onClose} />
      <div className="desktop-dialog-body">
        <p>{t(copy.description, { project: bidiIsolate(name) })}</p>
        {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
      </div>
      <footer className="desktop-dialog-footer">
        <button
          className="desktop-dialog-button"
          type="button"
          disabled={pending}
          data-desktop-dialog-initial-focus="true"
          onClick={onClose}
        >
          {t("common.action.cancel")}
        </button>
        <button
          className="desktop-dialog-button destructive"
          type="button"
          disabled={pending}
          onClick={onConfirm}
        >
          {t(pending ? copy.progress : copy.action)}
        </button>
      </footer>
    </ProjectRowDialog>
  );
}

/**
 * The confirmation surfaces a Project row can raise. They share one frame so
 * renaming, unlinking and deleting cannot drift apart in focus, dismissal or elevation.
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
