import { SidebarRoot, SidebarRow, SidebarScrollArea } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { SidebarGroup } from "../../../components/sidebar";
import type { SettingsSidebarProps } from "../types";
import { resolveSettingsSidebarGroups } from "./settingsSidebarModel";

export function SettingsSidebar({ activeSection, cloudEnabled, otherAppImportsEnabled, onSelectSection }: SettingsSidebarProps) {
  const { t } = useLocalization();
  const groups = resolveSettingsSidebarGroups({ cloudEnabled, otherAppImportsEnabled });

  return (
    <SidebarRoot className="desktop-settings-sidebar" aria-label={t("settings.sidebar.desktopApp")}>
      <SidebarScrollArea>
        {groups.map((group) => (
          <SidebarGroup title={t(group.labelId)} key={group.id}>
            {group.items.map((section) => {
              const Icon = section.icon;
              const active = section.id === activeSection;
              const label = t(section.labelId);
              return (
                <SidebarRow
                  active={active}
                  aria-current={active ? "page" : undefined}
                  disabled={section.disabled}
                  aria-disabled={section.disabled}
                  icon={<Icon size={15} />}
                  label={label}
                  title={section.disabled
                    ? t("settings.sidebar.notAvailable", { section: label })
                    : label}
                  onClick={() => onSelectSection(section.id)}
                  key={section.id}
                />
              );
            })}
          </SidebarGroup>
        ))}
      </SidebarScrollArea>
    </SidebarRoot>
  );
}
