import { Tooltip } from "@puppyone/shared-ui";
import { Check, Cloud, Copy, LockKeyhole, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import "./settings.css";
import {
  updateCloudProject,
  type DesktopCloudProject,
  type DesktopCloudSession,
} from "../../../../lib/cloudApi";
import type { CloudWorkspaceSection } from "../../types";
import { copyText } from "../../utils";

type SettingsTab = "general" | "access" | "connection";

const SETTINGS_TABS: SettingsTab[] = ["general", "access", "connection"];

export function CloudProjectSettingsSection({
  project,
  cloudSession,
  apiBaseUrl,
  loading,
  matchesRepositoryRemote,
  removeRemoteAction = null,
  onSessionChange,
  onRefresh,
  onSelectSection,
}: {
  project: DesktopCloudProject;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  loading: boolean;
  matchesRepositoryRemote: boolean;
  removeRemoteAction?: {
    busy?: boolean;
    onRemove: () => void;
  } | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onRefresh: () => Promise<void>;
  onSelectSection: (section: CloudWorkspaceSection) => void;
}) {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [currentProject, setCurrentProject] = useState(project);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [branch, setBranch] = useState(project.bound_git_branch || "main");
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [copiedProjectId, setCopiedProjectId] = useState(false);
  const [confirmRemoveRemote, setConfirmRemoveRemote] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setCurrentProject(project);
    setName(project.name);
    setDescription(project.description ?? "");
    setBranch(project.bound_git_branch || "main");
  }, [project]);

  const canManage = currentProject.capabilities?.includes("project.settings.manage") === true;
  const visibility = currentProject.visibility === "private" ? "private" : "org";
  const generalDirty = name.trim() !== currentProject.name
    || description.trim() !== (currentProject.description ?? "").trim()
    || branch.trim() !== (currentProject.bound_git_branch || "main");
  const generalValid = Boolean(name.trim() && branch.trim());

  const saveGeneral = async () => {
    if (!generalDirty || !generalValid || savingGeneral) return;
    setSavingGeneral(true);
    setFeedback(null);
    try {
      const updated = await updateCloudProject(
        cloudSession,
        currentProject.id,
        {
          name: name.trim(),
          description: description.trim() || null,
          bound_git_branch: branch.trim(),
        },
        onSessionChange,
        apiBaseUrl,
      );
      setCurrentProject(updated);
      setName(updated.name);
      setDescription(updated.description ?? "");
      setBranch(updated.bound_git_branch || "main");
      setFeedback({ tone: "success", message: t("cloud.settings.saved") });
      await onRefresh().catch(() => undefined);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: t("cloud.settings.saveFailed", {
          detail: bidiIsolate(error instanceof Error ? error.message : String(error)),
        }),
      });
    } finally {
      setSavingGeneral(false);
    }
  };

  const saveVisibility = async (next: "org" | "private") => {
    if (next === visibility || savingVisibility) return;
    setSavingVisibility(true);
    setFeedback(null);
    try {
      const updated = await updateCloudProject(
        cloudSession,
        currentProject.id,
        { visibility: next },
        onSessionChange,
        apiBaseUrl,
      );
      setCurrentProject(updated);
      setFeedback({ tone: "success", message: t("cloud.settings.saved") });
      await onRefresh().catch(() => undefined);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: t("cloud.settings.saveFailed", {
          detail: bidiIsolate(error instanceof Error ? error.message : String(error)),
        }),
      });
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleCopyProjectId = async () => {
    try {
      await copyText(currentProject.id);
      setCopiedProjectId(true);
      window.setTimeout(() => setCopiedProjectId(false), 1_500);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: t("cloud.settings.copyFailed", {
          detail: bidiIsolate(error instanceof Error ? error.message : String(error)),
        }),
      });
    }
  };

  return (
    <section className="desktop-cloud-settings-page" aria-label={t("cloud.route.settings.title")}>
      <main className="desktop-cloud-settings-canvas" data-po-scrollbar="content">
        <div className="desktop-cloud-settings-catalog">
          <header className="desktop-cloud-settings-landing-header">
            <div className="desktop-cloud-settings-landing-copy">
              <h1>{t("cloud.route.settings.title")}</h1>
              <p>{t("cloud.route.settings.description")}</p>
            </div>
          </header>

          <nav
            className="desktop-cloud-settings-tabs"
            data-po-scrollbar="hidden"
            aria-label={t("cloud.settings.tabsAria")}
            role="tablist"
          >
            {SETTINGS_TABS.map((tab) => (
              <button
                className={activeTab === tab ? "active" : undefined}
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => {
                  setActiveTab(tab);
                  setFeedback(null);
                }}
              >
                {t(`cloud.settings.tab.${tab}`)}
              </button>
            ))}
          </nav>

          {feedback ? (
            <div className={`desktop-cloud-settings-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
              {feedback.message}
            </div>
          ) : null}

          {!canManage ? (
            <section className="desktop-cloud-settings-panel desktop-cloud-settings-restricted" role="tabpanel">
              <span aria-hidden="true"><LockKeyhole size={20} /></span>
              <div>
                <h2>{t("cloud.settings.restrictedTitle")}</h2>
                <p>{t("cloud.settings.restrictedDetail")}</p>
              </div>
              <button type="button" onClick={() => onSelectSection("contents")}>{t("cloud.route.contents.label")}</button>
            </section>
          ) : activeTab === "general" ? (
            <section className="desktop-cloud-settings-panel" role="tabpanel">
              <header className="desktop-cloud-settings-panel-header">
                <div>
                  <h2>{t("cloud.settings.generalTitle")}</h2>
                  <p>{t("cloud.settings.generalDetail")}</p>
                </div>
                <button
                  className="desktop-cloud-settings-primary-button"
                  type="button"
                  disabled={!generalDirty || !generalValid || savingGeneral || loading}
                  onClick={() => void saveGeneral()}
                >
                  {t(savingGeneral ? "cloud.common.saving" : "cloud.common.saveChanges")}
                </button>
              </header>
              <div className="desktop-cloud-settings-form">
                <label className="desktop-cloud-settings-field">
                  <span>{t("cloud.common.name")}</span>
                  <small>{t("cloud.settings.nameHelp")}</small>
                  <input value={name} maxLength={200} disabled={savingGeneral} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="desktop-cloud-settings-field">
                  <span>{t("cloud.settings.description")}</span>
                  <small>{t("cloud.settings.descriptionHelp")}</small>
                  <textarea value={description} rows={3} disabled={savingGeneral} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <label className="desktop-cloud-settings-field">
                  <span>{t("cloud.git.branch")}</span>
                  <small>{t("cloud.settings.branchHelp")}</small>
                  <input className="mono" value={branch} disabled={savingGeneral} onChange={(event) => setBranch(event.target.value)} />
                </label>
                <div className="desktop-cloud-settings-id-row">
                  <div>
                    <span>{t("cloud.project.id")}</span>
                    <small>{t("cloud.settings.projectIdHelp")}</small>
                  </div>
                  <div>
                    <Tooltip content={currentProject.id} overflowOnly><code>{currentProject.id}</code></Tooltip>
                    <button type="button" onClick={() => void handleCopyProjectId()}>
                      {copiedProjectId ? <Check size={13} /> : <Copy size={13} />}
                      <span>{t(copiedProjectId ? "cloud.common.copied" : "cloud.common.copyValue")}</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : activeTab === "access" ? (
            <section className="desktop-cloud-settings-panel" role="tabpanel">
              <header className="desktop-cloud-settings-panel-header">
                <div>
                  <h2>{t("cloud.settings.visibilityTitle")}</h2>
                  <p>{t("cloud.settings.visibilityDetail")}</p>
                </div>
              </header>
              <div className="desktop-cloud-settings-choice-grid">
                <button
                  className={visibility === "org" ? "selected" : undefined}
                  type="button"
                  aria-pressed={visibility === "org"}
                  disabled={savingVisibility || loading}
                  onClick={() => void saveVisibility("org")}
                >
                  <span className="desktop-cloud-settings-choice-check">{visibility === "org" ? <Check size={13} /> : null}</span>
                  <strong>{t("cloud.settings.visibilityOrganization")}</strong>
                  <small>{t("cloud.settings.visibilityOrganizationHelp")}</small>
                </button>
                <button
                  className={visibility === "private" ? "selected" : undefined}
                  type="button"
                  aria-pressed={visibility === "private"}
                  disabled={savingVisibility || loading}
                  onClick={() => void saveVisibility("private")}
                >
                  <span className="desktop-cloud-settings-choice-check">{visibility === "private" ? <Check size={13} /> : null}</span>
                  <strong>{t("cloud.settings.visibilityPrivate")}</strong>
                  <small>{t("cloud.settings.visibilityPrivateHelp")}</small>
                </button>
              </div>
            </section>
          ) : (
            <section className="desktop-cloud-settings-panel" role="tabpanel">
              <header className="desktop-cloud-settings-panel-header">
                <div>
                  <h2>{t("cloud.settings.connectionTitle")}</h2>
                  <p>{t("cloud.settings.connectionDetail")}</p>
                </div>
              </header>
              <div className={`desktop-cloud-settings-connection-row ${matchesRepositoryRemote ? "connected" : ""}`}>
                <span className="desktop-cloud-settings-connection-icon" aria-hidden="true"><Cloud size={17} /></span>
                <div>
                  <strong>{t("cloud.overview.repositoryRemote")}</strong>
                  <small>{t(matchesRepositoryRemote ? "cloud.state.remoteConnectedDescription" : "cloud.overview.noRepositoryRemote")}</small>
                </div>
                {removeRemoteAction ? (
                  <button
                    className={`desktop-cloud-settings-remove-button ${confirmRemoveRemote ? "confirm" : ""}`}
                    type="button"
                    disabled={removeRemoteAction.busy}
                    onBlur={() => setConfirmRemoveRemote(false)}
                    onClick={() => {
                      if (!confirmRemoveRemote) {
                        setConfirmRemoveRemote(true);
                        return;
                      }
                      setConfirmRemoveRemote(false);
                      removeRemoteAction.onRemove();
                    }}
                  >
                    <Unlink size={13} />
                    <span>{t(removeRemoteAction.busy ? "cloud.project.removingRemote" : confirmRemoveRemote ? "cloud.project.confirmRemoveRemote" : "cloud.project.removeRemote")}</span>
                  </button>
                ) : null}
              </div>
            </section>
          )}
        </div>
      </main>
    </section>
  );
}
