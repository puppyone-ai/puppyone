import { useId, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, getAgentBrand } from "@puppyone/shared-ui";
import { CloudProjectBackupScene, CloudProjectSharingScene } from "./CloudProjectBenefitScenes";
import { CloudProjectIllustration } from "./CloudProjectIllustration";
import "./cloud-project-activation.css";

const CLOUD_AGENT_BRANDS = ["manus", "viktor", "grok-bot"] as const;

/** One project value surface; authentication and publishing retain their owners. */
export function CloudProjectActivation({ action, supplemental, busy = false }: {
  action: ReactNode;
  supplemental?: ReactNode;
  busy?: boolean;
}) {
  const { t } = useLocalization();
  const titleId = useId();
  return <section className="desktop-cloud-project-activation" aria-labelledby={titleId} aria-busy={busy}>
    <header className="desktop-cloud-project-activation-copy">
      <CloudProjectIllustration />
      <h2 id={titleId}>{t("cloud.activation.project.title")}</h2>
    </header>
    <ul className="desktop-cloud-project-benefits" role="list">
      <li className="desktop-cloud-project-benefit">
        <div className="desktop-cloud-project-benefit-visual"><CloudProjectSharingScene /></div>
        <p className="desktop-cloud-project-benefit-copy">{t("cloud.activation.project.share")}</p>
      </li>
      <li className="desktop-cloud-project-benefit">
        <div className="desktop-cloud-project-benefit-visual"><CloudProjectBackupScene /></div>
        <p className="desktop-cloud-project-benefit-copy">{t("cloud.activation.project.backup")}</p>
      </li>
      <li className="desktop-cloud-project-benefit">
        <div className="desktop-cloud-project-benefit-visual">
          <div className="desktop-cloud-project-agent-brands">
            {CLOUD_AGENT_BRANDS.map((brandId) => <span key={brandId} role="img" aria-label={getAgentBrand(brandId)?.displayName}>
              <AgentBrandImage brandId={brandId} />
            </span>)}
          </div>
        </div>
        <p className="desktop-cloud-project-benefit-copy">{t("cloud.activation.project.agents")}</p>
      </li>
    </ul>
    {supplemental && <div className="desktop-cloud-project-activation-supplemental">{supplemental}</div>}
    <div className="desktop-cloud-project-activation-actions">{action}</div>
  </section>;
}
