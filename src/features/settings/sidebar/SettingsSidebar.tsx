import { useDesktopPreference } from "../../../preferencesStore";
import { useAccountAvailable, useHostDevicesEnabled } from "../../flags";
import { SidebarRoot, SidebarRow, SidebarScrollArea } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { SidebarGroup } from "../../../components/sidebar";
import { SpaceMark, SpacePlanBadge } from "../../cloud/spaces/SpaceMark";
import type { SettingsSidebarProps } from "../types";
import { resolveSettingsSidebarGroups } from "./settingsSidebarModel";

export function SettingsSidebar({ activeSection, cloudEnabled, currentSpace, currentSpaceId, currentSpaceName, localWorkspaceAvailable = true, onSelectSection }: SettingsSidebarProps) {
  const otherAppImportsEnabled = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  const { t } = useLocalization();
  const accountAvailable = useAccountAvailable();
  const hostDevicesEnabled = useHostDevicesEnabled();
  const groups = resolveSettingsSidebarGroups({ currentSpaceAvailable: Boolean(currentSpaceId), cloudEnabled, accountAvailable, otherAppImportsEnabled, localWorkspaceAvailable, hostDevicesEnabled });

  return (
    <SidebarRoot className="desktop-settings-sidebar" aria-label={t("settings.sidebar.desktopApp")}>
      <SidebarScrollArea>
        {groups.map((group) => (
          <SidebarGroup title={group.id === "space" && currentSpaceName
            ? <span className="desktop-settings-space-heading">
              {currentSpace && <SpaceMark space={currentSpace} />}
              <bdi>{currentSpaceName}</bdi>
              {currentSpace && <SpacePlanBadge planId={currentSpace.planId} />}
            </span>
            : t(group.labelId)} key={group.id}>
            {group.items.map((section) => {
              const Icon = section.icon;
              const active = section.id === activeSection;
              const label = t(section.labelId);
              return (
                <SidebarRow key={section.id}
                  active={active}
                  aria-current={active ? "page" : undefined}
                  disabled={section.disabled}
                  aria-disabled={section.disabled}
                  icon={<Icon size={15} />}
                  label={label}
                  onClick={() => onSelectSection(section.id)}
                />
              );
            })}
          </SidebarGroup>
        ))}
      </SidebarScrollArea>
    </SidebarRoot>
  );
}
