import { CircleAlert, RefreshCw } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentRuntimeCatalogEntry } from "../domain/agent-contract";
import { isSelectableAgentBackend } from "../domain/agent-backend-routing";
import { AgentBrandMark } from "./AgentBrandMark";

type AgentRuntimeLauncherProps = {
  agentRuntimes: AgentRuntimeCatalogEntry[];
  onLaunch: (runtimeId: string) => void;
  onRefresh: () => void;
};

/** Pre-Chat launch surface. Choosing a row establishes the harness boundary. */
export function AgentRuntimeLauncher({
  agentRuntimes,
  onLaunch,
  onRefresh,
}: AgentRuntimeLauncherProps) {
  const { t } = useLocalization();

  return (
    <section
      className="desktop-agent-runtime-launcher"
      aria-labelledby="desktop-agent-runtime-launcher-title"
      aria-describedby="desktop-agent-runtime-launcher-description"
    >
      <div className="desktop-agent-runtime-launcher-content">
          <div className="desktop-agent-runtime-launcher-group">
            <header className="desktop-agent-runtime-launcher-heading">
              <h2 id="desktop-agent-runtime-launcher-title">
                <span>{t("agent.launcher.title")}</span>
              </h2>
              <button
                type="button"
                className="desktop-agent-runtime-launcher-refresh"
                aria-label={t("agent.launcher.scanAgain")}
                title={t("agent.launcher.scanAgain")}
                onClick={onRefresh}
              >
                <RefreshCw size={12} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </header>

            <p
              id="desktop-agent-runtime-launcher-description"
              className="desktop-agent-runtime-launcher-description"
            >
              {t("agent.launcher.description")}
            </p>

            {agentRuntimes.length > 0 ? (
              <div className="desktop-agent-runtime-launcher-list">
                {agentRuntimes.map((entry) => {
                  const ready = isSelectableAgentBackend(entry);
                  const detail = entry.readiness.message || entry.descriptor.description || "";
                  return (
                    <button
                      key={entry.descriptor.id}
                      type="button"
                      className="desktop-agent-runtime-launcher-option"
                      data-po-interaction="navigation"
                      aria-label={entry.descriptor.displayName}
                      title={detail || entry.descriptor.displayName}
                      onClick={() => onLaunch(entry.descriptor.id)}
                    >
                      <AgentBrandMark
                        iconKey={entry.descriptor.iconKey}
                        label={entry.descriptor.displayName}
                      />
                      <span>{entry.descriptor.displayName}</span>
                      {!ready && (
                        <CircleAlert
                          className="desktop-agent-runtime-launcher-warning"
                          size={13}
                          strokeWidth={1.7}
                          aria-label={detail
                            ? t("agent.launcher.needsAttention", { agent: bidiIsolate(entry.descriptor.displayName) })
                            : undefined}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="desktop-agent-runtime-launcher-empty" role="status">
                {t("agent.launcher.noneAvailable")}
              </div>
            )}
          </div>
      </div>
    </section>
  );
}
