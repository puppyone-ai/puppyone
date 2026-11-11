import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { SpaceMark, useSpaceName } from "../../cloud";
import { cloudLinkHasProblem, cloudLinkProblemMessage, type ProjectPlaceCloudLink, type ProjectPlaceMenu } from "./projectPlaceMenuState";
import { LOCAL_PLACE, WindowNavigationRows } from "../../../components/WindowNavigationRows";
import "./project-place.css";

export type ProjectPlaceMenuProps = Readonly<{
  menu: ProjectPlaceMenu;
  /** Back to Home, where every place and its folders are. */
  onHome?: () => void;
}>;

/**
 * Where the open folder is, first in the Header, read like a path from the
 * Space to the folder: the Space that holds a Cloud folder, this computer, or
 * another computer. A small cloud after this computer says the folder has a
 * copy in the Cloud.
 *
 * Its menu is the window's way elsewhere and nothing more: back to Home, to
 * another place, and to the account. Who can open a folder is set on Home.
 */
export function ProjectPlaceMenuControl({ menu, onHome, projectMenuOpen = false, onOpen }: ProjectPlaceMenuProps & {
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
      data-project-place={menu.place} data-place-space={menu.space ? "" : undefined}
      data-cloud-link={cloudLinkState(menu.link)}
      aria-haspopup="menu" aria-expanded={open}
      aria-label={[...place.spoken, menu.link && linkLabel(menu.link),
        t("shell.placeMenu.label")].filter(Boolean).join(", ")}
      onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}>
      <span className="desktop-titlebar-workspace-mark" aria-hidden="true">
        <ProjectPlaceMark menu={menu} />
      </span>
      <span className="desktop-titlebar-place-address"><bdi>{place.name}</bdi></span>
      {menu.link && <span className="desktop-titlebar-place-link" aria-hidden="true">
        <CloudIcon size={13} strokeWidth={1.9} />
      </span>}
    </button>
    <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
      className="desktop-project-place-menu" gap={2} preferredWidth={240} preferredMaxHeight={560}
      widthMode="content" alignment="start" ariaLabel={t("shell.placeMenu.label")} focusOnOpen>
      <WindowNavigationRows current={currentPlace(menu)} onHome={onHome} onDismiss={() => setOpen(false)} />
    </DesktopTitlebarMenuLayer>
  </div>;
}

/** The open folder's place among the window's places, where it is one of them. */
function currentPlace(menu: ProjectPlaceMenu) {
  if (menu.space) return menu.space.id;
  return menu.place === "local" ? LOCAL_PLACE : null;
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

/** The kind of place by its shape: a Space's square, a computer, or the Cloud while its Space is unknown. */
function ProjectPlaceMark({ menu }: { menu: ProjectPlaceMenu }) {
  if (menu.space) return <SpaceMark space={menu.space} size="md" />;
  return menu.place === "cloud"
    ? <CloudIcon size={16} strokeWidth={1.75} />
    : <LocalIcon size={16} strokeWidth={1.75} />;
}

/**
 * The place as the Header names it, and as it is spoken: a Space and the
 * account's role in it, this computer and the folder's path, a named computer
 * and its access, or the organization that holds a Cloud folder until its
 * Space is known.
 */
function useProjectPlaceName(menu: ProjectPlaceMenu): { name: string; spoken: readonly string[] } {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  const spaceName = useSpaceName();
  if (menu.space) {
    const name = spaceName(menu.space);
    const role = menu.space.role && SPACE_ROLES.has(menu.space.role) ? t(`settings.space.role.${menu.space.role}`) : undefined;
    return { name, spoken: role ? [name, role] : [name] };
  }
  if (menu.place === "computer") {
    const name = menu.label ?? menu.address?.short ?? "";
    return { name, spoken: menu.detail ? [name, menu.detail] : [name] };
  }
  if (menu.place === "cloud") {
    const kind = t("cloud.home.location.cloud");
    return menu.address ? { name: menu.address.short, spoken: [kind, menu.address.full] } : { name: kind, spoken: [kind] };
  }
  const name = t(platform?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
  return { name, spoken: menu.address ? [name, menu.address.full] : [name] };
}

const SPACE_ROLES = new Set(["owner", "member", "viewer"]);
