import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { GitRemoteSummary, GitStatusSnapshot, PuppyoneBackendService, PuppyoneWorkspaceConfig } from "../../types/electron";
import { parsePuppyoneRemote } from "../source-control/remotes";
import { useLocalization } from "@puppyone/localization";
import { SettingsSubsection } from "./components";
import { remoteKindLabel } from "./utils";

export function PuppyoneWorkspaceConfigSettings({
  config,
  remotes,
  branches,
  currentBranchName,
  cloudEnabled,
  loading,
  saving,
  error,
  onChange,
}: {
  config: PuppyoneWorkspaceConfig | null;
  remotes: GitRemoteSummary[];
  branches: GitStatusSnapshot["branches"];
  currentBranchName: string | null;
  cloudEnabled: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
}) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState<PuppyoneWorkspaceConfig>(() => normalizePuppyoneConfigDraft(config, cloudEnabled));
  const [localError, setLocalError] = useState<string | null>(null);
  const branchNames = branches
    .filter((branch) => !branch.remote)
    .map((branch) => branch.name);
  const watchedBranchListId = "desktop-puppyone-watched-branch-options";
  const backupBranchListId = "desktop-puppyone-backup-branch-options";
  const normalizedDraft = normalizePuppyoneConfigDraft(draft, cloudEnabled);
  const savedConfig = normalizePuppyoneConfigDraft(config, cloudEnabled);
  const dirty = !samePuppyoneConfig(normalizedDraft, savedConfig);
  const sourceService = draft.sync.sourceOfTruth.service;
  const sourceRemoteNames = getRemoteNamesForService(sourceService, remotes);
  const backupRemoteNames = getRemoteNamesForService(draft.backup.service, remotes);
  const sourceRemoteValue = sourceRemoteNames.includes(draft.sync.sourceOfTruth.remote ?? "")
    ? draft.sync.sourceOfTruth.remote ?? ""
    : "";
  const backupRemoteValue = backupRemoteNames.includes(draft.backup.remote ?? "")
    ? draft.backup.remote ?? ""
    : "";
  const sourceServiceOptions: Array<{
    value: PuppyoneBackendService;
    label: string;
    available: boolean;
  }> = [
    {
      value: "puppyone",
      label: "Puppyone Cloud",
      available: cloudEnabled,
    },
    {
      value: "github",
      label: "GitHub",
      available: true,
    },
  ];
  const showSourceGitHints = sourceService !== "puppyone";
  const showBackupDetails = draft.backup.enabled;

  useEffect(() => {
    setDraft(normalizePuppyoneConfigDraft(config, cloudEnabled));
    setLocalError(null);
  }, [cloudEnabled, config]);

  const updateSourceOfTruthConfig = (nextSourceOfTruth: Partial<PuppyoneWorkspaceConfig["sync"]["sourceOfTruth"]>) => {
    setDraft((current) => {
      const normalized = normalizePuppyoneConfigDraft(current, cloudEnabled);
      const sourceOfTruth = {
        ...normalized.sync.sourceOfTruth,
        ...nextSourceOfTruth,
      };
      return {
        ...normalized,
        sync: {
          sourceOfTruth,
        },
        git: {
          ...normalized.git,
          ...(Object.prototype.hasOwnProperty.call(nextSourceOfTruth, "remote") ? { primaryRemote: sourceOfTruth.remote } : {}),
          ...(Object.prototype.hasOwnProperty.call(nextSourceOfTruth, "branch") ? { watchedBranch: sourceOfTruth.branch } : {}),
        },
      };
    });
  };

  const updateBackupConfig = (nextBackup: Partial<PuppyoneWorkspaceConfig["backup"]>) => {
    setDraft((current) => {
      const normalized = normalizePuppyoneConfigDraft(current, cloudEnabled);
      return {
        ...normalized,
        backup: {
          ...normalized.backup,
          ...nextBackup,
        },
      };
    });
  };

  const selectSourceService = (service: PuppyoneBackendService) => {
    const normalizedService = normalizeBackendServiceDraft(service, cloudEnabled);
    updateSourceOfTruthConfig({
      service: normalizedService,
      remote: inferBackupRemote(normalizedService, remotes, draft.sync.sourceOfTruth.remote),
      branch: normalizedService === "puppyone" ? null : draft.sync.sourceOfTruth.branch,
    });
  };

  const saveConfig = async () => {
    setLocalError(null);
    try {
      const saved = await onChange(normalizedDraft);
      if (saved) setDraft(normalizePuppyoneConfigDraft(saved, cloudEnabled));
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  return (
    <SettingsSubsection leading>
      {loading && !config ? (
        <div className="desktop-settings-muted-row">{t("settings.workspaceConfig.reading")}</div>
      ) : (
        <>
          <div className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row desktop-hosting-service-panel">
            <span>
              {t("settings.workspaceConfig.sourceService.title")}
            </span>
            <div
              className="desktop-hosting-service-options"
              aria-label={t("settings.workspaceConfig.sourceService.ariaLabel")}
              aria-description={t("settings.workspaceConfig.sourceService.detail")}
            >
              {sourceServiceOptions.filter((option) => option.available).map((option) => (
                <button
                  className={`desktop-hosting-service-option ${sourceService === option.value ? "active" : ""}`}
                  type="button"
                  disabled={saving}
                  key={option.value}
                  onClick={() => selectSourceService(option.value)}
                >
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {showSourceGitHints && (
            <>
              <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
                <span>
                  {t("settings.workspaceConfig.gitRemote.title")}
                </span>
                <select
                  className="desktop-settings-select"
                  aria-description={t("settings.workspaceConfig.gitRemote.detail")}
                  value={sourceRemoteValue}
                  disabled={saving}
                  onChange={(event) => updateSourceOfTruthConfig({ remote: normalizeSettingsText(event.target.value) })}
                >
                  <option value="">{t("settings.workspaceConfig.auto")}</option>
                  {sourceRemoteNames.map((remoteName) => (
                    <option value={remoteName} key={remoteName}>{remoteName}</option>
                  ))}
                </select>
              </label>

              <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
                <span>
                  {t("settings.workspaceConfig.gitBranch.title")}
                </span>
                <input
                  className="desktop-settings-text-input"
                  aria-description={t("settings.workspaceConfig.gitBranch.detail")}
                  list={watchedBranchListId}
                  value={draft.sync.sourceOfTruth.branch ?? ""}
                  placeholder={currentBranchName && currentBranchName !== "detached" ? currentBranchName : t("settings.workspaceConfig.currentBranch")}
                  disabled={saving}
                  onChange={(event) => updateSourceOfTruthConfig({ branch: normalizeSettingsText(event.target.value) })}
                />
                <datalist id={watchedBranchListId}>
                  {branchNames.map((branchName) => (
                    <option value={branchName} key={branchName} />
                  ))}
                </datalist>
              </label>
            </>
          )}

          <div className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span>
              {t("settings.workspaceConfig.backupEnabled.title")}
            </span>
            <label className="desktop-settings-switch">
              <input
                type="checkbox"
                aria-label={t("settings.workspaceConfig.backupEnabled.title")}
                aria-description={t("settings.workspaceConfig.backupEnabled.detail")}
                checked={draft.backup.enabled}
                disabled={saving}
                onChange={(event) => updateBackupConfig({ enabled: event.target.checked })}
              />
              <span aria-hidden="true" />
            </label>
          </div>

          {showBackupDetails && (
            <>
              <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
                <span>
                  {t("settings.workspaceConfig.backupTarget.title")}
                </span>
                <select
                  className="desktop-settings-select"
                  aria-description={t("settings.workspaceConfig.backupTarget.detail")}
                  value={draft.backup.service}
                  disabled={saving}
                  onChange={(event) => {
                    const service = normalizeBackendServiceDraft(event.target.value, cloudEnabled);
                    updateBackupConfig({
                      service,
                      remote: inferBackupRemote(service, remotes, draft.backup.remote),
                    });
                  }}
                >
                  {cloudEnabled && <option value="puppyone">Puppyone Cloud</option>}
                  <option value="github">GitHub</option>
                </select>
              </label>

              {draft.backup.service !== "puppyone" && (
                <>
                  <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
                    <span>
                      {t("settings.workspaceConfig.backupRemote.title")}
                    </span>
                    <select
                      className="desktop-settings-select"
                      aria-description={t("settings.workspaceConfig.backupRemote.detail")}
                      value={backupRemoteValue}
                      disabled={saving}
                      onChange={(event) => updateBackupConfig({ remote: normalizeSettingsText(event.target.value) })}
                    >
                      <option value="">{t("settings.workspaceConfig.auto")}</option>
                      {backupRemoteNames.map((remoteName) => (
                        <option value={remoteName} key={remoteName}>{remoteName}</option>
                      ))}
                    </select>
                  </label>

                  <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
                    <span>
                      {t("settings.workspaceConfig.backupBranch.title")}
                    </span>
                    <input
                      className="desktop-settings-text-input"
                      aria-description={t("settings.workspaceConfig.backupBranch.detail")}
                      list={backupBranchListId}
                      value={draft.backup.branch ?? ""}
                      placeholder={currentBranchName && currentBranchName !== "detached" ? currentBranchName : t("settings.workspaceConfig.currentBranch")}
                      disabled={saving}
                      onChange={(event) => updateBackupConfig({ branch: normalizeSettingsText(event.target.value) })}
                    />
                    <datalist id={backupBranchListId}>
                      {branchNames.map((branchName) => (
                        <option value={branchName} key={branchName} />
                      ))}
                    </datalist>
                  </label>
                </>
              )}
            </>
          )}

          <div className="desktop-puppyone-config-footer">
            <span>{error ?? localError ?? t(dirty ? "settings.workspaceConfig.unsaved" : "settings.workspaceConfig.upToDate")}</span>
            <div>
              <button
                className="desktop-settings-row-action"
                type="button"
                disabled={!dirty || saving}
                onClick={() => setDraft(savedConfig)}
              >
                <RefreshCw size={13} />
                <span>{t("common.action.reset")}</span>
              </button>
              <button
                className="desktop-settings-row-action desktop-settings-save-action"
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveConfig()}
              >
                <Check size={13} />
                <span>{t(saving ? "settings.workspaceConfig.saving" : "common.action.save")}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </SettingsSubsection>
  );
}

function normalizePuppyoneConfigDraft(config: PuppyoneWorkspaceConfig | null, cloudEnabled = true): PuppyoneWorkspaceConfig {
  const sourceOfTruthService = normalizeBackendServiceDraft(
    config?.sync?.sourceOfTruth?.service ?? config?.backup?.service,
    cloudEnabled,
  );
  const isPuppyoneSource = sourceOfTruthService === "puppyone";
  const sourceOfTruthRemote =
    normalizeSettingsText(config?.sync?.sourceOfTruth?.remote)
    ?? normalizeSettingsText(config?.git?.primaryRemote)
    ?? normalizeSettingsText(config?.backup?.remote);
  const sourceOfTruthBranch = isPuppyoneSource
    ? null
    : normalizeSettingsText(config?.sync?.sourceOfTruth?.branch)
      ?? normalizeSettingsText(config?.git?.watchedBranch)
      ?? normalizeSettingsText(config?.backup?.branch);

  return {
    version: 3,
    sync: {
      sourceOfTruth: {
        service: sourceOfTruthService,
        remote: sourceOfTruthRemote,
        branch: sourceOfTruthBranch,
      },
    },
    git: {
      primaryRemote: normalizeSettingsText(config?.git?.primaryRemote) ?? sourceOfTruthRemote,
      watchedBranch: isPuppyoneSource ? null : normalizeSettingsText(config?.git?.watchedBranch) ?? sourceOfTruthBranch,
    },
    backup: {
      enabled: config?.backup?.enabled === true,
      service: normalizeBackendServiceDraft(config?.backup?.service ?? sourceOfTruthService, cloudEnabled),
      remote: normalizeSettingsText(config?.backup?.remote) ?? sourceOfTruthRemote,
      branch: normalizeSettingsText(config?.backup?.branch) ?? (isPuppyoneSource ? null : sourceOfTruthBranch),
    },
    ...(config?.updatedAt ? { updatedAt: config.updatedAt } : {}),
  };
}

function samePuppyoneConfig(left: PuppyoneWorkspaceConfig, right: PuppyoneWorkspaceConfig) {
  return left.sync.sourceOfTruth.service === right.sync.sourceOfTruth.service
    && left.sync.sourceOfTruth.remote === right.sync.sourceOfTruth.remote
    && left.sync.sourceOfTruth.branch === right.sync.sourceOfTruth.branch
    && left.git.primaryRemote === right.git.primaryRemote
    && left.git.watchedBranch === right.git.watchedBranch
    && left.backup.enabled === right.backup.enabled
    && left.backup.service === right.backup.service
    && left.backup.remote === right.backup.remote
    && left.backup.branch === right.backup.branch;
}

function normalizeBackendServiceDraft(value: string | null | undefined, cloudEnabled = true): PuppyoneBackendService {
  if (value === "puppyone") return cloudEnabled ? "puppyone" : "github";
  return value === "github" ? value : "github";
}

function inferBackupRemote(
  service: PuppyoneBackendService,
  remotes: GitRemoteSummary[],
  fallback: string | null,
) {
  if (service === "puppyone") {
    return remotes.find((remote) => parsePuppyoneRemote(remote.fetchUrl ?? remote.pushUrl))?.name
      ?? remotes.find((remote) => remote.name.toLowerCase() === "puppyone")?.name
      ?? fallback
      ?? null;
  }

  if (service === "github") {
    return remotes.find((remote) => remoteKindLabel(remote.fetchUrl ?? remote.pushUrl) === "GitHub")?.name
      ?? null;
  }

  return fallback ?? null;
}

function getRemoteNamesForService(service: PuppyoneBackendService, remotes: GitRemoteSummary[]) {
  if (service === "puppyone") {
    return remotes
      .filter((remote) => Boolean(parsePuppyoneRemote(remote.fetchUrl ?? remote.pushUrl)))
      .map((remote) => remote.name);
  }

  if (service === "github") {
    return remotes
      .filter((remote) => remoteKindLabel(remote.fetchUrl ?? remote.pushUrl) === "GitHub")
      .map((remote) => remote.name);
  }

  return remotes.map((remote) => remote.name);
}

function normalizeSettingsText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
