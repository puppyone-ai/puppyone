import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { ArrowUpDown, Check, ListFilter, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  PROJECT_HOME_PLACES,
  projectHomeLocations,
  viewProjectHomeItems,
  type ProjectHomeItem,
  type ProjectHomePlace,
} from "../../lib/workspaceHomeModel";
import { useDesktopPlatformCapabilities } from "../../platform/useDesktopPlatformCapabilities";
import { HOMEPAGE_PROJECT_SORTS, type HomepageProjectSort } from "../../preferenceStorage";
import { useDesktopPreference } from "../../preferencesStore";
import { DesktopMenuItem, DesktopMenuSection } from "../DesktopMenu";
import { OnboardingToolbarMenu } from "./OnboardingToolbarMenu";

const ICON = { size: 14, strokeWidth: 1.85, "aria-hidden": true } as const;

/**
 * How the Homepage's projects are narrowed and ordered. The order is remembered like
 * the layout; the filter lasts only as long as the page, so that no launch opens on
 * what looks like a shorter list of projects. No place chosen means every place.
 */
export function useHomepageProjectView(items: ProjectHomeItem[]) {
  const { t, locale } = useLocalization();
  const sort = useDesktopPreference((s) => s.homepageProjectSort);
  const setSort = useDesktopPreference((s) => s.setHomepageProjectSort);
  const [chosenPlaces, setChosenPlaces] = useState<ReadonlySet<ProjectHomePlace>>(new Set());
  const locations = useMemo(() => projectHomeLocations(items), [items]);
  // A place can empty out from under its filter, as when signing out of the Cloud.
  const places = useMemo(
    () => new Set([...chosenPlaces].filter((place) => locations.has(place))),
    [chosenPlaces, locations],
  );
  const untitled = t("onboarding.projects.untitled");
  const visibleItems = useMemo(
    () => viewProjectHomeItems(items, { places, sort, locale, untitled }),
    [items, places, sort, locale, untitled],
  );
  const togglePlace = (place: ProjectHomePlace) => setChosenPlaces((current) => {
    const next = new Set(current);
    if (!next.delete(place)) next.add(place);
    return next;
  });
  const clearPlaces = () => setChosenPlaces(new Set());
  return { visibleItems, locations, places, togglePlace, clearPlaces, sort, setSort };
}

export function OnboardingProjectToolbar({ view, disabled, children }: {
  view: ReturnType<typeof useHomepageProjectView>;
  disabled: boolean;
  /** How the projects are arranged, last on the row. */
  children: ReactNode;
}) {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  const placeOptions: Record<ProjectHomePlace, { label: string; icon: ReactNode }> = {
    local: {
      label: t(platform?.platform === "macos"
        ? "shell.workspaceSwitcher.location.thisMac"
        : "shell.workspaceSwitcher.location.thisComputer"),
      icon: <LocalIcon {...ICON} />,
    },
    cloud: { label: t("onboarding.projects.filter.cloud"), icon: <CloudIcon {...ICON} /> },
  };
  const sortLabels: Record<HomepageProjectSort, string> = {
    modified: t("onboarding.projects.sort.modified"),
    name: t("onboarding.projects.sort.name"),
  };
  const filterLabel = t("onboarding.projects.filter.label");
  const sortLabel = t("onboarding.projects.sort.label");
  const chosen = PROJECT_HOME_PLACES.filter((place) => view.places.has(place));
  const check = <Check size={14} strokeWidth={1.85} aria-hidden="true" />;
  return (
    <div className="onboarding-project-toolbar">
      <div className="onboarding-project-view">
        {chosen.map((place) => (
          <button
            key={place}
            type="button"
            className="onboarding-filter-chip"
            aria-label={t("onboarding.projects.filter.remove", { place: bidiIsolate(placeOptions[place].label) })}
            disabled={disabled}
            onClick={() => view.togglePlace(place)}
          >
            {placeOptions[place].icon}
            <span>{placeOptions[place].label}</span>
            <X size={12} strokeWidth={1.85} aria-hidden="true" />
          </button>
        ))}
        <OnboardingToolbarMenu
          label={filterLabel}
          triggerLabel={chosen.length ? `${filterLabel}: ${chosen.map((place) => placeOptions[place].label).join(", ")}` : filterLabel}
          trigger={<><ListFilter {...ICON} /><span>{t("onboarding.projects.filter.trigger")}</span></>}
          text
          active={chosen.length > 0}
          multiple
          disabled={disabled}
        >
          {() => (
            <DesktopMenuSection>
              <DesktopMenuItem
                role="menuitemcheckbox"
                aria-checked={chosen.length === 0}
                icon={<ListFilter {...ICON} />}
                label={t("onboarding.projects.filter.all")}
                trailing={chosen.length === 0 ? check : undefined}
                onClick={view.clearPlaces}
              />
              {PROJECT_HOME_PLACES.map((place) => (
                <DesktopMenuItem
                  key={place}
                  role="menuitemcheckbox"
                  aria-checked={view.places.has(place)}
                  disabled={!view.locations.has(place)}
                  icon={placeOptions[place].icon}
                  label={placeOptions[place].label}
                  trailing={view.places.has(place) ? check : undefined}
                  onClick={() => view.togglePlace(place)}
                />
              ))}
            </DesktopMenuSection>
          )}
        </OnboardingToolbarMenu>
        <OnboardingToolbarMenu
          label={sortLabel}
          triggerLabel={`${sortLabel}: ${sortLabels[view.sort]}`}
          trigger={<><ArrowUpDown {...ICON} /><span>{sortLabels[view.sort]}</span></>}
          text
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
