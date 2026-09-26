import { useId } from "react";
import { Puzzle } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandImage, type AgentBrandId } from "@puppyone/shared-ui";
import "./cloud-agent-catalog.css";

// Candidate destinations only. A row must not imply account discovery or an
// active connection until a destination-specific setup flow exists.
const CLOUD_AGENTS: readonly Readonly<{ name: string; brandId: AgentBrandId }>[] = [
  { name: "ChatGPT", brandId: "chatgpt" },
  { name: "Claude", brandId: "claude" },
  { name: "Viktor", brandId: "viktor" },
  { name: "Manus", brandId: "manus" },
  { name: "Cursor Cloud Agent", brandId: "cursor" },
  { name: "Replit Agent", brandId: "replit" },
  { name: "Gemini", brandId: "gemini" },
  { name: "Codex Cloud", brandId: "codex" },
  { name: "GitHub Copilot", brandId: "github-copilot" },
  { name: "Devin", brandId: "devin" },
  { name: "Microsoft Copilot Studio", brandId: "copilot-studio" },
  { name: "Jules", brandId: "jules" },
];

export function CloudAgentCatalog() {
  const { t } = useLocalization();
  const titleId = useId();

  return (
    <section className="desktop-terminal-launcher-group desktop-cloud-agent-catalog"
      aria-labelledby={titleId}>
      <header className="desktop-terminal-launcher-heading">
        <h2 id={titleId}>
          <span>{t("terminal.launcher.cloudAgents.title")}</span>
        </h2>
      </header>
      <ul className="desktop-cloud-agent-catalog-list">
        {CLOUD_AGENTS.map(({ name, brandId }) => (
          <li className="desktop-cloud-agent-catalog-item" key={brandId} title={name}
            data-brand-id={brandId}>
            <span className="desktop-cloud-agent-catalog-icon" aria-hidden="true">
              <AgentBrandImage brandId={brandId} />
            </span>
            <span className="desktop-cloud-agent-catalog-name">{name}</span>
          </li>
        ))}
        <li className="desktop-cloud-agent-catalog-item is-custom">
          <span className="desktop-cloud-agent-catalog-icon" aria-hidden="true">
            <Puzzle size={18} strokeWidth={1.7} />
          </span>
          <span className="desktop-cloud-agent-catalog-name">
            {t("terminal.launcher.cloudAgents.custom")}
          </span>
          <span className="desktop-cloud-agent-catalog-protocol">
            {t("terminal.launcher.cloudAgents.protocol")}
          </span>
        </li>
      </ul>
    </section>
  );
}
