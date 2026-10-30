import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import { PuppyBrandMark } from "../brand/PuppyBrandMark";
import type { OnboardingHomeState } from "./types";

type OnboardingBrandLockupProps = {
  state: OnboardingHomeState;
  resolvedTheme: "light" | "dark";
  trailing?: ReactNode;
};

/** First-run states the file-first promise; returning users see the project prompt. */
export function OnboardingBrandLockup({ state, resolvedTheme, trailing }: OnboardingBrandLockupProps) {
  const { t } = useLocalization();
  const hasProjects = state === "projects";

  return (
    <header className="onboarding-brand-lockup">
      <span className="onboarding-brand-mark" aria-hidden="true">
        <PuppyBrandMark
          className="onboarding-brand-mark-artwork"
          tone={resolvedTheme === "light" ? "lite" : "dark"}
        />
      </span>
      <div className="onboarding-brand-copy">
        <span className={hasProjects ? "onboarding-brand-prompt" : "onboarding-brand-name"}>
          {t(hasProjects ? "onboarding.section.chooseProject" : "onboarding.brand.agentReadyMessage")}
        </span>
      </div>
      {trailing}
    </header>
  );
}
