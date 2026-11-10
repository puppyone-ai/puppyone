import { useEffect, useRef, useState } from "react";
import { History, UsersRound } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { ProjectAudienceRows, type ProjectAudience } from "../../../components/project-audience";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { SpaceMark, SpacePlanBadge, useSpaceName } from "../../cloud/spaces/SpaceMark";
import { useWindowNavigation } from "../../../components/WindowNavigation";
import { LOCAL_PLACE, WindowNavigationRows, windowNavigationHasRows } from "./WindowNavigationRows";
import { cloudLinkHasProblem, cloudLinkProblemMessage, type ProjectPlaceAction, type ProjectPlaceCloudLink, type ProjectPlaceMenu } from "./projectPlaceMenuState";
import "./project-place.css";

export type ProjectPlaceHandlers = Readonly<{
  onOpenLocalFolder: (path: string) => void;
  /** A hosted project's own record; absent where it has none to show. */
  onOpenHistory?: () => void;
  /** The members, seats and plan of the Space that holds a Cloud project. */
  onManageSpace?: () => void;
}>;

export type ProjectPlaceMenuProps = Readonly<{
  menu: ProjectPlaceMenu;
  handlers: ProjectPlaceHandlers;
  /**
   * Who can open a local project, and the way to change it: my devices directly, a
   * team through a copy in the Cloud. Absent where neither is available.
   */
  audience?: ProjectAudience | null;
  /** Back to Home, where every place and its projects are. */
  onHome?: () => void;
}>;

/**
 * Where the open project is, first in the Header, read like a path from the
 * largest place to the project: the Space that holds a Cloud project, this
 * computer, or another computer. A folder's path is a detail of this computer,
 * so it stays in the menu. A small cloud after this computer says the folder
 * has a copy in the Cloud.
 *
 * The menu is also the window's way out: back to Home, to another place, and
 * to the account, so the Header's trailing end keeps the project's tools only.
 */
export function ProjectPlaceMenuControl({ menu, handlers, audience, onHome, projectMenuOpen = false, onOpen }: ProjectPlaceMenuProps & {
  projectMenuOpen?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const place = useProjectPlaceName(menu);
  const linkLabel = useCloudLinkLabel();
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);
  return <div className="desktop-titlebar-place-wrap">
    <button ref={anchor} type="button" className="desktop-titlebar-place-button"
      data-project-place={menu.place} data-place-space={menu.space ? "" : undefined} data-place-action={menu.action?.kind}
      data-cloud-link={cloudLinkState(menu.link)}
      aria-haspopup="dialog" aria-expanded={open}
      aria-label={[...place.spoken, menu.link && linkLabel(menu.link),
        t("cloud.placeMenu.label")].filter(Boolean).join(", ")}
      onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}>
      <span className="desktop-titlebar-workspace-mark" aria-hidden="true">
        <ProjectPlaceMark menu={menu} size={16} />
      </span>
      <span className="desktop-titlebar-place-address"><bdi>{place.name}</bdi></span>
      {menu.link && <span className="desktop-titlebar-place-link" aria-hidden="true">
        <CloudIcon size={13} strokeWidth={1.9} />
      </span>}
    </button>
    <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
      dismissOnFocusExit={false} className="desktop-project-place-menu" gap={2}
      preferredWidth={280} preferredMaxHeight={560} widthMode="content" alignment="start" role="dialog"
      ariaLabel={t("cloud.placeMenu.label")}>
      <ProjectPlaceRows menu={menu} handlers={handlers} audience={audience} onHome={onHome} onDismiss={() => setOpen(false)} />
    </DesktopTitlebarMenuLayer>
  </div>;
}

/**
 * Where the project is, as a fact, then what can be done about it. A local project
 * says who can open it, in the Homepage's three audiences; a Cloud project offers
 * the folder linked to it. Invitations belong to the Cloud project, never here.
 * Then the window's places and the account.
 */
export function ProjectPlaceRows({ menu, handlers, audience, onHome, onDismiss }: ProjectPlaceMenuProps & { onDismiss: () => void }) {
  const { t } = useLocalization();
  const place = useProjectPlaceName(menu);
  const navigation = useWindowNavigation();
  const run = (action?: () => void) => action && (() => { onDismiss(); action(); });
  // A local project's audiences carry its Cloud copy and its other computers.
  const byAudience = menu.place === "local" ? audience : null;
  const { space } = menu;
  return <section className="desktop-project-place-rows" aria-label={t("cloud.placeMenu.label")}>
    <DesktopMenuItem className="desktop-project-place-row" role="button" aria-current="true" aria-disabled="true"
      data-project-place-row="current" data-place-space={space ? "" : undefined}
      icon={<span className="desktop-project-place-mark" aria-hidden="true">
        <ProjectPlaceMark menu={menu} size={15} large />
      </span>}
      label={space
        ? <span className="desktop-project-place-space-name"><bdi>{place.name}</bdi><SpacePlanBadge planId={space.planId} /></span>
        : <bdi>{menu.place === "cloud" ? place.spoken[0] : place.name}</bdi>}
      detail={space ? place.detail : menu.detail ?? (menu.address ? <PlaceAddress place={menu.place} text={menu.address.full} /> : undefined)} />
    {menu.place === "cloud" && handlers.onManageSpace && <>
      {space && <DesktopMenuSeparator />}
      <DesktopMenuItem className="desktop-project-place-row" role="button"
        data-project-place-row="space" icon={<UsersRound size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("settings.space.manage")} onClick={run(handlers.onManageSpace)} />
    </>}
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
    {windowNavigationHasRows(navigation, onHome) && <>
      <DesktopMenuSeparator />
      <WindowNavigationRows current={currentPlace(menu)} onHome={onHome} onDismiss={onDismiss} itemRole="button" />
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

/** The link as the button's name says it: linked, or what keeps it from opening. */
function useCloudLinkLabel() {
  const { t } = useLocalization();
  return (link: ProjectPlaceCloudLink) => {
    const problem = cloudLinkHasProblem(link) ? cloudLinkProblemMessage(link.notice) : null;
    return problem ? t(problem.id, problem.values) : t("cloud.placeMenu.link.linked");
  };
}

function cloudLinkState(link: ProjectPlaceCloudLink | null | undefined) {
  if (!link) return undefined;
  return cloudLinkHasProblem(link) ? "problem" : "linked";
}

/** The open project's place among the window's places, where it is one of them. */
function currentPlace(menu: ProjectPlaceMenu) {
  if (menu.space) return menu.space.id;
  return menu.place === "local" ? LOCAL_PLACE : null;
}

/** A folder path always reads left to right; an organization's name follows its own script. */
function PlaceAddress({ place, text }: { place: ProjectPlaceMenu["place"]; text: string }) {
  return place === "local" ? <bdi dir="ltr">{text}</bdi> : <bdi>{text}</bdi>;
}

/** The kind of place by its shape: a Space's square, a computer, or the Cloud while its Space is unknown. */
function ProjectPlaceMark({ menu, size, large = false }: { menu: ProjectPlaceMenu; size: number; large?: boolean }) {
  if (menu.space) return <SpaceMark space={menu.space} size={large ? "lg" : "md"} />;
  return menu.place === "cloud"
    ? <CloudIcon size={size} strokeWidth={1.75} />
    : <LocalIcon size={size} strokeWidth={1.75} />;
}

/**
 * The place as the Header names it, and what the menu says under that name: a
 * Space and the account's role in it, this computer, a named computer, or the
 * organization that holds a Cloud project until its Space is known.
 */
function useProjectPlaceName(menu: ProjectPlaceMenu): { name: string; detail?: string; spoken: readonly string[] } {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  const spaceName = useSpaceName();
  if (menu.space) {
    const name = spaceName(menu.space);
    const role = menu.space.role && SPACE_ROLES.has(menu.space.role) ? t(`settings.space.role.${menu.space.role}`) : undefined;
    return { name, detail: role, spoken: role ? [name, role] : [name] };
  }
  if (menu.place === "computer") {
    const name = menu.label ?? menu.address?.short ?? "";
    return { name, spoken: [name] };
  }
  if (menu.place === "cloud") {
    const kind = t("cloud.home.location.cloud");
    return menu.address ? { name: menu.address.short, spoken: [kind, menu.address.full] } : { name: kind, spoken: [kind] };
  }
  const name = t(platform?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
  return { name, detail: menu.address?.full, spoken: menu.address ? [name, menu.address.full] : [name] };
}

const SPACE_ROLES = new Set(["owner", "member", "viewer"]);
