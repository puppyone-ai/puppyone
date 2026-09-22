import { useLocalization } from "@puppyone/localization";
import { PuppyBrandMark } from "../brand/PuppyBrandMark";
import type { OnboardingHomeState } from "./types";

type OnboardingBrandLockupProps = {
  state: OnboardingHomeState;
  resolvedTheme: "light" | "dark";
};

/** First-run states the file-first promise; returning users see the project prompt. */
export function OnboardingBrandLockup({ state, resolvedTheme }: OnboardingBrandLockupProps) {
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
    </header>
  );
}
