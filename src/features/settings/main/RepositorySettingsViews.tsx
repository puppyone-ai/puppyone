import { Copy, RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../../types/electron";
import { getPuppyoneRemote, maskRemoteUrl, parsePuppyoneRemote } from "../../source-control";
import { useGitAutoCommitSettings } from "../../source-control/useGitAutoCommitSettings";
import { SettingsSectionHeader, SettingsSubsection, SettingsToggle, SettingsValueRow } from "../components";
import { PuppyoneWorkspaceConfigSettings } from "../PuppyoneWorkspaceConfigSettings";
import { remoteKindLabel, shortCommit } from "../utils";

type RepositorySettingsBaseProps = {
  status: GitStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  copiedRemoteKey: string | null;
  copyError: string | null;
  onCopyRemoteUrl: (key: string, url: string) => Promise<void>;
  onRefresh: () => void;
};

export function CloudHostingSettingsView({
  status,
  loading,
  error,
  copiedRemoteKey,
  copyError,
  puppyoneConfig,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  puppyoneConfigError,
  cloudEnabled,
  onCopyRemoteUrl,
  onPuppyoneConfigChange,
  onRefresh,
}: RepositorySettingsBaseProps & {
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  puppyoneConfigLoading: boolean;
  puppyoneConfigSaving: boolean;
  puppyoneConfigError: string | null;
  cloudEnabled: boolean;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
}) {
  const { t } = useLocalization();
  const remotes = status?.remotes ?? [];
  const puppyoneRemote = getPuppyoneRemote(status);
  const cloudRemote = puppyoneRemote?.remote ?? null;
  const cloudInfo = puppyoneRemote?.info ?? null;
  const cloudRemoteUrl = puppyoneRemote?.rawUrl ?? null;
  const cloudCopyKey = cloudRemoteUrl ? `${cloudRemote?.name}:${cloudRemoteUrl}` : "";
  const usesPuppyoneCloud = cloudEnabled
    && (puppyoneConfig?.sync.sourceOfTruth.service === "puppyone"
      || (puppyoneConfig?.backup.enabled === true && puppyoneConfig.backup.service === "puppyone"));

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsHeading
            title={t("settings.cloud.title")}
            loading={loading}
            onRefresh={onRefresh}
          />
          {error ? (
            <div className="desktop-utility-empty desktop-settings-lead-state danger">{error}</div>
          ) : loading && !status ? (
            <div className="desktop-utility-empty desktop-settings-lead-state">{t("settings.git.reading")}</div>
          ) : status && !status.isRepo ? (
            <div className="desktop-utility-empty desktop-settings-lead-state">{t("settings.git.notRepository")}</div>
          ) : (
            <>
              <PuppyoneWorkspaceConfigSettings
                config={puppyoneConfig}
                remotes={remotes}
                branches={status?.branches ?? []}
                currentBranchName={status?.branch ?? null}
                cloudEnabled={cloudEnabled}
                loading={puppyoneConfigLoading}
                saving={puppyoneConfigSaving}
                error={puppyoneConfigError}
                onChange={onPuppyoneConfigChange}
              />
              {usesPuppyoneCloud && (
                <SettingsSubsection title={t("settings.cloud.connectionTitle")}>
                  <SettingsValueRow
                    label={t("settings.cloud.status")}
                    value={t(cloudInfo ? "settings.cloud.connected" : "settings.shared.notConfigured")}
                    tone={cloudInfo ? "success" : undefined}
                  />
                  {cloudInfo ? (
                    <>
                      <SettingsValueRow label={t("settings.cloud.remote")} value={cloudRemote?.name ?? "puppyone"} />
                      <SettingsValueRow label={t("settings.cloud.host")} value={cloudInfo.host} />
                      <SettingsValueRow
                        label={cloudInfo.kind === "access-point"
                          ? t("settings.cloud.accessKey")
                          : cloudInfo.kind === "scope"
                            ? t("settings.cloud.projectScope")
                            : t("settings.cloud.project")}
                        value={cloudInfo.displayId}
                        monospace
                      />
                      <SettingsValueRow
                        label={t("settings.cloud.connectionUrl")}
                        value={cloudRemoteUrl ? maskRemoteUrl(cloudRemoteUrl) : t("settings.shared.notConfigured")}
                        title={cloudRemoteUrl ?? undefined}
                        monospace
                        action={cloudRemoteUrl ? (
                          <CopyAction
                            copied={copiedRemoteKey === cloudCopyKey}
                            onClick={() => void onCopyRemoteUrl(cloudCopyKey, cloudRemoteUrl)}
                          />
                        ) : undefined}
                      />
                    </>
                  ) : (
                    <div className="desktop-settings-muted-row">{t("settings.shared.notConfigured")}</div>
                  )}
                </SettingsSubsection>
              )}
              {copyError && <div className="desktop-utility-empty danger">{copyError}</div>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function GitSettingsView({
  workspaceRoot,
  experimentalOptIn,
  status,
  loading,
  error,
  copiedRemoteKey,
  copyError,
  onCopyRemoteUrl,
  onRefresh,
}: RepositorySettingsBaseProps & {
  workspaceRoot: string;
  experimentalOptIn: boolean;
}) {
  const { t } = useLocalization();
  const autoCommit = useGitAutoCommitSettings(workspaceRoot, experimentalOptIn);
  const autoCommitPolicy = autoCommit.snapshot?.workspacePolicy ?? null;
  const autoCommitRuntime = autoCommit.snapshot?.runtime ?? null;
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const remotes = status?.remotes ?? [];
  const localBranchCount = status?.branches.filter((branch) => !branch.remote).length ?? 0;
  const remoteBranchCount = status?.branches.filter((branch) => branch.remote).length ?? 0;

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsHeading
            title={t("settings.git.title")}
            loading={loading}
            onRefresh={onRefresh}
          />
          {error ? (
            <div className="desktop-utility-empty desktop-settings-lead-state danger">{error}</div>
          ) : loading && !status ? (
            <div className="desktop-utility-empty desktop-settings-lead-state">{t("settings.git.reading")}</div>
          ) : status && !status.isRepo ? (
            <div className="desktop-utility-empty desktop-settings-lead-state">{t("settings.git.notRepository")}</div>
          ) : (
            <>
              <SettingsSubsection title={t("settings.git.repository")} leading>
                <SettingsValueRow label={t("settings.git.branch")} value={status?.branch ?? t("settings.git.detached")} />
                <SettingsValueRow
                  label={t("settings.git.branches")}
                  value={t("settings.git.branchCounts", { localCount: localBranchCount, remoteCount: remoteBranchCount })}
                />
                <SettingsValueRow label={t("settings.git.upstream")} value={currentBranch?.upstream ?? t("settings.shared.notConfigured")} />
                <SettingsValueRow
                  label={t("settings.git.syncStatus")}
                  value={currentBranch?.upstream
                    ? t("settings.git.syncCounts", { ahead: currentBranch.ahead, behind: currentBranch.behind })
                    : t("settings.git.localOnly")}
                />
                <SettingsValueRow label="HEAD" value={status?.headCommitId ? shortCommit(status.headCommitId) : t("settings.git.noCommits")} monospace />
              </SettingsSubsection>
              {autoCommit.available && experimentalOptIn && (
                <SettingsSubsection title={t("settings.git.autoCommit.title")}>
                  <div className="desktop-settings-muted-row">
                    {t("settings.git.autoCommit.localOnly")}
                  </div>
                  <div className="desktop-settings-row desktop-settings-row-control">
                    <span title={t("settings.git.autoCommit.enabled.detail")}>
                      {t("settings.git.autoCommit.enabled.title")}
                    </span>
                    <SettingsToggle
                      label={t("settings.git.autoCommit.enabled.title")}
                      description={t("settings.git.autoCommit.enabled.detail")}
                      checked={autoCommitPolicy?.enabled === true}
                      disabled={autoCommit.saving || !autoCommit.snapshot?.repository}
                      onChange={(enabled) => {
                        if (enabled && !window.confirm(t("settings.git.autoCommit.confirm"))) return;
                        void autoCommit.update({ enabled });
                      }}
                    />
                  </div>
                  <label className="desktop-settings-row desktop-settings-row-control">
                    <span>{t("settings.git.autoCommit.interval")}</span>
                    <select
                      className="desktop-settings-select"
                      value={autoCommitPolicy?.minimumIntervalMs ?? 300_000}
                      disabled={autoCommit.saving || autoCommitPolicy?.enabled !== true}
                      onChange={(event) => void autoCommit.update({
                        minimumIntervalMs: Number(event.target.value),
                      })}
                    >
                      {[5, 15, 30, 60].map((minutes) => (
                        <option value={minutes * 60_000} key={minutes}>
                          {t("settings.git.autoCommit.minutes", { count: minutes })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SettingsValueRow
                    label={t("settings.git.autoCommit.status")}
                    value={t(`settings.git.autoCommit.state.${autoCommitRuntime?.state ?? "disabled"}`)}
                  />
                  {autoCommitRuntime?.nextEligibleAt && (
                    <SettingsValueRow
                      label={t("settings.git.autoCommit.nextRun")}
                      value={new Date(autoCommitRuntime.nextEligibleAt).toLocaleString()}
                    />
                  )}
                  {autoCommitRuntime?.lastResult && (
                    <>
                      <SettingsValueRow
                        label={t("settings.git.autoCommit.lastResult")}
                        value={t(`settings.git.autoCommit.outcome.${autoCommitRuntime.lastResult.outcome}`)}
                      />
                      <SettingsValueRow
                        label={t("settings.git.autoCommit.reason")}
                        value={autoCommitRuntime.lastResult.reason}
                        monospace
                      />
                      {autoCommitRuntime.lastResult.commitId && (
                        <SettingsValueRow
                          label={t("settings.git.autoCommit.commit")}
                          value={shortCommit(autoCommitRuntime.lastResult.commitId)}
                          monospace
                        />
                      )}
                    </>
                  )}
                  {autoCommit.error && <div className="desktop-utility-empty danger">{autoCommit.error}</div>}
                </SettingsSubsection>
              )}
              <SettingsSubsection title={t("settings.git.remotes")}>
                {remotes.length === 0 ? (
                  <div className="desktop-settings-muted-row">{t("settings.git.noRemotes")}</div>
                ) : remotes.map((remote) => {
                  const copyUrl = remote.fetchUrl ?? remote.pushUrl;
                  const copyKey = `${remote.name}:${copyUrl ?? ""}`;
                  const remoteInfo = parsePuppyoneRemote(copyUrl);
                  const pushUrlDiffers = Boolean(remote.fetchUrl && remote.pushUrl && remote.fetchUrl !== remote.pushUrl);
                  return (
                    <div className="desktop-settings-remote-setting" key={remote.name}>
                      <div className="desktop-settings-remote-setting-main">
                        <span className="desktop-settings-remote-setting-name" dir="auto">{remote.name}</span>
                        <span className={`desktop-settings-badge ${remoteInfo ? "connected" : ""}`}>
                          {remoteInfo ? "puppyone" : remoteKindLabel(copyUrl)}
                        </span>
                      </div>
                      <div className="desktop-settings-remote-setting-meta">
                        <span>{t("settings.git.remoteBranchCount", { count: remote.branches.length })}</span>
                      </div>
                      <div className="desktop-settings-remote-setting-url">
                        <code dir="ltr" title={copyUrl ?? ""}>{copyUrl ? maskRemoteUrl(copyUrl) : t("settings.shared.notConfigured")}</code>
                        {pushUrlDiffers && remote.pushUrl && <small title={remote.pushUrl}>{t("settings.git.pushUrlDiffers")}</small>}
                      </div>
                      <CopyAction
                        copied={copiedRemoteKey === copyKey}
                        disabled={!copyUrl}
                        onClick={() => copyUrl ? void onCopyRemoteUrl(copyKey, copyUrl) : undefined}
                      />
                    </div>
                  );
                })}
              </SettingsSubsection>
              {copyError && <div className="desktop-utility-empty danger">{copyError}</div>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsHeading({
  title,
  loading,
  onRefresh,
}: {
  title: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-settings-heading-row">
      <SettingsSectionHeader title={title} />
      <button className="desktop-settings-action" type="button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} className={loading ? "spin" : undefined} />
        <span>{t("common.action.refresh")}</span>
      </button>
    </div>
  );
}

function CopyAction({
  copied,
  disabled = false,
  onClick,
}: {
  copied: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useLocalization();
  return (
    <button className="desktop-settings-row-action" type="button" disabled={disabled} onClick={onClick}>
      <Copy size={13} />
      <span>{t(copied ? "common.action.copied" : "common.action.copy")}</span>
    </button>
  );
}
