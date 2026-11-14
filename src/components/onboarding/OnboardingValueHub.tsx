import { AgentBrandImage, AgentMonochromeBrandImage, type AgentBrandId } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import type { CSSProperties } from "react";
import "./onboarding-value-hub.css";

/**
 * Any Agent the person already uses, drifting around the files they keep. An odd
 * number on two loose orbits, each its own size, so the ring reads as company
 * gathering rather than a diagram. Angles are degrees from the right; radius and
 * size are shares of the picture's side.
 */
const HUB_AGENTS: readonly { id: AgentBrandId; angle: number; radius: number; size: number }[] = [
  { id: "chatgpt", angle: -90, radius: 44, size: 13 },
  { id: "claude", angle: -36, radius: 36, size: 12 },
  { id: "cursor", angle: 14, radius: 45, size: 10.5 },
  { id: "gemini", angle: 64, radius: 37, size: 11.5 },
  { id: "github-copilot", angle: 116, radius: 45, size: 10.5 },
  { id: "manus", angle: 166, radius: 36, size: 11.5 },
  { id: "devin", angle: 216, radius: 44, size: 10.5 },
];

function hubPoint(angle: number, radius: number) {
  const radians = angle * (Math.PI / 180);
  return { x: 50 + radius * Math.cos(radians), y: 50 + radius * Math.sin(radians) };
}

/**
 * The first run's picture of what a project is for: the person's own files, of
 * every kind, in one neat pile, and the Agents they use around them. It only
 * illustrates the copy beside it, so assistive technology skips it.
 */
export function OnboardingValueHub() {
  const { t } = useLocalization();
  return (
    <div className="onboarding-value-hub" aria-hidden="true">
      <svg className="onboarding-value-hub-orbits" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="36.5" vectorEffect="non-scaling-stroke" />
        <circle cx="50" cy="50" r="44.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="onboarding-value-hub-center">
        {/* One pile: the page itself first, the folder that can hold them all last. */}
        <div className="onboarding-value-files">
          <span className="onboarding-value-card is-folder"><b>{t("onboarding.value.folder")}</b></span>
          <span className="onboarding-value-card is-sheet">
            <span className="onboarding-value-sheet">{Array.from({ length: 9 }, (_, cell) => <i key={cell} />)}</span>
            <b>CSV</b>
          </span>
          <span className="onboarding-value-card is-markdown">
            <i className="is-heading" /><i /><i /><i className="is-short" />
            <b>MD</b>
          </span>
          <span className="onboarding-value-card is-html">
            <i className="is-banner" />
            <span className="onboarding-value-bars"><i /><i /><i /></span>
            <b>HTML</b>
          </span>
        </div>
        <span className="onboarding-value-hub-label">{t("onboarding.value.center")}</span>
      </div>
      {HUB_AGENTS.map(({ id, angle, radius, size }, index) => {
        const { x, y } = hubPoint(angle, radius);
        return (
          <span key={id} className="onboarding-value-agent"
            style={{ left: `${x}%`, top: `${y}%`, "--onboarding-agent-size": size, "--onboarding-agent-drift": `${-index * 0.9}s` } as CSSProperties}>
            {/* ChatGPT's mark is white artwork; it takes the surface's ink like the app's other single-colour marks. */}
            {id === "chatgpt" ? <AgentMonochromeBrandImage brandId="chatgpt" /> : <AgentBrandImage brandId={id} />}
          </span>
        );
      })}
    </div>
  );
}
