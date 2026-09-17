import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, MoreHorizontal, Plus, RotateCcw } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuItem, DesktopMenuSeparator, DesktopMenuSurface } from "../../../components/DesktopMenu";
import { AgentBrandMark } from "./AgentBrandMark";

type AgentSurfaceHeaderProps = {
  title: string;
  runtimeIconKey?: string | null;
  runtimeLabel?: string;
  statusCode: string;
  statusLabel: string;
  loading: boolean;
  newSessionDisabled: boolean;
  onNewSession: () => void;
  showNewSessionAction?: boolean;
  agentSelector?: ReactNode;
  diagnostic?: string | null;
  closeDisabled?: boolean;
  onCloseSession?: () => void;
  onCompactSession?: () => void;
  canCompact?: boolean;
};

export function AgentSurfaceHeader({
  title,
  runtimeIconKey = null,
  runtimeLabel: runtimeLabelProp,
  statusCode,
  statusLabel,
  loading,
  newSessionDisabled,
  onNewSession,
  showNewSessionAction = true,
  agentSelector = null,
  diagnostic,
  closeDisabled = false,
  onCloseSession,
  onCompactSession,
  canCompact = false,
}: AgentSurfaceHeaderProps) {
  const { t } = useLocalization();
  const runtimeLabel = runtimeLabelProp || t("agent.name");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menuOpen]);

  return (
    <header className="desktop-agent-session-header">
      <div className="desktop-agent-session-identity">
        <span className="desktop-agent-surface-brand" aria-label={runtimeLabel}>
          <AgentBrandMark iconKey={runtimeIconKey} label={runtimeLabel} />
          <span>{runtimeLabel}</span>
        </span>
        {agentSelector && <div className="desktop-agent-session-agent-selector">{agentSelector}</div>}
      </div>
      <div className="desktop-agent-session-heading">
        <strong title={title}>{title}</strong>
        <span><i className={`is-${statusCode}`} />{statusLabel}</span>
      </div>
      <div className="desktop-agent-session-header-actions" ref={menuRef}>
        {showNewSessionAction && <button type="button" className="desktop-agent-icon-button" aria-label={t("agent.header.newSession", { agent: bidiIsolate(runtimeLabel) })} title={t("agent.header.newSession", { agent: bidiIsolate(runtimeLabel) })} disabled={loading || newSessionDisabled} onClick={onNewSession}><Plus size={16} /></button>}
        <button type="button" className="desktop-agent-icon-button" aria-label={t("agent.header.sessionActionsFor", { agent: bidiIsolate(runtimeLabel) })} title={t("agent.header.sessionActions")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={16} /></button>
        {menuOpen && (
          <DesktopMenuSurface ariaLabel={t("agent.header.sessionActionsFor", { agent: bidiIsolate(runtimeLabel) })} className="desktop-menu-surface desktop-agent-session-menu">
            <DesktopMenuItem icon={<CircleAlert size={15} />} label={t("agent.header.diagnostics")} detail={diagnostic || t("agent.header.noDiagnostics")} disabled />
            {(canCompact || onCloseSession) && <DesktopMenuSeparator />}
            {canCompact && onCompactSession && <DesktopMenuItem icon={<RotateCcw size={15} />} label={t("agent.header.compactContext")} disabled={loading || newSessionDisabled} onClick={() => { setMenuOpen(false); onCompactSession(); }} />}
            {onCloseSession && <DesktopMenuItem icon={<RotateCcw size={15} />} label={t("agent.header.closeConnection")} disabled={loading || closeDisabled} onClick={() => { setMenuOpen(false); onCloseSession(); }} />}
          </DesktopMenuSurface>
        )}
      </div>
    </header>
  );
}
