import { MessageSquare, SquareTerminal } from "lucide-react";
import {
  AgentBrandImage,
  resolveAgentBrand,
} from "@puppyone/shared-ui";
import "./agent-launcher-icon.css";

export function AgentLauncherIcon({
  className = "",
  compact = false,
  fallback = "terminal",
  iconKey = null,
  launcherId = null,
}: {
  className?: string;
  compact?: boolean;
  fallback?: "chat" | "terminal";
  iconKey?: string | null;
  launcherId?: string | null;
}) {
  const brand = resolveAgentBrand({ id: launcherId, iconKey });
  const chatFallback = fallback === "chat" && launcherId === null;
  const iconKind = brand?.id ?? (chatFallback ? "chat-fallback" : launcherId ?? "shell");

  return (
    <span
      className={`desktop-terminal-launcher-icon is-${iconKind} ${compact ? "is-compact" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      {brand ? (
        <AgentBrandImage brandId={brand.id} />
      ) : chatFallback ? (
        <MessageSquare size={compact ? 14 : 16} strokeWidth={1.7} />
      ) : (
        <SquareTerminal size={compact ? 14 : 16} strokeWidth={1.6} />
      )}
    </span>
  );
}
