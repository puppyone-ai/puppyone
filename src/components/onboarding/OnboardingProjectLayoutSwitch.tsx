import { FolderIcon, Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { LayoutGrid, List } from "lucide-react";
import { HOMEPAGE_PROJECT_LAYOUTS, type HomepageProjectLayout } from "../../preferenceStorage";

const LAYOUT_ICONS = { list: List, icons: FolderIcon, cards: LayoutGrid } as const;

/** Homepage Header control for how projects are arranged, like a file browser's view buttons. */
export function OnboardingProjectLayoutSwitch({ available, layout, disabled, onChange }: {
  /** There is nothing to arrange until there are projects. */
  available: boolean;
  layout: HomepageProjectLayout;
  disabled: boolean;
  onChange: (layout: HomepageProjectLayout) => void;
}) {
  const { t } = useLocalization();
  if (!available) return null;
  return (
    <div className="onboarding-project-layout-switch" role="group" aria-label={t("onboarding.projects.layout.label")}>
      {HOMEPAGE_PROJECT_LAYOUTS.map((option) => {
        const Icon = LAYOUT_ICONS[option];
        const label = t(`onboarding.projects.layout.${option}`);
        return (
          <Tooltip key={option} content={label}>
            <button
              type="button"
              className="desktop-titlebar-action"
              data-project-layout-option={option}
              aria-label={label}
              aria-pressed={layout === option}
              disabled={disabled}
              onClick={() => onChange(option)}
            >
              <Icon size={15} strokeWidth={1.85} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
