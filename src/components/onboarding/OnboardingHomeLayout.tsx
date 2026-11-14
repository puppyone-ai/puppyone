import type { ReactNode } from "react";
import {
  OnboardingPrimarySection,
  type OnboardingPrimarySectionKind,
} from "./OnboardingPrimarySection";

type OnboardingHomeLayoutProps = {
  brand: ReactNode;
  primaryKind: OnboardingPrimarySectionKind;
  primary: ReactNode;
  actions: ReactNode;
  /** First run pictures what the page is for beside it. */
  aside?: ReactNode;
};

/**
 * Stable home-page composition shared by empty and returning-user states.
 * State may replace slot content, but never the page's structural order.
 */
export function OnboardingHomeLayout({
  brand,
  primaryKind,
  primary,
  actions,
  aside,
}: OnboardingHomeLayoutProps) {
  const launcher = (
    <div className="onboarding-launcher">
      {brand}
      <OnboardingPrimarySection kind={primaryKind}>
        {primary}
      </OnboardingPrimarySection>
      {actions}
    </div>
  );
  if (!aside) return launcher;
  return (
    <div className="onboarding-home-value">
      {aside}
      {launcher}
    </div>
  );
}
