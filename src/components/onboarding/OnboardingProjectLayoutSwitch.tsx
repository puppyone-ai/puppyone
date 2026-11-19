import { useLocalization } from "@puppyone/localization";
import { Check, LayoutGrid, List } from "lucide-react";
import { HOMEPAGE_PROJECT_LAYOUTS, type HomepageProjectLayout } from "../../preferenceStorage";
import { DesktopMenuItem, DesktopMenuSection } from "../DesktopMenu";
import { OnboardingToolbarMenu } from "./OnboardingToolbarMenu";

const LAYOUT_ICONS = { list: List, grid: LayoutGrid } as const;
const ICON = { size: 15, strokeWidth: 1.85, "aria-hidden": true } as const;

/** How the Homepage arranges its projects: the current layout, one press from the other. */
export function OnboardingProjectLayoutSwitch({ layout, disabled, onChange }: {
  layout: HomepageProjectLayout;
  disabled: boolean;
  onChange: (layout: HomepageProjectLayout) => void;
}) {
  const { t } = useLocalization();
  const label = t("onboarding.projects.layout.label");
  const Current = LAYOUT_ICONS[layout];
  return (
    <OnboardingToolbarMenu
      label={label}
      triggerLabel={`${label}: ${t(`onboarding.projects.layout.${layout}`)}`}
      trigger={<Current {...ICON} />}
      disabled={disabled}
    >
      {(close) => (
        <DesktopMenuSection>
          {HOMEPAGE_PROJECT_LAYOUTS.map((option) => {
            const Icon = LAYOUT_ICONS[option];
            return (
              <DesktopMenuItem
                key={option}
                role="menuitemradio"
                aria-checked={layout === option}
                data-project-layout-option={option}
                icon={<Icon {...ICON} />}
                label={t(`onboarding.projects.layout.${option}`)}
                trailing={layout === option ? <Check size={14} strokeWidth={1.85} aria-hidden="true" /> : undefined}
                onClick={() => {
                  close();
                  onChange(option);
                }}
              />
            );
          })}
        </DesktopMenuSection>
      )}
    </OnboardingToolbarMenu>
  );
}
