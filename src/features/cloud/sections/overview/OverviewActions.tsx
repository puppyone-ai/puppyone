import { ChevronRight, GitBranch, SquareTerminal } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { McpLogoIcon } from "../../components/McpLogoIcon";
import type { CloudWorkspaceSection } from "../../types";

const AGENT_PROVIDER_LABELS = ["ChatGPT", "Claude", "Cursor", "Manus", "MCP"] as const;

export function CloudOverviewActions({
  onSelectSection,
}: {
  onSelectSection: (section: CloudWorkspaceSection) => void;
}) {
  const { t } = useLocalization();

  return (
    <section className="desktop-cloud-overview-actions" aria-label={t("cloud.overview.actionsAria")}>
      <header className="desktop-cloud-overview-actions-header">
        <span>{t("cloud.access.create.startWithJob")}</span>
        <h2>{t("cloud.access.create.intentQuestion")}</h2>
        <p>{t("cloud.access.create.description")}</p>
      </header>

      <div className="desktop-cloud-overview-action-grid">
        <button
          className="desktop-cloud-overview-action-card primary"
          type="button"
          onClick={() => onSelectSection("mcp")}
        >
          <span className="desktop-cloud-overview-action-icon mcp" aria-hidden="true">
            <McpLogoIcon size={19} />
          </span>
          <span className="desktop-cloud-overview-action-copy">
            <strong>{t("cloud.access.create.intent.agent.label")}</strong>
            <span>{t("cloud.access.create.intent.agent.preview")}</span>
            <span className="desktop-cloud-overview-agent-providers" aria-hidden="true">
              {AGENT_PROVIDER_LABELS.map((provider) => <i key={provider}>{provider}</i>)}
            </span>
          </span>
          <ChevronRight className="desktop-cloud-overview-action-chevron" size={15} aria-hidden="true" />
        </button>

        <button
          className="desktop-cloud-overview-action-card"
          type="button"
          onClick={() => onSelectSection("cli")}
        >
          <span className="desktop-cloud-overview-action-icon cli" aria-hidden="true">
            <SquareTerminal size={18} />
          </span>
          <span className="desktop-cloud-overview-action-copy">
            <strong>{t("cloud.access.create.intent.cli.label")}</strong>
            <span>{t("cloud.route.cli.description")}</span>
          </span>
          <ChevronRight className="desktop-cloud-overview-action-chevron" size={15} aria-hidden="true" />
        </button>

        <button
          className="desktop-cloud-overview-action-card"
          type="button"
          onClick={() => onSelectSection("git-sync")}
        >
          <span className="desktop-cloud-overview-action-icon git" aria-hidden="true">
            <GitBranch size={18} />
          </span>
          <span className="desktop-cloud-overview-action-copy">
            <strong>{t("cloud.access.create.intent.git.label")}</strong>
            <span>{t("cloud.route.git-sync.description")}</span>
          </span>
          <ChevronRight className="desktop-cloud-overview-action-chevron" size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
