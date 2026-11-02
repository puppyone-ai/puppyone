import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import { PuppyBrandMark } from "../brand/PuppyBrandMark";
import type { OnboardingHomeState } from "./types";

const HEADER_MARK_FILTERS = [
  { id: "onboarding-header-mark-ink", coverage: "-0.56 -0.56 -0.56 0 1.66" },
  { id: "onboarding-header-mark-ink-fine", coverage: "-1.07 -1.07 -1.07 0 2.26" },
];

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
              coverage takes the Header's ink, so the mark and the name are one colour.
              A light line on a dark Header blooms, so that filter also drops the line's
              soft edge, which leaves it finer and crisper. */}
          <svg className="onboarding-header-mark-ink" focusable="false">
            {HEADER_MARK_FILTERS.map(({ id, coverage }) => (
              <filter key={id} id={id} colorInterpolationFilters="sRGB">
                <feColorMatrix in="SourceGraphic" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${coverage}`} result="line" />
                <feFlood />
                <feComposite in2="line" operator="in" />
                <feComposite in2="SourceAlpha" operator="in" />
              </filter>
            ))}
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
