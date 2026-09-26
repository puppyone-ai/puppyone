import { useId } from "react";
import { useLocalization } from "@puppyone/localization/react";
import "./cloud-agent-catalog.css";

// Candidate destinations only. A row must not imply account discovery or an
// active connection until a destination-specific setup flow exists.
const CLOUD_AGENT_NAMES = [
  "ChatGPT",
  "Claude",
  "Viktor",
  "Manus",
  "Cursor Cloud Agent",
  "Replit Agent",
  "Gemini",
  "Codex Cloud",
  "GitHub Copilot cloud agent",
  "Devin",
  "Microsoft Copilot Studio",
  "Jules",
] as const;

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
      <p className="desktop-cloud-agent-catalog-detail">
        {t("terminal.launcher.cloudAgents.detail")}
      </p>
      <ul className="desktop-cloud-agent-catalog-list">
        {CLOUD_AGENT_NAMES.map((name) => (
          <li className="desktop-cloud-agent-catalog-item" key={name} title={name}>
            <span className="desktop-cloud-agent-catalog-dot" aria-hidden="true" />
            <span className="desktop-cloud-agent-catalog-name">{name}</span>
          </li>
        ))}
        <li className="desktop-cloud-agent-catalog-item is-custom">
          <span className="desktop-cloud-agent-catalog-dot" aria-hidden="true" />
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
