import { useLocalization } from "@puppyone/localization";
import { useRef, useState, type ReactNode } from "react";
import { WindowNavigationRows, windowNavigationHasRows } from "../../features/app-shell/project-place/WindowNavigationRows";
import { DesktopTitlebarMenuLayer } from "../DesktopTitlebarMenuLayer";
import { PuppyBrandMark } from "../brand/PuppyBrandMark";
import { useWindowNavigation } from "../WindowNavigation";
import type { OnboardingHomeState } from "./types";

type OnboardingBrandLockupProps = {
  state: OnboardingHomeState;
  resolvedTheme: "light" | "dark";
  /** With projects to choose from, the head offers ways to view them instead of a title. */
  toolbar?: ReactNode;
  trailing?: ReactNode;
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

/** First-run states the file-first promise; returning users get straight to their projects. */
export function OnboardingBrandLockup({ state, resolvedTheme, toolbar, trailing }: OnboardingBrandLockupProps) {
  const { t } = useLocalization();
  const hasProjects = state === "projects";

  return (
    <header className="onboarding-brand-lockup">
      {hasProjects ? toolbar : (<>
        <span className="onboarding-brand-mark" aria-hidden="true">
          <PuppyBrandMark
            className="onboarding-brand-mark-artwork"
            tone={resolvedTheme === "light" ? "lite" : "dark"}
          />
        </span>
        <div className="onboarding-brand-copy">
          <h1 className="onboarding-brand-name">{t("onboarding.brand.agentReadyMessage")}</h1>
        </div>
      </>)}
      {trailing}
    </header>
  );
}
