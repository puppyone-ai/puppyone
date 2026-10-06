import { useId, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, AgentMonochromeBrandImage, getAgentBrand } from "@puppyone/shared-ui";
import { Clock3, UsersRound } from "lucide-react";
import "./cloud-project-activation.css";

const CLOUD_AGENT_BRANDS = ["manus", "viktor", "chatgpt", "claude"] as const;

/** One project value surface; authentication and publishing retain their owners. */
export function CloudProjectActivation({ action, supplemental, busy = false }: {
  action: ReactNode;
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
        <div className="desktop-cloud-project-benefit-copy">
          <span>{t("cloud.activation.project.share")}</span>
          <small>{t("cloud.activation.project.shareOutcome")}</small>
        </div>
      </div>
      <div className="desktop-cloud-project-benefit">
        <Clock3 size={20} aria-hidden="true" />
        <div className="desktop-cloud-project-benefit-copy">
          <span>{t("cloud.activation.project.automation")}</span>
          <small>{t("cloud.activation.project.automationOutcome")}</small>
        </div>
      </div>
      <div className="desktop-cloud-project-benefit">
        <div className="desktop-cloud-project-agent-brands">
          {CLOUD_AGENT_BRANDS.map((brandId) => {
            // The hosted Claude client shares the mark, not the local CLI name.
            const name = brandId === "claude" ? "Claude" : getAgentBrand(brandId)?.displayName;
            return <span key={brandId} role="img" aria-label={name} title={name}>
              {brandId === "chatgpt"
                ? <AgentMonochromeBrandImage brandId={brandId} />
                : <AgentBrandImage brandId={brandId} />}
            </span>;
          })}
        </div>
        <div className="desktop-cloud-project-benefit-copy">
          <span>{t("cloud.activation.project.agents")}</span>
          <small>{t("cloud.activation.project.agentsOutcome")}</small>
        </div>
      </div>
    </div>
    {supplemental && <div className="desktop-cloud-project-activation-supplemental">{supplemental}</div>}
    <div className="desktop-cloud-project-activation-actions">{action}</div>
  </section>;
}

function CloudProjectIllustration() {
  return <svg className="desktop-cloud-project-illustration" viewBox="0 0 240 64"
    fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M12 28Q12 24 16 24H30L36 30H54Q58 30 58 34V49Q58 53 54 53H16Q12 53 12 49Z" />
    <rect x="27" y="7" width="17" height="13" rx="2" opacity=".5" />
    <rect x="47" y="12" width="13" height="11" rx="2" opacity=".3" />
    <path d="M103 48C83 48 81 27 97 23C103 3 130 3 137 24C154 24 157 48 139 48Z" />
    <rect x="193" y="6" width="34" height="24" rx="4" />
    <rect x="196" y="39" width="28" height="20" rx="4" opacity=".7" />
    <g className="desktop-cloud-project-illustration-cutouts" fill="var(--po-canvas)" opacity=".65">
      <rect x="198" y="12" width="24" height="2" rx="1" />
      <rect x="198" y="19" width="16" height="3" rx="1" />
    </g>
    <path d="M203 44L208 49L203 54M212 54H218" fill="none" stroke="var(--po-canvas)"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".65" />
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M65 37H80M158 34H173Q179 34 179 28V22Q179 18 185 18H188M179 32V44Q179 49 185 49H191" />
    </g>
  </svg>;
}
