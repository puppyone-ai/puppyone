import { Tooltip } from "@puppyone/shared-ui";
import { useState } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { AgentBrandMark } from "./AgentBrandMark";
import { agentEmptyLogoGeometry } from "./agent-runtime-geometry";

type AgentEmptyStateProps = {
  runtimeIconKey?: string | null;
  runtimeLabel: string;
};

/** Quiet ready-state cue; runtime identity belongs here, model configuration does not. */
export function AgentEmptyState({ runtimeIconKey, runtimeLabel }: AgentEmptyStateProps) {
  const { t } = useLocalization();
  const [logoTurns, setLogoTurns] = useState(0);

  return (
    <div className="desktop-agent-empty-state">
      <Tooltip content={t("agent.empty.spinLogo", { agent: bidiIsolate(runtimeLabel) })}><button
        type="button"
        className="desktop-agent-empty-logo-button"
        style={agentEmptyLogoGeometry(logoTurns)}
        aria-label={t("agent.empty.spinLogo", { agent: bidiIsolate(runtimeLabel) })}
        onClick={() => setLogoTurns((turns) => turns + 1)}
      >
        <AgentBrandMark
          appearance="monochrome"
          iconKey={runtimeIconKey}
          label={runtimeLabel}
        />
      </button></Tooltip>
      <p>{t("agent.empty.prompt")}</p>
    </div>
  );
}
