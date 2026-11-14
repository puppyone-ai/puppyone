import { AgentBrandImage, AgentMonochromeBrandImage, getAgentBrand, type AgentBrandId } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import "./onboarding-value-hub.css";

/** Any agent the person already uses, around the files they keep. */
const HUB_AGENTS: readonly AgentBrandId[] = [
  "chatgpt", "claude", "cursor", "manus", "gemini", "github-copilot", "opencode", "devin",
];

/** Where the Agents sit, as a share of the picture's side, so the picture can scale with the window. */
const HUB_RADIUS = 40;

function hubPoint(index: number) {
  const angle = (-90 + (index * 360) / HUB_AGENTS.length) * (Math.PI / 180);
  return { x: 50 + HUB_RADIUS * Math.cos(angle), y: 50 + HUB_RADIUS * Math.sin(angle) };
}

/**
 * The first run's picture of what a project is for: the person's own files, of
 * every kind, in the middle, and the agents they use around them. It only
 * illustrates the copy beside it, so assistive technology skips it.
 */
export function OnboardingValueHub() {
  const { t } = useLocalization();
  return (
    <div className="onboarding-value-hub" aria-hidden="true">
      <svg className="onboarding-value-hub-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        {HUB_AGENTS.map((id, index) => {
          const { x, y } = hubPoint(index);
          return <line key={id} x1={x} y1={y} x2={50} y2={50} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="onboarding-value-hub-center">
        <div className="onboarding-value-files">
          <span className="onboarding-value-file is-folder">
            <i className="onboarding-value-folder-tab" />
            <b>{t("onboarding.value.folder")}</b>
          </span>
          <span className="onboarding-value-file is-markdown">
            <i className="is-heading" /><i /><i /><i className="is-short" />
            <b>MD</b>
          </span>
          <span className="onboarding-value-file is-sheet">
            <span className="onboarding-value-sheet">{Array.from({ length: 9 }, (_, cell) => <i key={cell} />)}</span>
            <b>CSV</b>
          </span>
          <span className="onboarding-value-file is-html">
            <i className="is-banner" />
            <span className="onboarding-value-bars"><i /><i /><i /></span>
            <b>HTML</b>
          </span>
        </div>
        <span className="onboarding-value-hub-label">{t("onboarding.value.center")}</span>
      </div>
      {HUB_AGENTS.map((id, index) => {
        const { x, y } = hubPoint(index);
        return (
          // Names point away from the files, so on the upper half they sit above the mark.
          <span key={id} className={`onboarding-value-agent ${y < 50 ? "is-above" : ""}`} style={{ left: `${x}%`, top: `${y}%` }}>
            <span className="onboarding-value-agent-mark">
              {/* ChatGPT's mark is white artwork; it takes the surface's ink like the app's other single-colour marks. */}
              {id === "chatgpt" ? <AgentMonochromeBrandImage brandId="chatgpt" /> : <AgentBrandImage brandId={id} />}
            </span>
            <span className="onboarding-value-agent-name">{getAgentBrand(id)?.displayName}</span>
          </span>
        );
      })}
    </div>
  );
}
