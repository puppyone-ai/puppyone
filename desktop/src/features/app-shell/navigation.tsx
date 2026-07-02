import type { ReactNode, SVGProps } from "react";
import { Cloud, Folder, Settings } from "lucide-react";
import type { DesktopView } from "../../components/DesktopCloudShell";
import type { SidebarNavigationOrientation } from "../../preferences";

export type DesktopSidebarIconComponent = (props: { size?: number; className?: string }) => ReactNode;

export function PuppyGitIcon({
  size = 15,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="5" cy="6" r="3" />
      <path d="M5 9v12" />
      <circle cx="19" cy="18" r="3" />
      <path d="m15 9-3-3 3-3" />
      <path d="M12 6h5a2 2 0 0 1 2 2v7" />
    </svg>
  );
}

export function DesktopSidebarFooterNavigation({
  activeView,
  gitIncomingCount,
  onNavigate,
  onOpenSettings,
}: {
  activeView: DesktopView;
  gitIncomingCount: number;
  onNavigate: (view: DesktopView) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="desktop-sidebar-footer-bar actions-only horizontal">
      <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-local">
        <DesktopSidebarIconNavigation
          activeView={activeView}
          items={DESKTOP_LOCAL_SIDEBAR_NAV_ITEMS}
          gitIncomingCount={gitIncomingCount}
          onNavigate={onNavigate}
        />
        <DesktopSidebarSettingsButton
          activeView={activeView}
          buttonClassName="desktop-sidebar-footer-button"
          onOpenSettings={onOpenSettings}
        />
      </div>
      <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-cloud">
        <DesktopSidebarIconNavigation
          activeView={activeView}
          items={DESKTOP_CLOUD_SIDEBAR_NAV_ITEMS}
          gitIncomingCount={gitIncomingCount}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

export function DesktopSidebarTopNavigation({
  activeView,
  orientation,
  gitIncomingCount,
  onNavigate,
  onOpenSettings,
}: {
  activeView: DesktopView;
  orientation: SidebarNavigationOrientation;
  gitIncomingCount: number;
  onNavigate: (view: DesktopView) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className={`desktop-sidebar-top-navigation ${orientation}`}>
      <div className="desktop-sidebar-top-navigation-list" aria-label="Workspace navigation">
        <div className="desktop-sidebar-top-navigation-group desktop-sidebar-top-navigation-local">
          <DesktopSidebarButtonNavigation
            activeView={activeView}
            items={DESKTOP_LOCAL_SIDEBAR_NAV_ITEMS}
            gitIncomingCount={gitIncomingCount}
            onNavigate={onNavigate}
          />
          <DesktopSidebarSettingsButton
            activeView={activeView}
            buttonClassName="desktop-sidebar-top-navigation-button"
            onOpenSettings={onOpenSettings}
          />
        </div>
        <div className="desktop-sidebar-top-navigation-group desktop-sidebar-top-navigation-cloud">
          <DesktopSidebarButtonNavigation
            activeView={activeView}
            items={DESKTOP_CLOUD_SIDEBAR_NAV_ITEMS}
            gitIncomingCount={gitIncomingCount}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </div>
  );
}

function DesktopSidebarSettingsButton({
  activeView,
  buttonClassName,
  onOpenSettings,
}: {
  activeView: DesktopView;
  buttonClassName: string;
  onOpenSettings: () => void;
}) {
  return (
    <button
      className={`${buttonClassName} ${activeView === "settings" ? "active" : ""}`}
      type="button"
      title="Settings"
      aria-label="Settings"
      aria-current={activeView === "settings" ? "page" : undefined}
      onClick={onOpenSettings}
    >
      <Settings size={16} />
    </button>
  );
}

function DesktopSidebarButtonNavigation({
  activeView,
  items,
  gitIncomingCount,
  onNavigate,
}: {
  activeView: DesktopView;
  items: typeof DESKTOP_NAV_ITEMS;
  gitIncomingCount: number;
  onNavigate: (view: DesktopView) => void;
}) {
  return (
    <>
      {items.map((item) => {
        const badgeCount = item.view === "git" ? gitIncomingCount : 0;
        const navLabel = getDesktopNavigationLabel(item.label, badgeCount);
        return (
          <button
            key={item.view}
            className={`desktop-sidebar-top-navigation-button ${activeView === item.view ? "active" : ""}`}
            type="button"
            title={navLabel}
            aria-label={navLabel}
            aria-current={activeView === item.view ? "page" : undefined}
            onClick={() => onNavigate(item.view)}
          >
            <item.icon size={item.iconSize ?? 16} />
            <span>{item.label}</span>
            <DesktopNavBadge count={badgeCount} />
          </button>
        );
      })}
    </>
  );
}

function DesktopSidebarIconNavigation({
  activeView,
  items,
  gitIncomingCount,
  onNavigate,
}: {
  activeView: DesktopView;
  items: typeof DESKTOP_NAV_ITEMS;
  gitIncomingCount: number;
  onNavigate: (view: DesktopView) => void;
}) {
  return (
    <>
      {items.map((item) => {
        const badgeCount = item.view === "git" ? gitIncomingCount : 0;
        const navLabel = getDesktopNavigationLabel(item.label, badgeCount);
        return (
          <button
            key={item.view}
            className={`desktop-sidebar-footer-button ${activeView === item.view ? "active" : ""}`}
            type="button"
            title={navLabel}
            aria-label={navLabel}
            aria-current={activeView === item.view ? "page" : undefined}
            onClick={() => onNavigate(item.view)}
          >
            <item.icon size={item.iconSize ?? 16} />
            <DesktopNavBadge count={badgeCount} />
          </button>
        );
      })}
    </>
  );
}

function DesktopNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <em className="desktop-sidebar-nav-badge" aria-hidden="true">
      {count > 99 ? "99+" : count}
    </em>
  );
}

function getDesktopNavigationLabel(label: string, incomingCount: number) {
  if (incomingCount <= 0) return label;
  return `${label}, ${incomingCount} remote change${incomingCount === 1 ? "" : "s"} to pull`;
}

const DESKTOP_NAV_ITEMS = [
  { view: "data", label: "Files", icon: Folder },
  { view: "git", label: "Changes", icon: PuppyGitIcon, iconSize: 15 },
  { view: "cloud", label: "Cloud", icon: Cloud },
] satisfies Array<{
  view: Extract<DesktopView, "data" | "git" | "cloud">;
  label: string;
  icon: DesktopSidebarIconComponent;
  iconSize?: number;
}>;

const DESKTOP_LOCAL_SIDEBAR_NAV_ITEMS = DESKTOP_NAV_ITEMS.filter((item) => item.view !== "cloud");
const DESKTOP_CLOUD_SIDEBAR_NAV_ITEMS = DESKTOP_NAV_ITEMS.filter((item) => item.view === "cloud");
