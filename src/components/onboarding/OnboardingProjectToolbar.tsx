import { useLocalization } from "@puppyone/localization";
import { ArrowUpDown, Check } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { viewProjectHomeItems, type ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { HOMEPAGE_PROJECT_SORTS, type HomepageProjectSort } from "../../preferenceStorage";
import { useDesktopPreference } from "../../preferencesStore";
import { DesktopMenuItem, DesktopMenuSection } from "../DesktopMenu";
import { OnboardingToolbarMenu } from "./OnboardingToolbarMenu";

const ICON = { size: 14, strokeWidth: 1.85, "aria-hidden": true } as const;
const NO_DATES: ReadonlyMap<string, string> = new Map();

/**
 * The date each project had when first shown this visit, or the same map when there
 * is nothing new. A date learned after a row is on screen waits for the next visit,
 * so rows only ever move because someone asked them to. A held list starts a visit.
 */
function settleShownDates(shown: ReadonlyMap<string, string>, items: ProjectHomeItem[], held: boolean) {
  if (held) return NO_DATES;
  const learned = items.flatMap(({ id, lastModifiedAt }) => (
    lastModifiedAt && !shown.has(id) ? [[id, lastModifiedAt] as const] : []
  ));
  return learned.length ? new Map([...shown, ...learned]) : shown;
}

/**
 * How the Homepage's projects are ordered, remembered like the layout. Nothing narrows
 * them: the groups already say who can open each project and the marks where it lives.
 */
export function useHomepageProjectView(items: ProjectHomeItem[], held = false) {
  const { t, locale } = useLocalization();
  const sort = useDesktopPreference((s) => s.homepageProjectSort);
  const setSort = useDesktopPreference((s) => s.setHomepageProjectSort);
  const untitled = t("onboarding.projects.untitled");
  const [shownDates, setShownDates] = useState(NO_DATES);
  const settledDates = settleShownDates(shownDates, items, held);
  if (settledDates !== shownDates) setShownDates(settledDates);
  const visibleItems = useMemo(() => {
    if (held) return [];
    return viewProjectHomeItems(items.map((item) => {
      const shown = settledDates.get(item.id);
      return shown ? { ...item, lastModifiedAt: shown } : item;
    }), { sort, locale, untitled });
  }, [held, items, settledDates, sort, locale, untitled]);
  return { visibleItems, sort, setSort };
}

export function OnboardingProjectToolbar({ view, disabled, children }: {
  view: ReturnType<typeof useHomepageProjectView>;
  disabled: boolean;
  /** How the projects are arranged, after what is shown and in what order. */
  children: ReactNode;
}) {
  const { t } = useLocalization();
  const sortLabels: Record<HomepageProjectSort, string> = {
    modified: t("onboarding.projects.sort.modified"),
    name: t("onboarding.projects.sort.name"),
  };
  const sortLabel = t("onboarding.projects.sort.label");
  const check = <Check size={14} strokeWidth={1.85} aria-hidden="true" />;
  return (
    <div className="onboarding-project-toolbar">
      <div className="onboarding-project-view">
        <OnboardingToolbarMenu
          label={sortLabel}
          triggerLabel={`${sortLabel}: ${sortLabels[view.sort]}`}
          trigger={<ArrowUpDown {...ICON} />}
          disabled={disabled}
        >
          {(close) => (
            <DesktopMenuSection>
              {HOMEPAGE_PROJECT_SORTS.map((sort) => (
                <DesktopMenuItem
                  key={sort}
                  role="menuitemradio"
                  aria-checked={view.sort === sort}
                  label={sortLabels[sort]}
                  trailing={view.sort === sort ? check : undefined}
                  onClick={() => {
                    close();
                    view.setSort(sort);
                  }}
                />
              ))}
            </DesktopMenuSection>
          )}
        </OnboardingToolbarMenu>
        {children}
      </div>
    </div>
  );
}
