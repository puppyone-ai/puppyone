import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Bot, History, Link2, Users } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, getAgentBrand, LocalIcon, CloudIcon } from "@puppyone/shared-ui";
import { CloudPublishFolderMark } from "./CloudPublishHeroMarks";
import { McpLogoIcon } from "./McpLogoIcon";
import "./cloud-project-activation.css";

const CLOUD_AGENT_BRANDS = ["manus", "viktor", "grok-bot"] as const;
const VALUE_ICON_PROPS = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

type CloudProjectActivationScopeValue = {
  projectName?: string | null;
  onDismiss?: () => void;
};

const CloudProjectActivationScopeContext = createContext<CloudProjectActivationScopeValue>({});

/**
 * The hosting dialog names the current project and owns dismissal. Auth,
 * publish and recovery owners render the activation without threading either.
 */
export function CloudProjectActivationScope({ projectName, onDismiss, children }: CloudProjectActivationScopeValue & {
  children: ReactNode;
}) {
  const value = useMemo(() => ({ projectName, onDismiss }), [projectName, onDismiss]);
  return <CloudProjectActivationScopeContext.Provider value={value}>{children}</CloudProjectActivationScopeContext.Provider>;
}

/** The hosting dialog's project and dismissal, for surfaces that offer their own way out. */
export function useCloudProjectActivationScope(): CloudProjectActivationScopeValue {
  return useContext(CloudProjectActivationScopeContext);
}

/** One project value surface; authentication and publishing retain their owners. */
export function CloudProjectActivation({ action, supplemental, busy = false, projectName }: {
  action: ReactNode;
  supplemental?: ReactNode;
  busy?: boolean;
  projectName?: string | null;
}) {
  const { t } = useLocalization();
  return <CloudProjectActivationFrame action={action} busy={busy} projectName={projectName}>
    <ul className="desktop-cloud-project-values" role="list">
      <CloudProjectValue icon={<Bot {...VALUE_ICON_PROPS} />}
        title={t("cloud.activation.project.agents")} detail={t("cloud.activation.project.agentsDetail")} />
      <CloudProjectValue icon={<Users {...VALUE_ICON_PROPS} />}
        title={t("cloud.activation.project.teammates")} detail={t("cloud.activation.project.teammatesDetail")} />
      <CloudProjectValue icon={<History {...VALUE_ICON_PROPS} />}
        title={t("cloud.activation.project.history")} detail={t("cloud.activation.project.historyDetail")} />
    </ul>
    {supplemental && <div className="desktop-cloud-project-activation-supplemental">{supplemental}</div>}
  </CloudProjectActivationFrame>;
}

/** Shared Cloud conversion presentation; callers retain consent, auth and publishing. */
export function CloudProjectActivationFrame({ action, secondary, children, busy = false, projectName, title, lead }: {
  action?: ReactNode;
  secondary?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  projectName?: string | null;
  title?: string;
  lead?: string;
}) {
  const { t } = useLocalization();
  const scope = useContext(CloudProjectActivationScopeContext);
  const name = (projectName ?? scope.projectName)?.trim() || null;
  return <section className="desktop-cloud-project-activation" aria-label={title ?? t("cloud.activation.project.title")} aria-busy={busy}>
    <CloudProjectJourney projectName={name} />
    {/* The only part of the frame that scrolls; see the stylesheet. */}
    <div className="desktop-cloud-project-activation-body" data-po-scrollbar="content">
      <p className="desktop-cloud-project-activation-eyebrow">
        <CloudIcon size={14} />
        <span>{t("cloud.productName")}</span>
      </p>
      <h2 className="desktop-cloud-project-activation-title" dir="auto">
        {title ?? (name ? t("cloud.activation.project.headline", { project: name }) : t("cloud.activation.project.headlineFallback"))}
      </h2>
      <p className="desktop-cloud-project-activation-lead">{lead ?? t("cloud.activation.project.lead")}</p>
      {children}
    </div>
    <footer className="desktop-cloud-project-activation-footer">
      <p className="desktop-cloud-project-activation-note">
        <LocalIcon size={13} strokeWidth={1.6} aria-hidden="true" />
        <span>{t("cloud.activation.project.localNote")}</span>
      </p>
      <div className="desktop-cloud-project-activation-actions">
        {secondary ?? (scope.onDismiss && <button type="button" className="desktop-dialog-button desktop-cloud-project-activation-dismiss"
          onClick={scope.onDismiss}>{t("cloud.activation.project.notNow")}</button>)}
        {action}
      </div>
    </footer>
  </section>;
}

function CloudProjectValue({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <li className="desktop-cloud-project-value">
    <span className="desktop-cloud-project-value-icon" aria-hidden="true">{icon}</span>
    <span className="desktop-cloud-project-value-copy">
      <strong>{title}</strong>
      <span>{detail}</span>
    </span>
  </li>;
}

/** Decorative teammates; initials are illustrative, not live members. */
const TEAMMATE_INITIALS = ["A", "M", "J"] as const;

/** A static local folder → Cloud → Agents and teammates diagram, named after the current project. */
function CloudProjectJourney({ projectName }: { projectName: string | null }) {
  const { t } = useLocalization();
  return <div className="desktop-cloud-project-journey">
    <div className="desktop-cloud-project-journey-card desktop-cloud-project-journey-folder" aria-hidden="true">
      <CloudPublishFolderMark className="desktop-cloud-project-journey-folder-mark" />
      <span className="desktop-cloud-project-journey-folder-name">{projectName ?? t("cloud.activation.project.folderFallback")}</span>
      <span className="desktop-cloud-project-journey-folder-meta">
        <LocalIcon size={12} strokeWidth={1.6} />
        {t("cloud.share.location.thisDevice")}
      </span>
    </div>
    <span className="desktop-cloud-project-journey-wire is-active" aria-hidden="true" />
    <div className="desktop-cloud-project-journey-cloud" aria-hidden="true">
      <span className="desktop-cloud-project-journey-card desktop-cloud-project-journey-cloud-mark"><CloudIcon size={28} /></span>
    </div>
    <span className="desktop-cloud-project-journey-wire" aria-hidden="true" />
    <div className="desktop-cloud-project-journey-audiences">
      <ul className="desktop-cloud-project-journey-card desktop-cloud-project-journey-agents" role="list"
        aria-label={t("cloud.activation.project.agentsLabel")}>
        {CLOUD_AGENT_BRANDS.map((brandId) => <li key={brandId}>
          <span className="desktop-cloud-project-journey-agent-mark" aria-hidden="true"><AgentBrandImage brandId={brandId} /></span>
          <span className="desktop-cloud-project-journey-agent-name">{getAgentBrand(brandId)?.displayName}</span>
          <span className="desktop-cloud-project-journey-agent-status" aria-hidden="true" />
        </li>)}
        <li className="is-protocol">
          <span className="desktop-cloud-project-journey-agent-mark" aria-hidden="true"><McpLogoIcon size={15} /></span>
          <span className="desktop-cloud-project-journey-agent-name">{t("cloud.activation.project.anyMcp")}</span>
          <span className="desktop-cloud-project-journey-agent-status" aria-hidden="true" />
        </li>
      </ul>
      <div className="desktop-cloud-project-journey-card desktop-cloud-project-journey-people" aria-hidden="true">
        <span className="desktop-cloud-project-journey-avatars">
          {TEAMMATE_INITIALS.map((initial) => <span key={initial}>{initial}</span>)}
        </span>
        <span className="desktop-cloud-project-journey-people-copy">
          <span className="desktop-cloud-project-journey-people-label">{t("cloud.activation.project.teammatesLabel")}</span>
          <span className="desktop-cloud-project-journey-people-link">
            <Link2 size={11} strokeWidth={1.8} />
            <span>puppyone.ai/…</span>
          </span>
        </span>
      </div>
    </div>
  </div>;
}
