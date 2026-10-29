import { useEffect, useRef, useState } from "react";
import { Check, Plug, UserPlus } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudIcon, CloudUploadIcon, LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { useDesktopPlatformCapabilities } from "../../../platform";
import type { ProjectPlaceAction, ProjectPlaceMenu } from "./projectPlaceMenuState";
import "./project-place.css";

export type ProjectPlaceHandlers = Readonly<{
  onPutInCloud: () => void;
  onOpenCloudProject: (projectId: string) => void;
  onSignIn: () => void;
  onPutInCloudAgain: () => void;
  onOpenLocalFolder: (path: string) => void;
  /** Sharing is part of putting a folder in the Cloud; absent when sharing is off. */
  onInvitePerson?: () => void;
  onConnectAgent?: () => void;
}>;

export type ProjectPlaceMenuProps = Readonly<{
  menu: ProjectPlaceMenu;
  handlers: ProjectPlaceHandlers;
}>;

/**
 * Where the open project is, in the Header, and the one thing to do about it:
 * put a folder in the Cloud, or open the other project of a linked pair.
 */
export function ProjectPlaceMenuControl({ menu, handlers, projectMenuOpen = false, onOpen }: ProjectPlaceMenuProps & {
  projectMenuOpen?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const placeLabel = useProjectPlaceLabel(menu.place);
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);
  return <div className="desktop-titlebar-place-wrap">
    <button ref={anchor} type="button" className="desktop-titlebar-place-button"
      data-project-place={menu.place} data-place-action={menu.action?.kind}
      aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${placeLabel}, ${t("cloud.placeMenu.label")}`}
      onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}>
      <span className="desktop-titlebar-workspace-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={16} strokeWidth={1.75} /> : <LocalIcon size={16} strokeWidth={1.75} />}
      </span>
      <span>{placeLabel}</span>
    </button>
    <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
      dismissOnFocusExit={false} className="desktop-project-place-menu" gap={2}
      preferredWidth={280} preferredMaxHeight={200} widthMode="content" alignment="start" role="dialog"
      ariaLabel={t("cloud.placeMenu.label")}>
      <ProjectPlaceRows menu={menu} handlers={handlers} onDismiss={() => setOpen(false)} />
    </DesktopTitlebarMenuLayer>
  </div>;
}

/**
 * The current place as a fact, then the Cloud action. Inviting a person and
 * connecting an agent sit under it: they are part of going to the Cloud, not
 * separate tools.
 */
export function ProjectPlaceRows({ menu, handlers, onDismiss }: ProjectPlaceMenuProps & { onDismiss: () => void }) {
  const { t } = useLocalization();
  const placeLabel = useProjectPlaceLabel(menu.place);
  const sharing = menu.action && sharesThroughCloud(menu.action) ? handlers : null;
  const run = (action?: () => void) => action && (() => { onDismiss(); action(); });
  return <section className="desktop-project-place-rows" aria-label={t("cloud.placeMenu.label")}>
    <DesktopMenuItem className="desktop-project-place-row" role="button" aria-current="true" aria-disabled="true"
      data-project-place-row="current" selected
      icon={<span className="desktop-project-place-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={15} strokeWidth={1.75} /> : <LocalIcon size={15} strokeWidth={1.75} />}
      </span>}
      label={placeLabel} trailing={<Check size={14} aria-hidden="true" />} />
    {menu.action && <>
      <DesktopMenuSeparator />
      <ProjectPlaceActionRow action={menu.action} handlers={handlers} onDismiss={onDismiss} />
      {sharing?.onInvitePerson && <DesktopMenuItem className="desktop-project-place-row desktop-project-place-subrow"
        role="button" data-project-place-row="invite-person" icon={<UserPlus size={14} strokeWidth={1.8} />}
        label={t("shell.projectReach.invitePerson")} onClick={run(sharing.onInvitePerson)} />}
      {sharing?.onConnectAgent && <DesktopMenuItem className="desktop-project-place-row desktop-project-place-subrow"
        role="button" data-project-place-row="connect-agent" icon={<Plug size={14} strokeWidth={1.8} />}
        label={t("shell.projectReach.connectAgent")} onClick={run(sharing.onConnectAgent)} />}
    </>}
  </section>;
}

/** Inviting and connecting reach this folder's Cloud project, new or existing. */
function sharesThroughCloud(action: ProjectPlaceAction) {
  return action.kind === "put-in-cloud" || action.kind === "open-cloud-project";
}

function ProjectPlaceActionRow({ action, handlers, onDismiss }: {
  action: ProjectPlaceAction;
  handlers: ProjectPlaceHandlers;
  onDismiss: () => void;
}) {
  const row = useProjectPlaceActionRow(action, handlers);
  return <DesktopMenuItem className="desktop-project-place-row" role="button"
    data-project-place-row={action.kind}
    icon={<span className="desktop-project-place-mark" data-project-place={row.place} aria-hidden="true">{row.icon}</span>}
    label={row.label} detail={row.detail}
    onClick={() => { onDismiss(); row.run(); }} />;
}

function useProjectPlaceActionRow(action: ProjectPlaceAction, handlers: ProjectPlaceHandlers) {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  const device = platform?.platform === "macos" ? "mac" : "computer";
  switch (action.kind) {
    case "put-in-cloud":
      return { place: "cloud", icon: <CloudUploadIcon size={15} strokeWidth={1.75} />,
        label: t(action.continuing ? "cloud.placeMenu.continuePutInCloud" : "cloud.placeMenu.putInCloud"),
        detail: undefined, run: handlers.onPutInCloud };
    case "open-cloud-project":
      return { place: "cloud", icon: <CloudIcon size={15} strokeWidth={1.75} />,
        label: t("cloud.localFolderNotice.openProject"),
        detail: action.projectName ? bidiIsolate(action.projectName) : undefined,
        run: () => handlers.onOpenCloudProject(action.projectId) };
    case "sign-in":
      return { place: "cloud", icon: <CloudIcon size={15} strokeWidth={1.75} />,
        label: t("cloud.auth.signIn"), detail: undefined, run: handlers.onSignIn };
    case "put-in-cloud-again":
      return { place: "cloud", icon: <CloudUploadIcon size={15} strokeWidth={1.75} />,
        label: t("cloud.localFolderNotice.putInCloud"), detail: undefined,
        run: handlers.onPutInCloudAgain };
    case "open-local-folder":
      return { place: "local", icon: <LocalIcon size={15} strokeWidth={1.75} />,
        label: t(`cloud.placeMenu.openFolder.${device}`), detail: bidiIsolate(action.name),
        run: () => handlers.onOpenLocalFolder(action.path) };
  }
}

function useProjectPlaceLabel(place: "local" | "cloud") {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  if (place === "cloud") return t("cloud.home.location.cloud");
  return t(platform?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}
