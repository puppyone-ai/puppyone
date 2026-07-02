import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { GitRemoteSummary, GitStatusSnapshot, PuppyoneBackendService, PuppyoneWorkspaceConfig } from "../../types/electron";
import { parsePuppyoneRemote } from "../source-control/remotes";
import { SettingsGroup } from "./components";
import { remoteKindLabel } from "./utils";

export function PuppyoneWorkspaceConfigSettings({
  config,
  remotes,
  branches,
  currentBranchName,
  loading,
  saving,
  error,
  onChange,
}: {
  config: PuppyoneWorkspaceConfig | null;
  remotes: GitRemoteSummary[];
  branches: GitStatusSnapshot["branches"];
  currentBranchName: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
}) {
  const [draft, setDraft] = useState<PuppyoneWorkspaceConfig>(() => normalizePuppyoneConfigDraft(config));
  const [localError, setLocalError] = useState<string | null>(null);
  const remoteNames = remotes.map((remote) => remote.name);
  const branchNames = branches
    .filter((branch) => !branch.remote)
    .map((branch) => branch.name);
  const watchedBranchListId = "desktop-puppyone-watched-branch-options";
  const backupBranchListId = "desktop-puppyone-backup-branch-options";
  const normalizedDraft = normalizePuppyoneConfigDraft(draft);
  const savedConfig = normalizePuppyoneConfigDraft(config);
  const dirty = !samePuppyoneConfig(normalizedDraft, savedConfig);

  useEffect(() => {
    setDraft(normalizePuppyoneConfigDraft(config));
    setLocalError(null);
  }, [config]);

  const updateSourceOfTruthConfig = (nextSourceOfTruth: Partial<PuppyoneWorkspaceConfig["sync"]["sourceOfTruth"]>) => {
    setDraft((current) => {
      const normalized = normalizePuppyoneConfigDraft(current);
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
      const normalized = normalizePuppyoneConfigDraft(current);
      return {
        ...normalized,
        backup: {
          ...normalized.backup,
          ...nextBackup,
        },
      };
    });
  };

  const updateCloudConfig = (nextCloud: Partial<PuppyoneWorkspaceConfig["cloud"]>) => {
    setDraft((current) => {
      const normalized = normalizePuppyoneConfigDraft(current);
      return {
        ...normalized,
        cloud: {
          ...normalized.cloud,
          ...nextCloud,
        },
      };
    });
  };

  const saveConfig = async () => {
    setLocalError(null);
    try {
      const saved = await onChange(normalizedDraft);
      if (saved) setDraft(normalizePuppyoneConfigDraft(saved));
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  return (
    <SettingsGroup title="Sync & Backup">
      <div className="desktop-puppyone-config-note">
        <span>.puppyone/config.json</span>
        <small>Stores workspace-level sync and backup metadata. Editor preferences stay local to this device.</small>
      </div>

      {loading && !config ? (
        <div className="desktop-settings-muted-row">Reading PuppyOne config...</div>
      ) : (
        <>
          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Source service</strong>
              <small>The service PuppyOne should treat as the main sync authority.</small>
            </span>
            <select
              className="desktop-settings-select"
              value={normalizedDraft.sync.sourceOfTruth.service}
              disabled={saving}
              onChange={(event) => {
                const service = normalizeBackendServiceDraft(event.target.value);
                updateSourceOfTruthConfig({
                  service,
                  remote: inferBackupRemote(service, remotes, normalizedDraft.sync.sourceOfTruth.remote),
                });
              }}
            >
              <option value="puppyone">PuppyOne Cloud</option>
              <option value="github">GitHub</option>
              <option value="custom">Custom remote</option>
            </select>
          </label>

          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Source remote</strong>
              <small>Which Git remote PuppyOne should prefer when showing sync state.</small>
            </span>
            <select
              className="desktop-settings-select"
              value={normalizedDraft.sync.sourceOfTruth.remote ?? ""}
              disabled={saving}
              onChange={(event) => updateSourceOfTruthConfig({ remote: normalizeSettingsText(event.target.value) })}
            >
              <option value="">Auto</option>
              {remoteNames.map((remoteName) => (
                <option value={remoteName} key={remoteName}>{remoteName}</option>
              ))}
            </select>
          </label>

          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Watched branch</strong>
              <small>Leave empty to follow the current branch.</small>
            </span>
            <input
              className="desktop-settings-text-input"
              list={watchedBranchListId}
              value={normalizedDraft.sync.sourceOfTruth.branch ?? ""}
              placeholder={currentBranchName && currentBranchName !== "detached" ? currentBranchName : "current branch"}
              disabled={saving}
              onChange={(event) => updateSourceOfTruthConfig({ branch: normalizeSettingsText(event.target.value) })}
            />
            <datalist id={watchedBranchListId}>
              {branchNames.map((branchName) => (
                <option value={branchName} key={branchName} />
              ))}
            </datalist>
          </label>

          <div className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Backup enabled</strong>
              <small>Marks this workspace as covered by the selected backup service.</small>
            </span>
            <label className="desktop-settings-switch">
              <input
                type="checkbox"
                checked={normalizedDraft.backup.enabled}
                disabled={saving}
                onChange={(event) => updateBackupConfig({ enabled: event.target.checked })}
              />
              <span aria-hidden="true" />
            </label>
          </div>

          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Backup service</strong>
              <small>Choose the service PuppyOne should treat as the backup target.</small>
            </span>
            <select
              className="desktop-settings-select"
              value={normalizedDraft.backup.service}
              disabled={saving}
              onChange={(event) => {
                const service = normalizeBackendServiceDraft(event.target.value);
                updateBackupConfig({
                  service,
                  remote: inferBackupRemote(service, remotes, normalizedDraft.backup.remote),
                });
              }}
            >
              <option value="puppyone">PuppyOne Cloud</option>
              <option value="github">GitHub</option>
              <option value="custom">Custom remote</option>
            </select>
          </label>

          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Backup remote</strong>
              <small>Leave empty to let PuppyOne choose from configured Git remotes.</small>
            </span>
            <select
              className="desktop-settings-select"
              value={normalizedDraft.backup.remote ?? ""}
              disabled={saving}
              onChange={(event) => updateBackupConfig({ remote: normalizeSettingsText(event.target.value) })}
            >
              <option value="">Auto</option>
              {remoteNames.map((remoteName) => (
                <option value={remoteName} key={remoteName}>{remoteName}</option>
              ))}
            </select>
          </label>

          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Backup branch</strong>
              <small>Leave empty to use the current branch.</small>
            </span>
            <input
              className="desktop-settings-text-input"
              list={backupBranchListId}
              value={normalizedDraft.backup.branch ?? ""}
              placeholder={currentBranchName && currentBranchName !== "detached" ? currentBranchName : "current branch"}
              disabled={saving}
              onChange={(event) => updateBackupConfig({ branch: normalizeSettingsText(event.target.value) })}
            />
            <datalist id={backupBranchListId}>
              {branchNames.map((branchName) => (
                <option value={branchName} key={branchName} />
              ))}
            </datalist>
          </label>

          <label className="desktop-settings-row desktop-settings-row-control desktop-puppyone-config-row">
            <span className="desktop-settings-label-stack">
              <strong>Cloud project id</strong>
              <small>Non-secret project identifier for PuppyOne Cloud.</small>
            </span>
            <input
              className="desktop-settings-text-input"
              value={normalizedDraft.cloud.projectId ?? ""}
              placeholder="Not set"
              disabled={saving}
              onChange={(event) => updateCloudConfig({ projectId: normalizeSettingsText(event.target.value) })}
            />
          </label>

          <div className="desktop-puppyone-config-footer">
            <span>{error ?? localError ?? (dirty ? "Unsaved changes" : "Config is up to date")}</span>
            <div>
              <button
                className="desktop-settings-row-action"
                type="button"
                disabled={!dirty || saving}
                onClick={() => setDraft(savedConfig)}
              >
                <RefreshCw size={13} />
                <span>Reset</span>
              </button>
              <button
                className="desktop-settings-row-action"
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveConfig()}
              >
                <Check size={13} />
                <span>{saving ? "Saving" : "Save"}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </SettingsGroup>
  );
}

function normalizePuppyoneConfigDraft(config: PuppyoneWorkspaceConfig | null): PuppyoneWorkspaceConfig {
  const sourceOfTruthService = normalizeBackendServiceDraft(config?.sync?.sourceOfTruth?.service ?? config?.backup?.service);
  const sourceOfTruthRemote =
    normalizeSettingsText(config?.sync?.sourceOfTruth?.remote)
    ?? normalizeSettingsText(config?.git?.primaryRemote)
    ?? normalizeSettingsText(config?.backup?.remote);
  const sourceOfTruthBranch =
    normalizeSettingsText(config?.sync?.sourceOfTruth?.branch)
    ?? normalizeSettingsText(config?.git?.watchedBranch)
    ?? normalizeSettingsText(config?.backup?.branch);

  return {
    version: 1,
    sync: {
      sourceOfTruth: {
        service: sourceOfTruthService,
        remote: sourceOfTruthRemote,
        branch: sourceOfTruthBranch,
      },
    },
    git: {
      primaryRemote: normalizeSettingsText(config?.git?.primaryRemote) ?? sourceOfTruthRemote,
      watchedBranch: normalizeSettingsText(config?.git?.watchedBranch) ?? sourceOfTruthBranch,
    },
    backup: {
      enabled: config?.backup?.enabled === true,
      service: normalizeBackendServiceDraft(config?.backup?.service ?? sourceOfTruthService),
      remote: normalizeSettingsText(config?.backup?.remote) ?? sourceOfTruthRemote,
      branch: normalizeSettingsText(config?.backup?.branch) ?? sourceOfTruthBranch,
    },
    cloud: {
      projectId: normalizeSettingsText(config?.cloud?.projectId),
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
    && left.backup.branch === right.backup.branch
    && left.cloud.projectId === right.cloud.projectId;
}

function normalizeBackendServiceDraft(value: string | null | undefined): PuppyoneBackendService {
  return value === "github" || value === "custom" || value === "puppyone" ? value : "puppyone";
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
      ?? remotes.find((remote) => remote.name === "origin")?.name
      ?? fallback
      ?? null;
  }

  return fallback ?? null;
}

function normalizeSettingsText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
