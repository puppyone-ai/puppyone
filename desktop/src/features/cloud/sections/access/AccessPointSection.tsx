import { ExternalLink } from "lucide-react";
import type { DesktopCloudRepoIdentity, DesktopCloudScope } from "../../../../lib/cloudApi";
import { openCloudApp } from "../../../../lib/cloudApi";
import type { getPuppyoneRemote } from "../../../source-control/remotes";
import { CloudSourceDock } from "../../components/shared";
import { CloudScopeDetail } from "./CloudScopeDetail";

export function CloudAccessPointAccessSection({
  scope,
  identity,
  branchName,
  cloudRemote,
}: {
  scope: DesktopCloudScope;
  identity: DesktopCloudRepoIdentity;
  branchName: string;
  cloudRemote: NonNullable<ReturnType<typeof getPuppyoneRemote>>;
}) {
  return (
    <section className="desktop-cloud-access-page">
      <div className="desktop-cloud-access-header">
        <div>
          <span>Access</span>
          <small>1</small>
        </div>
        <button className="desktop-cloud-row-action" type="button" onClick={() => openCloudApp("/projects")}>
          <ExternalLink size={14} />
          <span>Open Cloud</span>
        </button>
      </div>
      <div className="desktop-cloud-access-body">
        <aside className="desktop-cloud-access-sidebar">
          <div className="desktop-cloud-access-scope-list">
            <button className="desktop-cloud-scope-row active" type="button">
              <div>
                <span className="desktop-cloud-web-status-dot ready" aria-hidden="true" />
                <strong>Cloud source</strong>
              </div>
              <div>
                <code>/</code>
                <span className="desktop-cloud-scope-signals">
                  <em title="Access key">CLI</em>
                  <em title="Git remote">Git</em>
                </span>
              </div>
            </button>
          </div>
        </aside>
        <div className="desktop-cloud-access-detail">
          <CloudScopeDetail
            projectId=""
            scope={scope}
            identity={identity}
            connectors={[]}
            mcpEndpoints={[]}
            onOpenAccess={() => openCloudApp("/projects")}
          />
          <CloudSourceDock
            remote={cloudRemote.info.displayId}
            branch={branchName}
            title={cloudRemote.rawUrl}
          />
        </div>
      </div>
    </section>
  );
}
