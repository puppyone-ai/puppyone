import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { cloudApiRequest, type DesktopCloudSession, type MutableSessionHandler } from "../../../lib/cloudApi";
import type { CloudSandbox, CloudSandboxSettings } from "../files/contracts";
import { readCloudSandbox } from "./cloudSandboxFeatures";

/**
 * The owner's Cloud Computer choices for one project. "Desktop" applies when
 * the next computer is created; "Show screen" applies immediately. The backend
 * resolves both; this panel only shows and sends them.
 */
export function CloudComputerSettings({
  projectId,
  session,
  apiBaseUrl,
  onSessionChange,
  showDesktopControls = true,
  showIsolatedAgentsControl = false,
  canManageProjectSettings = true,
}: {
  projectId: string;
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  onSessionChange?: MutableSessionHandler;
  showDesktopControls?: boolean;
  showIsolatedAgentsControl?: boolean;
  canManageProjectSettings?: boolean;
}) {
  const { t } = useLocalization();
  const endpoint = `/projects/${encodeURIComponent(projectId)}/workbench`;
  const [sandbox, setSandbox] = useState<CloudSandbox | null>(null);
  const [saving, setSaving] = useState<keyof CloudSandboxSettings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void cloudApiRequest<{ workspace: { sandbox?: unknown } | null }>(endpoint, session, onSessionChange, {}, apiBaseUrl)
      .then(value => { if (current) setSandbox(readCloudSandbox(value.workspace?.sandbox)); })
      .catch(() => { if (current) { setSandbox(readCloudSandbox(null)); setFailed(true); } });
    return () => { current = false; };
  }, [endpoint, session, onSessionChange, apiBaseUrl]);

  const desktop = sandbox?.settings.desktop ?? sandbox?.next_profile === "desktop";
  const stream = sandbox?.settings.screen_stream ?? true;
  const isolatedAgents = sandbox?.settings.isolated_agent_sandboxes ?? false;
  const pending = Boolean(sandbox && sandbox.profile && sandbox.next_profile && sandbox.profile !== sandbox.next_profile);
  const save = async (key: keyof CloudSandboxSettings, value: boolean) => {
    setSaving(key);
    setFailed(false);
    try {
      const updated = await cloudApiRequest<unknown>(`${endpoint}/sandbox`, session, onSessionChange, {
        method: "PUT", body: JSON.stringify({ [key]: value }), headers: { "Content-Type": "application/json" },
      }, apiBaseUrl);
      setSandbox(readCloudSandbox(updated));
    } catch {
      setFailed(true);
    } finally {
      setSaving(null);
    }
  };

  const rows: { key: keyof CloudSandboxSettings; on: boolean; title: string; help: string; disabled?: boolean }[] = [
    ...(showDesktopControls ? [
      { key: "desktop" as const, on: desktop, title: t("cloud.settings.computer.desktop"),
        help: t(pending ? "cloud.settings.computer.desktopPending" : "cloud.settings.computer.desktopHelp") },
      { key: "screen_stream" as const, on: stream, title: t("cloud.settings.computer.stream"),
        help: t("cloud.settings.computer.streamHelp") },
    ] : []),
    ...(showIsolatedAgentsControl ? [
      { key: "isolated_agent_sandboxes" as const, on: isolatedAgents,
        title: t("cloud.settings.computer.isolatedAgents"),
        help: t("cloud.settings.computer.isolatedAgentsHelp"),
        disabled: !canManageProjectSettings },
    ] : []),
  ];
  return <section className="desktop-cloud-settings-panel" role="tabpanel">
    <header className="desktop-cloud-settings-panel-header">
      <div>
        <h2>{t("cloud.settings.computer.title")}</h2>
        <p>{t("cloud.settings.computer.detail")}</p>
      </div>
    </header>
    {failed && <div className="desktop-cloud-settings-feedback error" role="alert">{t("cloud.settings.computer.failed")}</div>}
    <div className="desktop-cloud-settings-choice-grid">
      {rows.map(row => <button key={row.key} type="button" className={row.on ? "selected" : undefined}
        aria-pressed={row.on} disabled={!sandbox || saving !== null || Boolean(row.disabled)}
        onClick={() => void save(row.key, !row.on)}>
        <span className="desktop-cloud-settings-choice-check">{row.on ? <Check size={13} /> : null}</span>
        <strong>{row.title}</strong>
        <small>{row.help}</small>
      </button>)}
    </div>
  </section>;
}
