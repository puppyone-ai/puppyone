import { useLocalization } from "@puppyone/localization";
import type { CSSProperties } from "react";
import { OnboardingValueHub } from "./OnboardingValueHub";
import { OnboardingValueEditScene, OnboardingValueForwardScene } from "./OnboardingValueScenes";
import "./onboarding-value-carousel.css";

/**
 * First run tells one story in three moments, in this order: what you make is kept
 * as yours, you change it by pointing at it, and any Agent can be handed it. Each
 * holds long enough to read once; the last has the most to watch.
 */
export const VALUE_SLIDES = [
  { id: "assets", seconds: 6.5 },
  { id: "edit", seconds: 6.5 },
  { id: "forward", seconds: 8 },
] as const;

export type ValueSlideIndex = 0 | 1 | 2;

export const nextValueSlide = (index: ValueSlideIndex): ValueSlideIndex => ((index + 1) % VALUE_SLIDES.length) as ValueSlideIndex;

const SCENES = [OnboardingValueHub, OnboardingValueEditScene, OnboardingValueForwardScene];

/**
 * The picture beside the first-run column, and the three dots under it. The open
 * dot fills as its moment plays and moves on when full; pointing at the page or
 * working in it holds the moment, and with reduced motion only a dot moves it on.
 */
export function OnboardingValueCarousel({ index, onSelect }: {
  index: ValueSlideIndex;
  onSelect: (index: ValueSlideIndex) => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="onboarding-value-carousel">
      <div className="onboarding-value-stage" aria-hidden="true">
        {SCENES.map((Scene, slide) => (
          <div key={VALUE_SLIDES[slide]!.id} className={`onboarding-value-slide ${slide === index ? "is-active" : ""}`}
            data-value-slide={VALUE_SLIDES[slide]!.id}>
            <Scene />
          </div>
        ))}
      </div>
      <div className="onboarding-value-dots" role="group" aria-label={t("onboarding.value.dots")}>
        {VALUE_SLIDES.map((slide, dot) => (
          <button key={slide.id} type="button"
            className={`onboarding-value-dot ${dot === index ? "is-active" : ""}`}
            aria-label={t(`onboarding.value.${slide.id}.label`)}
            aria-current={dot === index || undefined}
            onClick={() => onSelect(dot as ValueSlideIndex)}>
            {dot === index && (
              <i key={index} style={{ "--onboarding-slide-seconds": `${slide.seconds}s` } as CSSProperties}
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget) onSelect(nextValueSlide(index));
                }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
