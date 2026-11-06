import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { useRef, useState, type ButtonHTMLAttributes } from "react";
import type { HostCatalogDevice, HostCatalogFolder } from "../../../../shared/host-contract/types";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { ProjectFolderGlyph } from "../../../components/onboarding/ProjectFolderGlyph";
import { useProjectListNavigation } from "../../../components/onboarding/useProjectListNavigation";
import type { HomepageProjectLayout } from "../../../preferenceStorage";

/**
 * One of the owner's other computers' folders, laid out exactly as the Homepage
 * lays out projects: the same folder, the same grid or rows, the same keys.
 * While that computer is offline its folders stay listed and cannot be opened.
 */
export function RemoteFolderList({ device, folders, layout, onOpen }: {
  device: HostCatalogDevice;
  folders: readonly HostCatalogFolder[];
  layout: HomepageProjectLayout;
  onOpen: (folder: HostCatalogFolder) => void;
}) {
  const { t } = useLocalization();
  const navigation = useProjectListNavigation(folders.map((folder) => folder.id), layout);
  const host = bidiIsolate(device.name);
  return (
    <ul ref={navigation.listRef} className="onboarding-project-list" data-project-layout={layout}
      aria-label={t("hosts.folder.onHost", { host })} onKeyDown={navigation.onKeyDown}>
      {folders.map((folder) => {
        const access = t(folder.capabilities.includes("folder.write") ? "hosts.catalog.editable" : "hosts.catalog.readOnly");
        const open = {
          "data-project-open": true,
          tabIndex: folder.id === navigation.stopId ? 0 : -1,
          disabled: !device.online,
          "aria-label": t("hosts.home.openFolder", { folder: bidiIsolate(folder.name), host }),
          onClick: () => onOpen(folder),
        };
        return (
          <li key={folder.id} className="onboarding-project-row-wrap" data-project-location="computer"
            data-host-folder={folder.id} onFocus={() => navigation.setFocusedId(folder.id)}>
            {layout === "grid"
              ? <RemoteFolderTile name={folder.name}
                place={device.online ? access : t("hosts.home.computerOffline", { host })} {...open} />
              : <DesktopMenuItem className="onboarding-project-row" role="button"
                icon={<span className="onboarding-project-icon" aria-hidden="true"><ProjectFolderGlyph /></span>}
                label={<bdi>{folder.name}</bdi>} detail={access} {...open} />}
          </li>
        );
      })}
    </ul>
  );
}

function RemoteFolderTile({ name, place, ...button }: { name: string; place: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const nameRef = useRef<HTMLElement>(null);
  const [nameCut, setNameCut] = useState(false);
  const measure = () => {
    const shown = nameRef.current;
    setNameCut(Boolean(shown && shown.scrollWidth > shown.clientWidth));
  };
  return (
    <Tooltip content={[nameCut && name, place].filter(Boolean).join(" · ")}>
      <button type="button" className="onboarding-project-tile" onPointerEnter={measure} onFocus={measure} {...button}>
        <span className="onboarding-project-folder" aria-hidden="true"><ProjectFolderGlyph /></span>
        <bdi ref={nameRef} className="onboarding-project-tile-name">{name}</bdi>
      </button>
    </Tooltip>
  );
}
