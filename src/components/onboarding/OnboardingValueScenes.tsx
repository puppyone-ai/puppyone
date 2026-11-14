import { AgentBrandImage, AgentMonochromeBrandImage } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Link2 } from "lucide-react";
import type { CSSProperties } from "react";

/** A step that appears this long after its scene does. */
const after = (seconds: number) => ({ "--onboarding-scene-delay": `${seconds}s` }) as CSSProperties;

/** Months of revenue the dashboard's line is drawn from, scaled to its 260×88 chart. */
const MONTHLY_LINE = "6,70 36,64 66,56 96,53 126,48 156,34 186,36 216,29 246,18";

function DashboardHead() {
  const { t } = useLocalization();
  return (
    <>
      <span className="onboarding-scene-dashboard-title">{t("onboarding.value.scene.dashboard")}</span>
      <span className="onboarding-scene-kpis">
        <span>{t("onboarding.value.scene.revenue")}<b>{t("onboarding.value.scene.revenueValue")}</b></span>
        <span>{t("onboarding.value.scene.customers")}<b>326</b></span>
        <span>{t("onboarding.value.scene.renewal")}<b>92%</b></span>
      </span>
    </>
  );
}

function MonthlyLine({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 260 88" preserveAspectRatio="none">
      <line className="onboarding-scene-axis" x1="0" y1="86" x2="260" y2="86" />
      <polygon className="onboarding-scene-area" points={`6,86 ${MONTHLY_LINE} 246,86`} />
      <polyline className="onboarding-scene-line" points={MONTHLY_LINE} pathLength={1} />
    </svg>
  );
}

/**
 * A QR code's look, not a code: three finder squares and a fixed scatter, so the
 * picture never invites a scan that leads nowhere. It stands beside the link as
 * one more way to hand it over.
 */
function QrMark({ className }: { className: string }) {
  const size = 21;
  const finder = (x: number, y: number) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
  let seed = 7;
  let modules = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      seed = (seed * 1103515245 + 12345) % 2147483648;
      if (!inFinder && seed % 5 < 2) modules += `M${x} ${y}h1v1h-1z`;
    }
  }
  return (
    <svg className={className} viewBox={`-1 -1 ${size + 2} ${size + 2}`} shapeRendering="crispEdges">
      <path fillRule="evenodd" d={`${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}${modules}`} />
    </svg>
  );
}

/** Second scene: circle a chart, say one line, and an Agent redraws it. HTML leads; Markdown and a table only show that they work the same way. */
export function OnboardingValueEditScene() {
  const { t } = useLocalization();
  return (
    <div className="onboarding-scene onboarding-scene-edit">
      <span className="onboarding-scene-card is-markdown">
        <i className="is-heading" /><i /><i className="is-flash" /><i className="is-short" />
      </span>
      <span className="onboarding-scene-card is-sheet">
        <i className="is-heading" />
        <span className="onboarding-scene-grid">{Array.from({ length: 12 }, (_, cell) => <i key={cell} />)}</span>
        <span className="onboarding-scene-grid-pick" />
      </span>
      <span className="onboarding-scene-card is-dashboard">
        <DashboardHead />
        <span className="onboarding-scene-chart">
          <svg className="onboarding-scene-bars" viewBox="0 0 260 88" preserveAspectRatio="none">
            <line className="onboarding-scene-axis" x1="0" y1="86" x2="260" y2="86" />
            <rect x="30" y="40" width="44" height="46" rx="2" />
            <rect x="108" y="28" width="44" height="58" rx="2" />
            <rect x="186" y="14" width="44" height="72" rx="2" />
          </svg>
          <MonthlyLine className="onboarding-scene-redrawn" />
          <span className="onboarding-scene-selection">
            <b className="is-picked">{t("onboarding.value.scene.selected")}</b>
            <b className="is-done">{t("onboarding.value.scene.done")}</b>
          </span>
        </span>
        <b className="onboarding-scene-tag">HTML</b>
      </span>
      <span className="onboarding-scene-prompt">
        <AgentBrandImage brandId="claude" />
        <span>{t("onboarding.value.scene.prompt")}</span>
        <kbd>↵</kbd>
      </span>
    </div>
  );
}

/**
 * Third scene: the dashboard's own link goes to ChatGPT, which takes it over and
 * edits it where it lives. The code beside the link is only another way to send it.
 */
export function OnboardingValueForwardScene() {
  const { t } = useLocalization();
  const name = t("onboarding.value.scene.dashboard");
  return (
    <div className="onboarding-scene onboarding-scene-forward">
      <svg className="onboarding-scene-wire" viewBox="0 0 380 380">
        <path d="M 196 286 C 226 284, 222 220, 236 196" pathLength={1} />
      </svg>
      <span className="onboarding-scene-card is-dashboard">
        <DashboardHead />
        <span className="onboarding-scene-chart">
          <MonthlyLine className="onboarding-scene-settled" />
          <span className="onboarding-scene-peak" style={after(3.2)}>{t("onboarding.value.scene.peak")}</span>
          <span className="onboarding-scene-changed" style={after(3.2)}>
            <b>{t("onboarding.value.scene.changedBy", { agent: "ChatGPT" })}</b>
          </span>
        </span>
        <span className="onboarding-scene-share">
          <span className="onboarding-scene-link">
            <Link2 size={11} strokeWidth={2} aria-hidden="true" />
            <span>{t("onboarding.value.scene.send")}</span>
          </span>
          <QrMark className="onboarding-scene-qr" />
        </span>
      </span>
      <span className="onboarding-scene-phone">
        <span className="onboarding-scene-phone-app">
          <AgentMonochromeBrandImage brandId="chatgpt" />ChatGPT
        </span>
        <span className="onboarding-scene-message is-mine is-link" style={after(0.3)}>
          <span className="onboarding-scene-link-thumb"><i /><i /><i /></span>
          <span className="onboarding-scene-link-text">
            <b>{name}</b>
            <code>puppyone.ai/…</code>
          </span>
        </span>
        <span className="onboarding-scene-message" style={after(1.1)}>{t("onboarding.value.scene.opened", { name })}</span>
        <span className="onboarding-scene-message is-mine" style={after(2)}>{t("onboarding.value.scene.ask")}</span>
        <span className="onboarding-scene-message is-done" style={after(2.8)}>{t("onboarding.value.scene.saved")}</span>
      </span>
    </div>
  );
}
