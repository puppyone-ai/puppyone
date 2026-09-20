import type { ReactNode } from "react";

export type OnboardingPrimarySectionKind = "create" | "projects";

type OnboardingPrimarySectionProps = {
  kind: OnboardingPrimarySectionKind;
  children: ReactNode;
};

/**
 * The single framed content slot between the onboarding title and its
 * secondary actions. Empty and returning-user states swap only this slot's
 * content so its rules, insets, width, and vertical rhythm cannot drift.
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
