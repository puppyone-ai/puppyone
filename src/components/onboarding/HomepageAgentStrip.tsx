import {
  AgentBrandImage,
  AgentMonochromeBrandImage,
  CloudIcon,
  getAgentBrand,
  isMonochromeAgentBrandId,
  LocalIcon,
  resolveAgentBrand,
  Tooltip,
} from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";
import { Plus } from "lucide-react";
import { AgentAvatarMark } from "../brand/AgentAvatarMark";
import type { HomepageLocalAgent } from "./useHomepageAgents";
import type { HomepageCloudAgent } from "./useHomepageCloudAgents";

export type { HomepageCloudAgent } from "./useHomepageCloudAgents";

const MARK = { size: 13, strokeWidth: 1.85, "aria-hidden": true } as const;

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
 * The person's own Agents, at the head of a page of projects: the ones installed on
 * this computer by name, then the ones that reach their personal Cloud space by face.
 * The Agents do the work and the projects keep it, so each one here is a way in, never
 * a prompt of puppyone's own: one on this computer starts a project when chosen.
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
  return (
    <div className="onboarding-agent-strip" role="group" aria-label={t("onboarding.agents.label")}>
      {local.length > 0 && (
        <div className="onboarding-agent-group" data-agent-place="local">
          <span className="onboarding-agent-group-label"><LocalIcon {...MARK} />{localLabel}</span>
          {local.map((agent) => {
            const start = t("onboarding.agents.start", { agent: bidiIsolate(agent.label) });
            return (
              <Tooltip key={agent.runtimeId} content={agent.connected ? `${start} · ${t("onboarding.agents.connected")}` : start}>
                <button
                  type="button"
                  className="onboarding-agent"
                  data-agent-runtime={agent.runtimeId}
                  aria-label={start}
                  disabled={busy || !onStart}
                  onClick={() => onStart?.(agent.runtimeId)}
                >
                  <HomepageAgentBrandMark iconKey={agent.iconKey} label={agent.label} />
                  <span className="onboarding-agent-name">{agent.label}</span>
                  {agent.connected && <span className="onboarding-agent-connected" aria-hidden="true" />}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
      {local.length > 0 && cloud.length > 0 && <span className="onboarding-agent-sep" aria-hidden="true" />}
      {cloud.length > 0 && (
        <div className="onboarding-agent-group" data-agent-place="cloud">
          <span className="onboarding-agent-group-label"><CloudIcon {...MARK} />{t("onboarding.agents.cloud")}</span>
          {cloud.map((agent) => {
            const lastActive = formatCloudAgentActivity(agent.lastActiveAt, t, formatRelativeTime);
            const tooltip = lastActive
              ? t("onboarding.agents.lastActive", { agent: bidiIsolate(agent.name), time: lastActive })
              : agent.name;
            return (
              <Tooltip key={agent.id} content={tooltip}>
                <span className="onboarding-agent is-face" data-agent-id={agent.id} role="img" aria-label={tooltip} tabIndex={0}>
                  <AgentAvatarMark name={agent.name} avatar={agent.avatar} active={false} size={20} />
                </span>
              </Tooltip>
            );
          })}
        </div>
      )}
      {onConnect && (
        <button type="button" className="onboarding-agent onboarding-agent-connect" disabled={busy} onClick={onConnect}>
          <Plus {...MARK} />
          <span className="onboarding-agent-name">{t("onboarding.agents.connect")}</span>
        </button>
      )}
    </div>
  );
}
