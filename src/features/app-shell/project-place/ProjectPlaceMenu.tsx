import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { ProjectAudienceRows, type ProjectAudience } from "../../../components/project-audience";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { cloudLinkHasProblem, type ProjectPlaceAction, type ProjectPlaceCloudLink, type ProjectPlaceMenu } from "./projectPlaceMenuState";
import "./project-place.css";

export type ProjectPlaceHandlers = Readonly<{
  onOpenLocalFolder: (path: string) => void;
  /** A hosted project's own record; absent where it has none to show. */
  onOpenHistory?: () => void;
}>;

export type ProjectPlaceMenuProps = Readonly<{
  menu: ProjectPlaceMenu;
  handlers: ProjectPlaceHandlers;
  /**
   * Who can open a local project, and the way to change it: my devices directly, a
   * team through a copy in the Cloud. Absent where neither is available.
   */
  audience?: ProjectAudience | null;
}>;

/**
 * Where the open project is, in the Header, and who can open it. The mark says
 * which kind of place it is, so the words say where: the folder that holds a local
 * project, or the organization that holds a Cloud project. A small cloud after a
 * folder's address says the folder has a copy in the Cloud.
 */
export function ProjectPlaceMenuControl({ menu, handlers, audience, projectMenuOpen = false, onOpen }: ProjectPlaceMenuProps & {
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
      <ProjectPlaceRows menu={menu} handlers={handlers} audience={audience} onDismiss={() => setOpen(false)} />
    </DesktopTitlebarMenuLayer>
  </div>;
}

/**
 * Where the project is, as a fact, then what can be done about it. A local project
 * says who can open it, in the Homepage's three audiences; a Cloud project offers
 * the folder linked to it. Invitations belong to the Cloud project, never here.
 */
export function ProjectPlaceRows({ menu, handlers, audience, onDismiss }: ProjectPlaceMenuProps & { onDismiss: () => void }) {
  const { t } = useLocalization();
  const placeLabel = useProjectPlaceLabel(menu.place, menu.label);
  const run = (action?: () => void) => action && (() => { onDismiss(); action(); });
  // A local project's audiences carry its Cloud copy and its other computers.
  const byAudience = menu.place === "local" ? audience : null;
  return <section className="desktop-project-place-rows" aria-label={t("cloud.placeMenu.label")}>
    <DesktopMenuItem className="desktop-project-place-row" role="button" aria-current="true" aria-disabled="true"
      data-project-place-row="current"
      icon={<span className="desktop-project-place-mark" aria-hidden="true">
        {menu.place === "cloud" ? <CloudIcon size={15} strokeWidth={1.75} /> : <LocalIcon size={15} strokeWidth={1.75} />}
      </span>}
      label={placeLabel} detail={menu.detail ?? (menu.address ? <PlaceAddress place={menu.place} text={menu.address.full} /> : undefined)} />
    {byAudience && <>
      <DesktopMenuSeparator />
      <ProjectAudienceRows audience={byAudience} onDismiss={onDismiss} />
    </>}
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
  return { place: "local", icon: <LocalIcon size={15} strokeWidth={1.75} />,
    label: t(`cloud.placeMenu.openFolder.${device}`), detail: bidiIsolate(action.name),
    run: () => handlers.onOpenLocalFolder(action.path) };
}

function cloudLinkState(link: ProjectPlaceCloudLink | null | undefined) {
  if (!link) return undefined;
  return cloudLinkHasProblem(link) ? "problem" : "linked";
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
