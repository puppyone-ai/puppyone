import { ArrowDown, ArrowUp, Check, Plus } from "lucide-react";
import {
  SidebarResizeHandle,
  type SidebarResizeIntent,
} from "@puppyone/shared-ui";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import type { GitActionIconKind } from "../types";
import type { GitSidebarPanelId } from "./useGitSidebarPanelLayout";

export function GitSectionCollapse({
  id,
  expanded,
  children,
  className,
  ariaLabel,
}: {
  id?: string;
  expanded: boolean;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  // React 18 types `inert` as a boolean but its DOM renderer only emits the
  // standards-compliant empty-string attribute without a warning.
  const inertWhenCollapsed = expanded ? {} : { inert: "" };
  return (
    <div
      id={id}
      className={`desktop-git-section-collapse${className ? ` ${className}` : ""} ${expanded ? "expanded" : "collapsed"}`}
      aria-label={ariaLabel}
      aria-hidden={expanded ? undefined : true}
      {...inertWhenCollapsed}
    >
      <div className="desktop-git-section-collapse-inner">{children}</div>
    </div>
  );
}

export function GitSidebarSectionResizer({
  previous,
  next,
  active,
  onPointerDown,
  onKeyboardResize,
}: {
  previous: GitSidebarPanelId;
  next: GitSidebarPanelId;
  active: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyboardResize: (
    previous: GitSidebarPanelId,
    next: GitSidebarPanelId,
    intent: SidebarResizeIntent,
    accelerated: boolean,
  ) => void;
}) {
  const { t } = useLocalization();
  return (
    <SidebarResizeHandle
      className={`desktop-git-section-resizer ${active ? "active" : ""}`}
      data-previous-panel={previous}
      data-next-panel={next}
      orientation="horizontal"
      label={t("source-control.sidebar.resize")}
      onPointerDown={onPointerDown}
      onKeyboardResize={(intent, accelerated) => onKeyboardResize(previous, next, intent, accelerated)}
    />
  );
}

export function GitOperationButton({
  className,
  title,
  disabled,
  icon,
  label,
  loadingKey,
  loadingLabel,
  operationLoading,
  primary = false,
  onClick,
}: {
  className: string;
  title: string;
  disabled: boolean;
  icon: GitActionIconKind;
  label: string;
  loadingKey: string;
  loadingLabel: string;
  operationLoading: string | null;
  primary?: boolean;
  onClick: () => void;
}) {
  const loading = operationLoading === loadingKey;
  const buttonClassName = [
    "desktop-git-operation-button",
    className,
    primary ? "is-primary" : "",
    loading ? "is-loading" : "",
  ].filter(Boolean).join(" ");
  return (
    <button
      className={buttonClassName}
      type="button"
      title={title}
      aria-label={loading ? loadingLabel : label}
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? <SourceControlDots /> : renderGitActionIcon(icon)}
      <span className="desktop-git-operation-label">{loading ? loadingLabel : label}</span>
    </button>
  );
}

export function SourceControlDots({ decorative = false }: Readonly<{ decorative?: boolean }> = {}) {
  const { t } = useLocalization();
  return (
    <span
      className="desktop-git-loading-dots"
      data-puppy-loader="dots"
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : t("common.status.loading")}
      aria-hidden={decorative || undefined}
    >
      {[0, 1, 2].map((index) => <span key={index} />)}
    </span>
  );
}

export function GitSidebarLoadingState({
  className,
  label,
}: Readonly<{
  className?: string;
  label: ReactNode;
}>) {
  return (
    <div
      className={`desktop-git-loading-state${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="desktop-git-loading-state-dots">
        <SourceControlDots decorative />
      </span>
      <span className="desktop-git-loading-state-label">{label}</span>
    </div>
  );
}

function renderGitActionIcon(icon: GitActionIconKind) {
  if (icon === "check") return <Check size={15} strokeWidth={2.25} aria-hidden="true" />;
  if (icon === "plus") return <Plus size={15} strokeWidth={2.25} aria-hidden="true" />;
  const Icon = icon === "upload" ? ArrowUp : ArrowDown;
  return <Icon className="desktop-git-action-arrow" size={15} strokeWidth={2.25} aria-hidden="true" />;
}
