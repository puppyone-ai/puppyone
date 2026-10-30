import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, removeConnectedAgent,
  stopSharingWithAgents, type AgentAdmission, type AgentLinkInventory } from "./agentLinks";

/** While the dialog is open, an Agent the owner just allowed appears on its own. */
const REFRESH_MS = 5_000;
const EMPTY: AgentLinkInventory = { links: [], connections: [] };

export function CloudWorkspaceAgentShare({ projectId, projectName, session, apiBaseUrl }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
}) {
  const { t } = useLocalization();
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed" | "not-owner">("idle");
  const [inventory, setInventory] = useState(EMPTY);
  const [changeFailed, setChangeFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await listAgentLinks(session, projectId, apiBaseUrl);
      if (mounted.current) setInventory(next);
    } catch { /* The list is a convenience; sharing does not depend on it. */ }
  }, [apiBaseUrl, projectId, session]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const copy = async () => {
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, admission, apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setStatus("copied");
      void refresh();
    } catch (error) {
      if (mounted.current) setStatus((error as { status?: number }).status === 403 ? "not-owner" : "failed");
    }
  };
  const change = async (action: () => Promise<unknown>) => {
    setChangeFailed(false);
    try { await action(); await refresh(); }
    catch { if (mounted.current) setChangeFailed(true); }
  };
  const sharing = inventory.links.length > 0 || inventory.connections.length > 0;

  return <section className="desktop-cloud-agent-share" aria-label={t("cloud.share.agent.title")}>
    <h3>{t("cloud.share.agent.title")}</h3>
    <div className="desktop-share-mode" role="radiogroup" aria-label={t("cloud.share.agent.title")}>
      {(["sign_in", "link"] as const).map(option => <button key={option} type="button" role="radio"
        aria-checked={admission === option} data-agent-admission={option}
        className={`desktop-share-mode-option${admission === option ? " is-selected" : ""}`}
        onClick={() => { setAdmission(option); setStatus("idle"); }}>
        {t(option === "link" ? "cloud.share.agent.link.label" : "cloud.share.agent.signIn.label")}
      </button>)}
    </div>
    <p className="desktop-cloud-agent-share-note">
      {t(admission === "link" ? "cloud.share.agent.link.description" : "cloud.share.agent.signIn.description")}
    </p>
    <div className="desktop-cloud-agent-share-action">
      <button type="button" className="desktop-dialog-button primary" disabled={status === "copying"}
        onClick={() => void copy()}>{t("cloud.share.agent.copy")}</button>
      <span role="status">{status === "copied" ? t("cloud.share.agent.copied") : ""}</span>
    </div>
    {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
    {inventory.connections.length > 0 && <>
      <h4>{t("cloud.share.agent.connected")}</h4>
      <ul className="desktop-cloud-agent-list">
        {inventory.connections.map(agent => <li key={agent.id}>
          <span dir="auto">{agent.name}</span>
          <Tooltip content={t("cloud.share.agent.remove")}>
            <button type="button" aria-label={`${t("cloud.share.agent.remove")} ${agent.name}`}
              onClick={() => void change(() => removeConnectedAgent(session, projectId, agent.grant_id, apiBaseUrl))}>
              <X size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </li>)}
      </ul>
    </>}
    {sharing && <button type="button" className="desktop-dialog-button desktop-cloud-agent-share-stop"
      onClick={() => void change(() => stopSharingWithAgents(session, projectId, apiBaseUrl))}>
      {t("cloud.share.agent.stop")}
    </button>}
    {changeFailed && <p role="alert">{t("cloud.share.agent.changeFailed")}</p>}
  </section>;
}
