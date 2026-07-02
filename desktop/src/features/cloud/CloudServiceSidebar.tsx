import { ArrowLeft, Cloud } from "lucide-react";
import type { CloudServiceSidebarProps, CloudWorkspaceSection } from "./types";
import { getCloudAuthSession, resolveCloudAuthState } from "./auth";
import { resolveCloudEnvironment } from "./environment";
import {
  CLOUD_GLOBAL_SIDEBAR_ROUTES,
  CLOUD_PROJECT_SIDEBAR_ROUTES,
  CLOUD_PROJECTS_SIDEBAR_ROUTES,
  isCloudProjectSection,
  normalizeCloudSection,
} from "./routes/cloudRoutes";
import { getAccountInitial } from "./utils";

type CloudSidebarNavEntry = {
  id: CloudWorkspaceSection;
  label: string;
  icon: typeof Cloud;
  groupEnd?: boolean;
};

export function CloudServiceSidebar({
  status,
  cloudSession,
  activeSection,
  onSelectSection,
}: CloudServiceSidebarProps) {
  const normalizedActiveSection = normalizeCloudSection(activeSection);
  const cloudEnvironment = resolveCloudEnvironment({ status });
  const cloudAuthState = resolveCloudAuthState({
    cloudSession,
    environment: cloudEnvironment,
  });
  const effectiveCloudSession = getCloudAuthSession(cloudAuthState);
  const accountEmail = effectiveCloudSession?.user_email ?? null;
  const signedIn = Boolean(effectiveCloudSession);
  const inProjectContext = signedIn && isCloudProjectSection(normalizedActiveSection);
  const navItems: CloudSidebarNavEntry[] = !signedIn
    ? CLOUD_PROJECTS_SIDEBAR_ROUTES
    : inProjectContext
      ? CLOUD_PROJECT_SIDEBAR_ROUTES
      : CLOUD_GLOBAL_SIDEBAR_ROUTES;

  return (
    <section className="desktop-tool-sidebar desktop-cloud-service-sidebar">
      {inProjectContext && (
        <div className="desktop-cloud-sidebar-context">
          <button
            className="desktop-cloud-sidebar-context-back"
            type="button"
            onClick={() => onSelectSection("overview")}
          >
            <ArrowLeft size={14} />
            <span>Cloud Projects</span>
          </button>
        </div>
      )}

      <div className="desktop-tool-sidebar-list desktop-cloud-sidebar-list">
        <nav className="desktop-cloud-sidebar-nav" aria-label={inProjectContext ? "Cloud project sections" : "Cloud sections"}>
          {navItems.map((item) => (
            <CloudSidebarNavItem
              key={item.id}
              item={item}
              active={normalizedActiveSection === item.id || (!signedIn && item.id === "overview")}
              onSelect={onSelectSection}
            />
          ))}
        </nav>
      </div>

      {signedIn && (
        <div className="desktop-cloud-sidebar-footer">
          <div className="desktop-cloud-sidebar-footer-avatar" role="img" title={accountEmail ?? "Signed in"} aria-label="Cloud account">
            {getAccountInitial(accountEmail)}
          </div>
        </div>
      )}
    </section>
  );
}

export function CloudSidebarNavItem({
  item,
  active,
  onSelect,
}: {
  item: CloudSidebarNavEntry;
  active: boolean;
  onSelect: (section: CloudWorkspaceSection) => void;
}) {
  const Icon = item.icon;

  return (
    <>
      <button
        className={`desktop-tool-sidebar-row desktop-cloud-sidebar-nav-row ${active ? "active" : ""}`}
        type="button"
        onClick={() => onSelect(item.id)}
      >
        <span className="desktop-cloud-sidebar-nav-icon">
          <Icon size={15} />
        </span>
        <span className="desktop-cloud-sidebar-nav-label">{item.label}</span>
      </button>
      {item.groupEnd && <div className="desktop-cloud-sidebar-separator" />}
    </>
  );
}
