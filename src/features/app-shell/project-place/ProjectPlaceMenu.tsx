import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, History, Unlink } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudIcon, CloudUploadIcon, LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { useDesktopPlatformCapabilities } from "../../../platform";
import type { LocalFolderCloudNotice } from "../../cloud";
import { cloudLinkHasProblem, type ProjectPlaceAction, type ProjectPlaceCloudLink, type ProjectPlaceMenu } from "./projectPlaceMenuState";
import "./project-place.css";

export type ProjectPlaceHandlers = Readonly<{
  onPutInCloud: () => void;
  onOpenCloudProject: (projectId: string) => void;
  onSignIn: () => void;
  /** Checks an unreachable link again. */
  onRetryCloudLink: () => void;
  /** Asks to end the open folder's Cloud link. */
  onDisconnectCloudLink: () => void;
  onOpenLocalFolder: (path: string) => void;
  /** A hosted project's own record; absent where it has none to show. */
  onOpenHistory?: () => void;
}>;

export type ProjectPlaceMenuProps = Readonly<{
  menu: ProjectPlaceMenu;
  handlers: ProjectPlaceHandlers;
  /** Who else may open this folder: the owner's other computers. Absent where that is off. */
  hostRows?: (dismiss: () => void) => ReactNode;
}>;

/**
 * Where the open project is, in the Header, and the one thing to do about it:
 * put a folder in the Cloud, see and end its link to a Cloud project, or open
 * the other project of a linked pair. The mark says which kind of place it is,
 * so the words say where: the folder that holds a local project, or the
 * organization that holds a Cloud project. A small cloud after a folder's
 * address says the folder is linked to a Cloud project.
 */
export function ProjectPlaceMenuControl({ menu, handlers, hostRows, projectMenuOpen = false, onOpen }: ProjectPlaceMenuProps & {
  projectMenuOpen?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const placeLabel = useProjectPlaceLabel(menu.place, menu.label);
  const address = menu.address;
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);
  return <div className="desktop-titlebar-place-wrap">
    <button ref={anchor} type="button" className="desktop-titlebar-place-button"
      data-project-place={menu.place} data-place-action={menu.action?.kind}
      data-cloud-link={cloudLinkState(menu.link)}
      aria-haspopup="dialog" aria-expanded={open}
      aria-label={[placeLabel, address?.full !== placeLabel && address?.full, menu.link && t("cloud.placeMenu.link.linked"),
        t("cloud.placeMenu.label")].filter(Boolean).join(", ")}
      onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}>
      <span className="desktop-titlebar-workspace-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={16} strokeWidth={1.75} /> : <LocalIcon size={16} strokeWidth={1.75} />}
      </span>
      {address
        ? <span className="desktop-titlebar-place-address"><PlaceAddress place={menu.place} text={address.short} /></span>
        : <span>{placeLabel}</span>}
      {menu.link && <span className="desktop-titlebar-place-link" aria-hidden="true">
        <CloudIcon size={13} strokeWidth={1.9} />
      </span>}
    </button>
    <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
      dismissOnFocusExit={false} className="desktop-project-place-menu" gap={2}
      preferredWidth={280} preferredMaxHeight={260} widthMode="content" alignment="start" role="dialog"
      ariaLabel={t("cloud.placeMenu.label")}>
      <ProjectPlaceRows menu={menu} handlers={handlers} hostRows={hostRows} onDismiss={() => setOpen(false)} />
    </DesktopTitlebarMenuLayer>
  </div>;
}

/**
 * The current place as a fact, then the one Cloud action that applies, or the
 * folder's Cloud link and the way to end it. Invitations belong to the Cloud
 * project, never to this local folder.
 */
export function ProjectPlaceRows({ menu, handlers, hostRows, onDismiss }: ProjectPlaceMenuProps & { onDismiss: () => void }) {
  const { t } = useLocalization();
  const placeLabel = useProjectPlaceLabel(menu.place, menu.label);
  const run = (action?: () => void) => action && (() => { onDismiss(); action(); });
  return <section className="desktop-project-place-rows" aria-label={t("cloud.placeMenu.label")}>
    <DesktopMenuItem className="desktop-project-place-row" role="button" aria-current="true" aria-disabled="true"
      data-project-place-row="current" selected
      icon={<span className="desktop-project-place-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={15} strokeWidth={1.75} /> : <LocalIcon size={15} strokeWidth={1.75} />}
      </span>}
      label={placeLabel} detail={menu.detail ?? (menu.address ? <PlaceAddress place={menu.place} text={menu.address.full} /> : undefined)}
      trailing={<Check size={14} aria-hidden="true" />} />
    {menu.action && <>
      <DesktopMenuSeparator />
      <ProjectPlaceActionRow action={menu.action} handlers={handlers} onDismiss={onDismiss} />
    </>}
    {menu.link && <>
      <DesktopMenuSeparator />
      <ProjectPlaceCloudLinkRows link={menu.link} handlers={handlers} onDismiss={onDismiss} />
    </>}
    {hostRows && menu.place === "local" && <>
      <DesktopMenuSeparator />
      {hostRows(onDismiss)}
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
    case "open-local-folder":
      return { place: "local", icon: <LocalIcon size={15} strokeWidth={1.75} />,
        label: t(`cloud.placeMenu.openFolder.${device}`), detail: bidiIsolate(action.name),
        run: () => handlers.onOpenLocalFolder(action.path) };
  }
}

function cloudLinkState(link: ProjectPlaceCloudLink | null | undefined) {
  if (!link) return undefined;
  return cloudLinkHasProblem(link) ? "problem" : "linked";
}

/**
 * The linked Cloud project, then ending the link. The project row opens it when
 * it can be opened from here; otherwise its second line says why not.
 */
function ProjectPlaceCloudLinkRows({ link, handlers, onDismiss }: {
  link: ProjectPlaceCloudLink;
  handlers: ProjectPlaceHandlers;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const row = useCloudLinkRow(link.notice, handlers);
  return <>
    <DesktopMenuItem className="desktop-project-place-row" role="button" data-project-place-row="cloud-link"
      data-cloud-link={cloudLinkState(link)}
      aria-disabled={row.run ? undefined : "true"}
      icon={<span className="desktop-project-place-mark" data-project-place="cloud" aria-hidden="true">
        <CloudIcon size={15} strokeWidth={1.75} />
      </span>}
      label={row.label} detail={row.detail}
      trailing={row.opens ? <ArrowUpRight size={14} aria-hidden="true" /> : undefined}
      onClick={row.run && (() => { onDismiss(); row.run?.(); })} />
    {link.disconnectable && <DesktopMenuItem className="desktop-project-place-row" role="button"
      data-project-place-row="disconnect"
      icon={<span className="desktop-project-place-mark" aria-hidden="true"><Unlink size={15} strokeWidth={1.75} /></span>}
      label={t("cloud.placeMenu.link.disconnect")}
      onClick={() => { onDismiss(); handlers.onDisconnectCloudLink(); }} />}
  </>;
}

function useCloudLinkRow(notice: LocalFolderCloudNotice, handlers: ProjectPlaceHandlers): {
  label: string;
  detail?: string;
  run?: () => void;
  opens?: boolean;
} {
  const { t } = useLocalization();
  const unnamed = t("cloud.placeMenu.link.unnamed");
  switch (notice.kind) {
    case "linked":
      return { label: notice.projectName ? bidiIsolate(notice.projectName) : unnamed, opens: notice.openable,
        run: notice.openable ? () => handlers.onOpenCloudProject(notice.projectId) : undefined };
    case "sign-in":
      return { label: unnamed, detail: t("cloud.placeMenu.link.signIn"), run: handlers.onSignIn };
    case "other-environment":
      return { label: unnamed, detail: notice.origin
        ? t("cloud.placeMenu.link.otherEnvironment", { origin: hostOf(notice.origin) })
        : t("cloud.placeMenu.link.otherEnvironmentUnknown") };
    case "missing":
      return { label: unnamed, detail: t("cloud.placeMenu.link.missing") };
    case "no-access":
      return { label: unnamed, detail: t("cloud.placeMenu.link.noAccess") };
    case "ambiguous":
      return { label: unnamed, detail: t("cloud.placeMenu.link.ambiguous") };
    case "unreachable":
      return { label: unnamed, detail: t("cloud.placeMenu.link.unreachable"), run: handlers.onRetryCloudLink };
  }
}

/** `http://localhost:9090` reads as `localhost:9090`. */
function hostOf(origin: string) {
  try { return new URL(origin).host || origin; } catch { return origin; }
}

/** A folder path always reads left to right; an organization's name follows its own script. */
function PlaceAddress({ place, text }: { place: ProjectPlaceMenu["place"]; text: string }) {
  return place === "local" ? <bdi dir="ltr">{text}</bdi> : <bdi>{text}</bdi>;
}

function useProjectPlaceLabel(place: ProjectPlaceMenu["place"], computerName?: string) {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  if (place === "computer") return computerName ?? "";
  if (place === "cloud") return t("cloud.home.location.cloud");
  return t(platform?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}
