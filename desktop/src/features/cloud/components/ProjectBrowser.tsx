import { Cloud, ExternalLink, Server, SquareTerminal, Users } from "lucide-react";
import type {
  DesktopCloudProject,
  DesktopCloudSession,
} from "../../../lib/cloudApi";
import { openCloudApp } from "../../../lib/cloudApi";
import {
  ProjectFolderCard,
  ProjectFolderCardSkeleton,
  ProjectFolderNewCard,
  type ProjectFolderPreviewItem,
} from "../../../components/project-folder-card";
import { formatRelativeTime } from "../utils";
import { CloudFilePreviewIcon } from "./shared";
import { useCloudProjectPreview } from "../hooks/useCloudProjectPreview";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import { CloudAuthCard, CloudLoginFeatureRow, CloudProductMark } from "../CloudServicePanel";
import type { CloudLoginFeature } from "../model";

const PROJECT_CARD_SKELETON_COUNT = 3;

export function CloudProjectBrowser({
  projects,
  loading,
  session,
  apiBaseUrl,
  mappedProjectId,
  backupLoading,
  onSessionChange,
  onBackupWorkspace,
  onSelectProject,
  onOpenCloudProjects,
}: {
  projects: DesktopCloudProject[];
  loading: boolean;
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  mappedProjectId: string | null;
  backupLoading: boolean;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onBackupWorkspace: () => void;
  onSelectProject: (project: DesktopCloudProject) => void;
  onOpenCloudProjects: () => void;
}) {
  const sortedProjects = [...projects].sort((left, right) => {
    if (left.id === mappedProjectId) return -1;
    if (right.id === mappedProjectId) return 1;
    const leftTime = left.updated_at ? new Date(left.updated_at).getTime() : 0;
    const rightTime = right.updated_at ? new Date(right.updated_at).getTime() : 0;
    return rightTime - leftTime || left.name.localeCompare(right.name);
  });
  const showBackupCard = !mappedProjectId;

  return (
    <section className="desktop-cloud-project-browser" aria-label="Cloud projects">
      <div className="desktop-cloud-project-browser-header">
        <div>
          <h1>Cloud Projects</h1>
        </div>
        <button className="desktop-cloud-project-browser-link" type="button" onClick={onOpenCloudProjects}>
          <ExternalLink size={14} />
          <span>Open Cloud</span>
        </button>
      </div>

      <div className="desktop-cloud-project-grid" aria-busy={loading || backupLoading || undefined}>
        {loading && projects.length === 0 ? (
          Array.from({ length: PROJECT_CARD_SKELETON_COUNT }).map((_, index) => (
            <ProjectFolderCardSkeleton key={index} />
          ))
        ) : (
          sortedProjects.map((project) => (
            <CloudProjectCard
              key={project.id}
              project={project}
              session={session}
              apiBaseUrl={apiBaseUrl}
              mapped={project.id === mappedProjectId}
              onSessionChange={onSessionChange}
              onSelectProject={onSelectProject}
            />
          ))
        )}

        {showBackupCard && (
          <CloudProjectNewCard
            loading={backupLoading}
            onClick={onBackupWorkspace}
          />
        )}
      </div>
    </section>
  );
}

export function CloudProjectBrowserSignedOut({
  apiBaseUrl,
  accountEmail,
  onSignedIn,
  onRefresh,
}: {
  apiBaseUrl: string | null;
  accountEmail: string | null;
  onSignedIn: (session: DesktopCloudSession) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const auth = useCloudAuthController({
    cloudApiBaseUrl: apiBaseUrl,
    accountEmail,
    onSignedIn,
    onRefresh,
  });
  const cloudFeatures: CloudLoginFeature[] = [
    {
      label: "Team collaboration",
      icon: Users,
    },
    {
      label: "Cloud backup",
      icon: Cloud,
    },
    {
      label: "MCP / CLI supported",
      icon: SquareTerminal,
    },
    {
      label: "24/7 online",
      icon: Server,
    },
  ];

  return (
    <section className="desktop-cloud-project-auth-stage" aria-label="Sign in to PuppyOne Cloud">
      <section className="desktop-cloud-panel locked desktop-cloud-project-auth-panel" aria-label="PuppyOne Cloud sign in">
        <div className="desktop-cloud-panel-body">
          <section className="desktop-cloud-login-layout">
            <div className="desktop-cloud-login-copy">
              <div className="desktop-cloud-login-copy-content">
                <div className="desktop-cloud-login-identity">
                  <div className="desktop-cloud-login-logo" aria-hidden="true">
                    <CloudProductMark />
                  </div>
                  <div className="desktop-cloud-login-copy-stack">
                    <h3>Get Puppyone Cloud</h3>
                    <p>Back up this workspace. Keep agents, teammates, MCP, and CLI connected.</p>
                  </div>
                </div>
                <div className="desktop-cloud-login-feature-list">
                  {cloudFeatures.map((feature) => (
                    <CloudLoginFeatureRow key={feature.label} feature={feature} />
                  ))}
                </div>
              </div>
            </div>
            <aside className="desktop-cloud-login-card">
              <CloudAuthCard
                view={auth.signedInEmail ? "signedIn" : auth.view}
                email={auth.email}
                password={auth.password}
                signedInEmail={auth.signedInEmail}
                loading={auth.loading}
                error={auth.error}
                message={auth.message}
                onEmailChange={auth.setEmail}
                onPasswordChange={auth.setPassword}
                onProviderLogin={auth.startProviderLogin}
                onEmailSubmit={auth.handleEmailSubmit}
                onPasswordSubmit={auth.handlePasswordSubmit}
                onSignupContinue={auth.handleSignupContinue}
                onOpenCloud={() => openCloudApp("/projects")}
                onRefresh={onRefresh}
                onBack={auth.handleBack}
              />
            </aside>
          </section>
        </div>
      </section>
    </section>
  );
}

function CloudProjectCard({
  project,
  session,
  apiBaseUrl,
  mapped,
  onSessionChange,
  onSelectProject,
}: {
  project: DesktopCloudProject;
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  mapped: boolean;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onSelectProject: (project: DesktopCloudProject) => void;
}) {
  const preview = useCloudProjectPreview({
    session,
    projectId: project.id,
    apiBaseUrl,
    onSessionChange,
  });
  const connectionCount = project.access_point_count ?? 0;
  const updatedLabel = project.updated_at ? formatRelativeTime(project.updated_at) : "";
  const previewItems: ProjectFolderPreviewItem[] = preview.entries.map((entry) => ({
    id: entry.path || entry.name,
    name: entry.name || entry.path,
    icon: (
      <CloudFilePreviewIcon
        name={entry.name || entry.path}
        type={entry.type}
        size={28}
        childrenCount={entry.children_count ?? undefined}
      />
    ),
  }));

  return (
    <ProjectFolderCard
      title={project.name}
      badge={mapped ? "Linked" : null}
      previewItems={previewItems}
      previewLoading={preview.loading}
      previewError={preview.error}
      emptyLabel={project.description || "Empty project"}
      footer={{
        statusConnected: connectionCount > 0,
        updatedLabel: updatedLabel || "Recently updated",
        connectionCount,
      }}
      onSelect={() => onSelectProject(project)}
    />
  );
}

function CloudProjectNewCard({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <ProjectFolderNewCard
      label={loading ? "Connecting..." : "Back up current folder"}
      loading={loading}
      onClick={onClick}
    />
  );
}
