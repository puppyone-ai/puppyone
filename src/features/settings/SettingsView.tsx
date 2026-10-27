import { useDesktopPreference } from "../../preferencesStore";
import { AppearanceSettingsView } from "./main/AppearanceSettingsView";
import { lazy, Suspense, useState } from "react";
import { LocalAgentsSettingsView } from "../local-agents";
import { ModelConnectionsSettings } from "../model-connections";
import { AccountSettingsView } from "./main/AccountSettingsView";
import { SeatsSettingsView } from "./main/SeatsSettingsView";
import { ExperimentalSettingsView } from "./main/ExperimentalSettingsView";
import { FilesSettingsView } from "./main/FileSettingsViews";
import { GeneralSettingsView } from "./main/GeneralSettingsView";
import { LocalProjectSettingsView } from "./main/LocalProjectSettingsView";
import { PrivacySettingsView } from "./main/PrivacySettingsView";
import { CreateNewSettingsView } from "./main/CreateNewSettingsView";
import { OtherAppImportsSettingsView } from "./main/OtherAppImportsSettingsView";
import { CloudHostingSettingsView, GitSettingsView } from "./main/RepositorySettingsViews";
import { usePaymentsExperience } from "../payments";
import { useAccountAvailable } from "../flags";
import { isSettingsSectionAvailable } from "./sidebar/settingsSidebarModel";
import type { SettingsViewProps } from "./types";
import { writeClipboardText } from "./utils";

const TypographySettingsView = lazy(async () => {
  const module = await import("./main/TypographySettingsView");
  return { default: module.TypographySettingsView };
});

/** Plan sells storage and the Cloud Computer, so Account links to it only with Cloud on. */
function resolvePlanOpener({ paymentsEnabled, cloudEnabled, onSelectSection }: {
  paymentsEnabled: boolean;
  cloudEnabled: boolean;
  onSelectSection: SettingsViewProps["onSelectSection"];
}): (() => void) | undefined {
  if (!paymentsEnabled || !cloudEnabled) return undefined;
  return () => onSelectSection("seats");
}

export function SettingsView({
  workspace,
  activeSection,
  onSelectSection,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  subThemeCatalog,
  cloudEnabled,
  cloudSession,
  cloudSessionRestoring,
  cloudApiBaseUrl,
  puppyoneConfig,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  puppyoneConfigError,
  updateState,
  onFilesVisibilityChange,
  onOpenImport,
  onCloudSessionChange,
  onPuppyoneConfigChange,
  onUnlinkWorkspace,
  onRefreshGitStatus,
  onCheckForUpdates,
  onUpdateNow,
  automaticDownloadPreferenceAvailable,
  automaticDownloadPreferenceSaving,
  automaticDownloadPreferenceError,
  onAutomaticallyDownloadUpdatesChange,
}: SettingsViewProps) {
  const [copiedRemoteKey, setCopiedRemoteKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const otherAppImportsEnabled = useDesktopPreference(s => activeSection === "other-app-imports" && s.experimentalSettings.enableOtherAppImports);
  // Settings is a render entry: it reads the payments experiment once and
  // hands the answer down, so no payment surface reads the flag itself.
  const paymentsEnabled = usePaymentsExperience();
  const accountAvailable = useAccountAvailable();

  if (!isSettingsSectionAvailable(activeSection, {
    cloudEnabled,
    accountAvailable,
    otherAppImportsEnabled,
    localWorkspaceAvailable: workspace !== null,
  })) {
    return (
      <GeneralSettingsView
        updateState={updateState}
        onCheckForUpdates={onCheckForUpdates}
        onUpdateNow={onUpdateNow}
        automaticDownloadPreferenceAvailable={automaticDownloadPreferenceAvailable}
        automaticDownloadPreferenceSaving={automaticDownloadPreferenceSaving}
        automaticDownloadPreferenceError={automaticDownloadPreferenceError}
        onAutomaticallyDownloadUpdatesChange={onAutomaticallyDownloadUpdatesChange}
      />
    );
  }

  if (activeSection === "general") {
    return (
      <GeneralSettingsView
        updateState={updateState}
        onCheckForUpdates={onCheckForUpdates}
        onUpdateNow={onUpdateNow}
        automaticDownloadPreferenceAvailable={automaticDownloadPreferenceAvailable}
        automaticDownloadPreferenceSaving={automaticDownloadPreferenceSaving}
        automaticDownloadPreferenceError={automaticDownloadPreferenceError}
        onAutomaticallyDownloadUpdatesChange={onAutomaticallyDownloadUpdatesChange}
      />
    );
  }

  if (activeSection === "privacy") {
    return <PrivacySettingsView />;
  }
  if (activeSection === "model-connections") return <ModelConnectionsSettings />;

  if (activeSection === "local-agents") {
    return (
      <LocalAgentsSettingsView />
    );
  }

  if (activeSection === "local-project") {
    if (!workspace) return null;
    return (
      <LocalProjectSettingsView
        workspace={workspace}
        onUnlinkWorkspace={onUnlinkWorkspace}
      />
    );
  }

  if (activeSection === "account") {
    return (
      <AccountSettingsView
        cloudSession={cloudSession}
        cloudSessionRestoring={cloudSessionRestoring}
        cloudApiBaseUrl={cloudApiBaseUrl}
        onCloudSessionChange={onCloudSessionChange}
        cloudEnabled={cloudEnabled}
        onOpenBilling={resolvePlanOpener({ paymentsEnabled, cloudEnabled, onSelectSection })}
      />
    );
  }

  if (activeSection === "seats") {
    return (
      <SeatsSettingsView
        cloudSession={cloudSession}
        cloudApiBaseUrl={cloudApiBaseUrl}
        onCloudSessionChange={onCloudSessionChange}
        // Buying needs an account, and Account owns the one sign-in flow.
        onSignIn={() => onSelectSection("account")}
      />
    );
  }

  const copyRemoteUrl = async (key: string, url: string) => {
    setCopyError(null);
    try {
      await writeClipboardText(url);
      setCopiedRemoteKey(key);
      window.setTimeout(() => setCopiedRemoteKey((current) => current === key ? null : current), 1500);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
    }
  };

  if (activeSection === "git") {
    if (!workspace) return null;
    return (
      <GitSettingsView
        workspaceRoot={workspace.path}
        status={gitStatus}
        loading={gitStatusLoading}
        error={gitStatusError}
        copiedRemoteKey={copiedRemoteKey}
        copyError={copyError}
        onCopyRemoteUrl={copyRemoteUrl}
        onRefresh={onRefreshGitStatus}
      />
    );
  }

  if (activeSection === "cloud") {
    return (
      <CloudHostingSettingsView
        status={gitStatus}
        loading={gitStatusLoading}
        error={gitStatusError}
        copiedRemoteKey={copiedRemoteKey}
        copyError={copyError}
        puppyoneConfig={puppyoneConfig}
        puppyoneConfigLoading={puppyoneConfigLoading}
        puppyoneConfigSaving={puppyoneConfigSaving}
        puppyoneConfigError={puppyoneConfigError}
        cloudEnabled={cloudEnabled}
        onCopyRemoteUrl={copyRemoteUrl}
        onPuppyoneConfigChange={onPuppyoneConfigChange}
        onRefresh={onRefreshGitStatus}
      />
    );
  }

  if (activeSection === "files") {
    return (
      <FilesSettingsView
        onFilesVisibilityChange={onFilesVisibilityChange}
      />
    );
  }

  if (activeSection === "new-menu") {
    return (
      <CreateNewSettingsView />
    );
  }

  if (activeSection === "experimental") {
    return (
      <ExperimentalSettingsView />
    );
  }

  if (activeSection === "other-app-imports") {
    return <OtherAppImportsSettingsView onOpenImport={onOpenImport} />;
  }

  if (activeSection === "typography") {
    return (
      <Suspense fallback={null}>
        <TypographySettingsView />
      </Suspense>
    );
  }

  if (activeSection === "appearance") {
    return <AppearanceSettingsView subThemeCatalog={subThemeCatalog} />;
  }

  return assertUnreachableSettingsSection(activeSection);
}

function assertUnreachableSettingsSection(section: never): never {
  throw new Error(`Unsupported Settings section: ${String(section)}`);
}
