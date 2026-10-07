import type { ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, getAgentBrand } from "@puppyone/shared-ui";
import { CloudProjectBackupScene, CloudProjectSharingScene } from "./CloudProjectBenefitScenes";
import { McpLogoIcon } from "./McpLogoIcon";
import "./cloud-project-activation.css";

const CLOUD_AGENT_BRANDS = ["manus", "viktor", "grok-bot"] as const;

/** One project value surface; authentication and publishing retain their owners. */
export function CloudProjectActivation({ action, supplemental, busy = false }: {
  action: ReactNode;
  supplemental?: ReactNode;
  busy?: boolean;
}) {
  const { t } = useLocalization();
  return <section className="desktop-cloud-project-activation" aria-label={t("cloud.activation.project.title")} aria-busy={busy}>
    <ul className="desktop-cloud-project-benefits" role="list">
      <li className="desktop-cloud-project-benefit">
        <p className="desktop-cloud-project-benefit-copy">{t("cloud.activation.project.share")}</p>
        <div className="desktop-cloud-project-benefit-visual"><CloudProjectSharingScene /></div>
      </li>
      <li className="desktop-cloud-project-benefit">
        <p className="desktop-cloud-project-benefit-copy">{t("cloud.activation.project.backup")}</p>
        <div className="desktop-cloud-project-benefit-visual"><CloudProjectBackupScene /></div>
      </li>
      <li className="desktop-cloud-project-benefit">
        <p className="desktop-cloud-project-benefit-copy">{t("cloud.activation.project.agents")}</p>
        <div className="desktop-cloud-project-benefit-visual">
          <div className="desktop-cloud-project-agent-brands">
            {CLOUD_AGENT_BRANDS.map((brandId) => <span key={brandId} role="img" aria-label={getAgentBrand(brandId)?.displayName}>
              <AgentBrandImage brandId={brandId} />
            </span>)}
            <span role="img" aria-label="MCP"><McpLogoIcon size={24} /></span>
          </div>
        </div>
      </li>
    </ul>
    {supplemental && <div className="desktop-cloud-project-activation-supplemental">{supplemental}</div>}
    <div className="desktop-cloud-project-activation-actions">{action}</div>
  </section>;
}
