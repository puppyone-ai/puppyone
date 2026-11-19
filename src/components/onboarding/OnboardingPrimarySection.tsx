import type { ReactNode } from "react";

export type OnboardingPrimarySectionKind = "create" | "projects";

type OnboardingPrimarySectionProps = {
  kind: OnboardingPrimarySectionKind;
  children: ReactNode;
};

/**
 * The single content slot under the onboarding title. Empty and returning-user
 * states swap only this slot's content so its width and vertical rhythm cannot
 * drift.
 */
export function OnboardingPrimarySection({
  kind,
  children,
}: OnboardingPrimarySectionProps) {
  return (
    <div className="onboarding-home-primary" data-onboarding-primary={kind}>
      {children}
    </div>
  );
}
