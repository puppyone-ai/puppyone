import { useId, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, getAgentBrand } from "@puppyone/shared-ui";
import { UsersRound, Workflow } from "lucide-react";
import "./cloud-project-activation.css";

/** One project value surface; authentication and publishing retain their owners. */
export function CloudProjectActivation({ action, hint, supplemental, busy = false }: {
  action: ReactNode;
  hint?: ReactNode;
  supplemental?: ReactNode;
  busy?: boolean;
}) {
  const { t } = useLocalization();
  const titleId = useId();
  return <section className="desktop-cloud-project-activation" aria-labelledby={titleId} aria-busy={busy}>
    <CloudProjectIllustration />
    <header className="desktop-cloud-project-activation-copy">
      <h2 id={titleId}>{t("cloud.activation.project.title")}</h2>
    </header>
    <div className="desktop-cloud-project-benefits">
      <div className="desktop-cloud-project-benefit">
        <UsersRound size={20} aria-hidden="true" />
        <span>{t("cloud.activation.project.share")}</span>
      </div>
      <div className="desktop-cloud-project-benefit">
        <div className="desktop-cloud-project-agent-brands">
          <span role="img" aria-label={getAgentBrand("manus")?.displayName}><AgentBrandImage brandId="manus" /></span>
          <span role="img" aria-label={getAgentBrand("viktor")?.displayName}><AgentBrandImage brandId="viktor" /></span>
        </div>
        <span>{t("cloud.activation.project.agents")}</span>
      </div>
      <div className="desktop-cloud-project-benefit">
        <Workflow size={20} aria-hidden="true" />
        <span>{t("cloud.activation.project.automation")}</span>
      </div>
    </div>
    {supplemental && <div className="desktop-cloud-project-activation-supplemental">{supplemental}</div>}
    <div className="desktop-cloud-project-activation-actions">{action}</div>
    {hint && <div className="desktop-cloud-project-activation-hint" aria-live="polite">{hint}</div>}
  </section>;
}

function CloudProjectIllustration() {
  return <svg className="desktop-cloud-project-illustration" viewBox="0 0 420 136"
    fill="none" aria-hidden="true" focusable="false">
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 82V59Q28 55 33 55H48L56 66H91Q96 66 96 71V100Q96 105 91 105H33Q28 105 28 100Z" />
      <path d="M57 25L82 20L88 49L63 54ZM61 32L77 29M64 39L80 36M66 46L77 44" />
      <path d="M96 10L119 16L114 44L90 38ZM100 20L114 23M98 27L111 30M97 34L106 36" />
      <path d="M185 94C151 94 150 55 178 51C188 22 228 22 238 53C267 54 269 94 240 94Z" />
      <rect x="330" y="16" width="68" height="50" rx="6" />
      <path d="M330 29H398M338 23H339M345 23H346M352 23H353" />
      <rect x="338" y="94" width="58" height="34" rx="5" />
      <path d="M350 104L358 111L350 118M366 118H378" />
    </g>
    <g className="desktop-cloud-project-illustration-links" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeDasharray="1 7">
      <path d="M117 61Q130 78 151 73M269 54Q298 60 320 40M274 84Q302 81 328 109" />
    </g>
    <g className="desktop-cloud-project-illustration-links" fill="currentColor">
      <path d="M151 69L158 74L151 79ZM320 35L327 40L320 45ZM328 104L335 109L328 114Z" />
      <rect x="340" y="38" width="46" height="5" rx="2" opacity=".3" />
      <rect x="340" y="50" width="30" height="5" rx="2" opacity=".3" />
    </g>
  </svg>;
}
