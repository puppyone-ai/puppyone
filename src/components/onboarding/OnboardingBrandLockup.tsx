import { useLocalization } from "@puppyone/localization";
import { useRef, useState, type ReactNode } from "react";
import { WindowNavigationRows, windowNavigationHasRows } from "../WindowNavigationRows";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import { useWindowNavigation } from "../WindowNavigation";
import type { OnboardingHomeState } from "./types";
import { VALUE_SLIDES, type ValueSlideIndex } from "./OnboardingValueCarousel";

type OnboardingBrandLockupProps = {
  state: OnboardingHomeState;
  /** With projects to choose from, the head offers ways to view them instead of a title. */
  toolbar?: ReactNode;
  trailing?: ReactNode;
  /** First run's moment, whose title and line the head shows. */
  valueSlide?: ValueSlideIndex;
};

/**
 * The Homepage's Header names the product, as a project's Header names the
 * project: in words only, so the product's mark does not compete with the page.
 * It opens what a project's place menu ends with: the places, each in view on
 * this page, and the account.
 */
export function OnboardingHeaderBrand() {
  const { t } = useLocalization();
  const navigation = useWindowNavigation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const name = <span className="desktop-titlebar-place-address"><bdi>{t("shell.brand.name")}</bdi></span>;
  if (!windowNavigationHasRows(navigation)) return (
    <div className="desktop-titlebar-context">
      <div className="desktop-titlebar-context-item onboarding-header-brand">
        <span className="desktop-titlebar-context-name">{t("shell.brand.name")}</span>
      </div>
    </div>
  );
  return (
    <div className="desktop-titlebar-context">
      <div className="desktop-titlebar-place-wrap">
        <button ref={anchor} type="button" className="desktop-titlebar-place-button onboarding-header-brand"
          aria-haspopup="menu" aria-expanded={open} aria-label={`${t("shell.brand.name")}, ${t("shell.placeMenu.label")}`}
          onClick={() => setOpen((value) => !value)}>
          {name}
        </button>
        <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
          className="desktop-project-place-menu" gap={2} preferredWidth={260} preferredMaxHeight={560}
          widthMode="content" alignment="start" ariaLabel={t("shell.placeMenu.label")} focusOnOpen>
          <WindowNavigationRows onDismiss={() => setOpen(false)} />
        </DesktopTitlebarMenuLayer>
      </div>
    </div>
  );
}

/**
 * First-run says what the person's files become here, one moment at a time; the
 * window's Header already names the product. Returning users get straight to their projects.
 */
export function OnboardingBrandLockup({ state, toolbar, trailing, valueSlide = 0 }: OnboardingBrandLockupProps) {
  const { t } = useLocalization();
  const hasProjects = state === "projects";

  return (
    <header className="onboarding-brand-lockup">
      {hasProjects ? toolbar : (<>
        {/* Every moment's words share one cell, so the keys below never move as they change. */}
        <div className="onboarding-brand-moments">
          {VALUE_SLIDES.map((slide, index) => (
            <div key={slide.id} className={`onboarding-brand-copy ${index === valueSlide ? "is-active" : ""}`}
              aria-hidden={index === valueSlide ? undefined : true}>
              <h1 className="onboarding-brand-name">{t(`onboarding.value.${slide.id}.title`)}</h1>
              <p className="onboarding-brand-pitch">{t(`onboarding.value.${slide.id}.body`)}</p>
            </div>
          ))}
        </div>
      </>)}
      {trailing}
    </header>
  );
}
