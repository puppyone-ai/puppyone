import { useEffect, useState } from "react";
import { Cloud, RefreshCw, Search } from "lucide-react";
import { flushActiveDocumentSessions } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import { getCloudAuthSession, type CloudAuthState } from "../auth";
import { CloudWorkspaceLoadingState } from "../components/shared";
import type { AccountCloudWorkspace } from "./useAccountCloudWorkspace";
import "./account-cloud-workspace.css";

export function AccountCloudProjectPicker({ controller, authState, apiBaseUrl, onPublishLocal, onSignOut }: {
  controller: AccountCloudWorkspace;
  authState: CloudAuthState;
  apiBaseUrl: string;
  onPublishLocal?: () => void;
  onSignOut: () => void;
}) {
  const { t } = useLocalization();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [signOutFailed, setSignOutFailed] = useState(false);
  const session = getCloudAuthSession(authState);
  useEffect(() => {
    setQuery(""); setName(""); setOrganization(""); setSignOutFailed(false);
  }, [apiBaseUrl, session?.user_id, session?.session_generation]);
  if (!controller.pickerOpen) return null;
  const projects = controller.projects.filter((project) => `${project.name} ${project.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const organizations = new Map(controller.organizations.map((org) => [org.id, org.name]));
  return <DesktopOverlayLayer>
    <DesktopDialogRoot onClose={controller.cancel}>
      <DesktopDialogSurface className="desktop-cloud-account-picker" width={session ? "min(640px, calc(100vw - 48px))" : 440}
        ariaLabel={t(session ? "cloud.catalog.title" : "cloud.auth.desktopTitle")}>
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row"><Cloud size={16} /><h2>{t("cloud.catalog.title")}</h2></div>
          <DesktopDialogCloseButton label={t("common.action.close")} onClick={controller.cancel} />
        </header>
        {!session ? <CloudSignedOutRoute compact activeSection="contents" authState={authState} apiBaseUrl={apiBaseUrl}
          loadingLabel={t("cloud.loading.session")} /> : <div className="desktop-cloud-account-content" data-po-scrollbar="content">
          <div className="desktop-cloud-account-toolbar">
            <span><bdi>{session.user_email}</bdi><small>{new URL(apiBaseUrl).host}</small></span>
            <button type="button" className="desktop-cloud-row-action" onClick={async () => {
              setSignOutFailed(false);
              try { await flushActiveDocumentSessions("workspace-switch"); onSignOut(); }
              catch { setSignOutFailed(true); }
            }}>{t("cloud.catalog.signOut")}</button>
          </div>
          <p>{t("cloud.catalog.description")}</p>
          <label className="desktop-cloud-account-search"><Search size={15} />
            <input aria-label={t("cloud.catalog.search")} placeholder={t("cloud.catalog.search")}
              value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {signOutFailed && <p role="alert">{t("cloud.catalog.saveBeforeSignOut")}</p>}
          {controller.error && <div role="alert" className="desktop-cloud-account-error">
            <p>{t(controller.error === "list" ? "cloud.catalog.loadFailed"
              : controller.error === "create" ? "cloud.catalog.createFailed" : "cloud.catalog.openFailed")}</p>
            <button className="desktop-cloud-row-action" type="button" onClick={() => void controller.retry()}>
              <RefreshCw size={13} />{t("cloud.common.retry")}
            </button>
          </div>}
          {controller.opening && <CloudWorkspaceLoadingState label={t("cloud.loading.project")} />}
          {controller.loading && controller.projects.length === 0
            ? <CloudWorkspaceLoadingState label={t("cloud.loading.project")} />
            : <div className="desktop-cloud-account-projects" aria-label={t("cloud.catalog.title")}>
              {projects.map((project) => <button type="button" key={project.id} className="desktop-cloud-account-project"
                disabled={controller.opening} onClick={() => void controller.openTarget({ kind: "project_root", project_id: project.id })}>
                <Cloud size={16} /><span><strong><bdi>{project.name}</bdi></strong>
                  <small><bdi>{organizations.get(project.org_id ?? "") ?? project.org_id ?? ""}</bdi> · <bdi>{project.id}</bdi></small></span>
              </button>)}
              {!controller.error && projects.length === 0 && <p>{t(query ? "cloud.catalog.noMatches" : "cloud.catalog.empty")}</p>}
            </div>}
          <form className="desktop-cloud-account-create" onSubmit={(event) => {
            event.preventDefault(); void controller.create(organization, name);
          }}>
            <h3>{t("cloud.catalog.create")}</h3>
            <input required aria-label={t("cloud.catalog.name")} placeholder={t("cloud.catalog.name")}
              value={name} onChange={(event) => setName(event.target.value)} disabled={controller.opening} />
            <select required aria-label={t("cloud.catalog.organization")} value={organization}
              onChange={(event) => setOrganization(event.target.value)} disabled={controller.opening}>
              <option value="">{t("cloud.catalog.organization")}</option>
              {controller.organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <button type="submit" className="desktop-cloud-row-action" disabled={controller.opening || !name.trim() || !organizations.has(organization)}>
              {t("cloud.catalog.create")}
            </button>
          </form>
          {onPublishLocal && <button type="button" className="desktop-cloud-row-action" disabled={controller.opening}
            onClick={() => { controller.cancel(); onPublishLocal(); }}>{t("cloud.catalog.publishLocal")}</button>}
        </div>}
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
