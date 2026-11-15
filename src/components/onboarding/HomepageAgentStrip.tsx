import {
  AgentBrandImage,
  AgentMonochromeBrandImage,
  CloudIcon,
  getAgentBrand,
  isMonochromeAgentBrandId,
  resolveAgentBrand,
  Tooltip,
} from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { Plus } from "lucide-react";
import { AgentAvatarMark } from "../brand/AgentAvatarMark";
import type { HomepageLocalAgent } from "./useHomepageAgents";
import type { HomepageCloudAgent } from "./useHomepageCloudAgents";

export type { HomepageCloudAgent } from "./useHomepageCloudAgents";

const MARK = { size: 14, strokeWidth: 1.85, "aria-hidden": true } as const;

export function HomepageAgentBrandMark({
  iconKey,
  label,
}: {
  iconKey?: string | null;
  label: string;
}) {
  const brand = getAgentBrand(iconKey) ?? resolveAgentBrand({ iconKey, label });
  if (brand) {
    const monochrome = (brand.id === "chatgpt" || brand.id === "codex") && isMonochromeAgentBrandId(brand.id);
    return (
      <span className={`onboarding-agent-brand is-${brand.id}${monochrome ? " is-monochrome" : ""}`} aria-hidden="true">
        {monochrome ? <AgentMonochromeBrandImage brandId={brand.id} /> : <AgentBrandImage brandId={brand.id} />}
      </span>
    );
  }
  const initials = label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "A";
  return <span className="onboarding-agent-brand is-fallback" aria-hidden="true">{initials}</span>;
}

function formatCloudAgentActivity(
  value: string | null,
  t: MessageFormatter,
  formatRelativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string,
): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return t("onboarding.time.justNow");
  if (elapsed < hour) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / minute)), "minute", { numeric: "always" });
  if (elapsed < day) return formatRelativeTime(-Math.max(1, Math.floor(elapsed / hour)), "hour", { numeric: "always" });
  return formatRelativeTime(-Math.max(1, Math.floor(elapsed / day)), "day", { numeric: "always" });
}

/**
 * The person's own Agents, at the head of a page of projects: compact brand marks on
 * one quiet row, revealing each Agent's name and role on hover so a machine with many
 * Agents installed never wraps the header or crowds the projects below.
 */
export function HomepageAgentStrip({
  local,
  cloud,
  thisComputerLabel,
  busy,
  onStart,
  onConnect,
}: {
  local: readonly HomepageLocalAgent[];
  cloud: readonly HomepageCloudAgent[];
  thisComputerLabel?: string;
  busy: boolean;
  onStart?: (runtimeId: string) => void;
  /** Where another Agent is set up. */
  onConnect?: () => void;
}) {
  const { t, formatRelativeTime } = useLocalization();
  if (local.length === 0 && cloud.length === 0 && !onConnect) return null;
  const localLabel = thisComputerLabel ?? t("onboarding.agents.thisComputer");
  const cloudLabel = t("onboarding.agents.cloud");
  const connectLabel = t("onboarding.agents.connect");
  return (
    <div className="onboarding-agent-strip" role="group" aria-label={t("onboarding.agents.label")}>
      {local.length > 0 && (
        <div className="onboarding-agent-group" data-agent-place="local" role="group" aria-label={localLabel}>
          {local.map((agent) => {
            const start = t("onboarding.agents.start", { agent: bidiIsolate(agent.label) });
            const headline = onStart ? start : agent.label;
            const tooltip = agent.connected
              ? `${headline} · ${t("onboarding.agents.connected")}`
              : headline;
            return (
              <Tooltip key={agent.runtimeId} content={tooltip} placement="bottom">
                <button
                  type="button"
                  className="onboarding-agent"
                  data-agent-runtime={agent.runtimeId}
                  aria-label={start}
                  disabled={busy || !onStart}
                  onClick={() => onStart?.(agent.runtimeId)}
                >
                  <HomepageAgentBrandMark iconKey={agent.iconKey} label={agent.label} />
                  {agent.connected && <span className="onboarding-agent-connected" aria-hidden="true" />}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
      {local.length > 0 && cloud.length > 0 && <span className="onboarding-agent-sep" aria-hidden="true" />}
      {cloud.length > 0 && (
        <div className="onboarding-agent-group" data-agent-place="cloud" role="group" aria-label={cloudLabel}>
          <Tooltip content={cloudLabel} placement="bottom">
            <span className="onboarding-agent-place-mark" aria-hidden="true">
              <CloudIcon size={13} strokeWidth={1.85} aria-hidden />
            </span>
          </Tooltip>
          {cloud.map((agent) => {
            const lastActive = formatCloudAgentActivity(agent.lastActiveAt, t, formatRelativeTime);
            const tooltip = lastActive
              ? t("onboarding.agents.lastActive", { agent: bidiIsolate(agent.name), time: lastActive })
              : agent.name;
            return (
              <Tooltip key={agent.id} content={tooltip} placement="bottom">
                <span className="onboarding-agent is-face" data-agent-id={agent.id} role="img" aria-label={tooltip} tabIndex={0}>
                  <AgentAvatarMark name={agent.name} avatar={agent.avatar} active={false} size={18} />
                </span>
              </Tooltip>
            );
          })}
        </div>
      )}
      {onConnect && (
        <Tooltip content={connectLabel} placement="bottom">
          <button
            type="button"
            className="onboarding-agent onboarding-agent-connect"
            aria-label={connectLabel}
            disabled={busy}
            onClick={onConnect}
          >
            <Plus {...MARK} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
