import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import { PuppyBrandMark } from "../brand/PuppyBrandMark";
import type { OnboardingHomeState } from "./types";

type OnboardingBrandLockupProps = {
  state: OnboardingHomeState;
  resolvedTheme: "light" | "dark";
  /** With projects to choose from, the head offers ways to view them instead of a title. */
  toolbar?: ReactNode;
  trailing?: ReactNode;
};

/** The Homepage's Header names the product, as a project's Header names the project. */
export function OnboardingHeaderBrand() {
  const { t } = useLocalization();
  return (
    <div className="desktop-titlebar-context">
      <div className="desktop-titlebar-context-item onboarding-header-brand">
        <span className="desktop-titlebar-context-mark" aria-hidden="true">
          <PuppyBrandMark className="onboarding-header-mark" tone="lite" />
          {/* The asset is a dark line on a light fill: darkness becomes coverage, and the
              coverage takes the Header's ink, so the mark and the name are one colour. */}
          <svg className="onboarding-header-mark-ink" focusable="false">
            <filter id="onboarding-header-mark-ink" colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.56 -0.56 -0.56 0 1.66" result="line" />
              <feFlood />
              <feComposite in2="line" operator="in" />
              <feComposite in2="SourceAlpha" operator="in" />
            </filter>
          </svg>
        </span>
        <span className="desktop-titlebar-context-name">{t("shell.brand.name")}</span>
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
          <span className="onboarding-brand-name">{t("onboarding.brand.agentReadyMessage")}</span>
        </div>
      </>)}
      {trailing}
    </header>
  );
}
