import { Tooltip } from "@puppyone/shared-ui";
import { Hand, Eye } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import type { AgentActivityStore } from "../application/agentActivityStore";
import "./agent-file-presence.css";

export function AgentFilePresence({
  path,
  store,
  variant = "editor",
}: {
  path: string;
  store: AgentActivityStore;
  variant?: "editor" | "explorer";
}) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribePath(path, listener),
    [path, store],
  );
  const getSnapshot = useCallback(() => store.getPathSnapshot(path), [path, store]);
  const projection = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (!projection) return null;
  const { primary, additionalCount } = projection;
  const active = primary.phase === "started";
  const label = primary.kind === "reading"
    ? `${primary.providerLabel} is reading this file`
    : `${primary.providerLabel} is writing this file`;
  const Icon = primary.kind === "reading" ? Eye : Hand;

  return (
    <Tooltip content={label}><span
      className="desktop-agent-file-presence"
      data-kind={primary.kind}
      data-phase={active ? "active" : "settled"}
      data-variant={variant}
      role="status"
      aria-label={label}
    >
      <span className="desktop-agent-file-presence-actor" aria-hidden="true">
        {initials(primary.providerLabel)}
      </span>
      <Icon size={variant === "explorer" ? 11 : 12} strokeWidth={1.9} aria-hidden="true" />
      {variant === "editor" && (
        <span className="desktop-agent-file-presence-label">{primary.providerLabel}</span>
      )}
      {additionalCount > 0 && (
        <span className="desktop-agent-file-presence-count" aria-hidden="true">+{additionalCount}</span>
      )}
    </span></Tooltip>
  );
}

function initials(value: string) {
  return value.split(/\s+/u).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
