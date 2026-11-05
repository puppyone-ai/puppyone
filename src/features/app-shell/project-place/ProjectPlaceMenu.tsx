import { useEffect, useRef, useState } from "react";
import { Check, History } from "lucide-react";
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
  /** A hosted project's own record; absent where it has none to show. */
  onOpenHistory?: () => void;
}>;

export type ProjectPlaceMenuProps = Readonly<{
  menu: ProjectPlaceMenu;
  handlers: ProjectPlaceHandlers;
}>;

/**
 * Where the open project is, in the Header, and the one thing to do about it:
 * put a folder in the Cloud, or open the other project of a linked pair. The
 * mark says which kind of place it is, so the words say where: the folder that
 * holds a local project, or the organization that holds a Cloud project.
 */
export function ProjectPlaceMenuControl({ menu, handlers, projectMenuOpen = false, onOpen }: ProjectPlaceMenuProps & {
  projectMenuOpen?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const placeLabel = useProjectPlaceLabel(menu.place);
  const address = menu.address;
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);
  return <div className="desktop-titlebar-place-wrap">
    <button ref={anchor} type="button" className="desktop-titlebar-place-button"
      data-project-place={menu.place} data-place-action={menu.action?.kind}
      aria-haspopup="dialog" aria-expanded={open}
      aria-label={[placeLabel, address?.full, t("cloud.placeMenu.label")].filter(Boolean).join(", ")}
      onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}>
      <span className="desktop-titlebar-workspace-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={16} strokeWidth={1.75} /> : <LocalIcon size={16} strokeWidth={1.75} />}
      </span>
      {address
        ? <span className="desktop-titlebar-place-address"><PlaceAddress place={menu.place} text={address.short} /></span>
        : <span>{placeLabel}</span>}
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
 * The current place as a fact, then the one Cloud action that applies.
 * Invitations belong to the Cloud project, never to this local folder.
 */
export function ProjectPlaceRows({ menu, handlers, onDismiss }: ProjectPlaceMenuProps & { onDismiss: () => void }) {
  const { t } = useLocalization();
  const placeLabel = useProjectPlaceLabel(menu.place);
  const run = (action?: () => void) => action && (() => { onDismiss(); action(); });
  return <section className="desktop-project-place-rows" aria-label={t("cloud.placeMenu.label")}>
    <DesktopMenuItem className="desktop-project-place-row" role="button" aria-current="true" aria-disabled="true"
      data-project-place-row="current" selected
      icon={<span className="desktop-project-place-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={15} strokeWidth={1.75} /> : <LocalIcon size={15} strokeWidth={1.75} />}
      </span>}
      label={placeLabel} detail={menu.address ? <PlaceAddress place={menu.place} text={menu.address.full} /> : undefined}
      trailing={<Check size={14} aria-hidden="true" />} />
    {menu.action && <>
      <DesktopMenuSeparator />
      <ProjectPlaceActionRow action={menu.action} handlers={handlers} onDismiss={onDismiss} />
    </>}
    {handlers.onOpenHistory && <>
      <DesktopMenuSeparator />
      <DesktopMenuItem className="desktop-project-place-row" role="button" data-project-place-row="history"
        icon={<History size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("source-control.history.title")} onClick={run(handlers.onOpenHistory)} />
    </>}
  </section>;
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

/** A folder path always reads left to right; an organization's name follows its own script. */
function PlaceAddress({ place, text }: { place: ProjectPlaceMenu["place"]; text: string }) {
  return place === "local" ? <bdi dir="ltr">{text}</bdi> : <bdi>{text}</bdi>;
}

function useProjectPlaceLabel(place: "local" | "cloud") {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  if (place === "cloud") return t("cloud.home.location.cloud");
  return t(platform?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}
