import type { ReactNode } from "react";
import { AlertTriangle, ArrowUp, ArrowUpRight, Check, Settings } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { CloudIcon, LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem } from "../DesktopMenu";
import { reachesOnlyThisComputer, type CloudCopy, type ProjectAudience } from "./projectAudience";
import "./project-audience.css";

/**
 * Who can open the project, as three rows with a tick: only this computer, all my
 * devices, a team. A row's action is the word at its end and the row itself is the
 * control. A copy in the Cloud hangs under the audience it serves, with one line to
 * open it and, only while there is something to send, one more.
 */
export function ProjectAudienceRows({ audience, onDismiss }: {
  audience: ProjectAudience;
  /** Closes the surrounding menu before an action takes over the window. */
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const run = (action?: () => void) => action && (() => { onDismiss(); action(); });
  const { devices, devicesCopy, team } = audience;
  return <section className="project-audience" aria-label={t("shell.projectAudience.title")}>
    <div className="project-audience-title" aria-hidden="true">{t("shell.projectAudience.title")}</div>
    <AudienceTier checked={reachesOnlyThisComputer(audience)} label={t("shell.projectAudience.onlyThisComputer")} />
    {(devices || devicesCopy) && <>
      <AudienceTier checked={Boolean(devices?.on || devicesCopy)} label={t("shell.projectAudience.devices")}
        action={devices?.on ? t("shell.projectAudience.stop") : t("shell.projectAudience.turnOn")}
        onClick={run(devices?.on ? devices.onStop : devices?.onTurnOn)} />
      {devices?.on && <AudienceDetail icon={<LocalIcon size={13} strokeWidth={1.85} />}
        label={devices.detail ?? t("shell.projectAudience.devicesOn")}
        trailing={devices.onSettings && <Settings size={13} strokeWidth={1.85} aria-hidden="true" />}
        onClick={run(devices.onSettings)} />}
      {devicesCopy && <CloudCopyRows copy={devicesCopy} run={run} />}
    </>}
    {team && <>
      <AudienceTier checked={Boolean(team.copy)} label={t("shell.projectAudience.team")}
        action={team.copy ? undefined : t("shell.projectAudience.copy")} onClick={team.copy ? undefined : run(team.onCopy)} />
      {team.copy && <CloudCopyRows copy={team.copy} run={run} />}
    </>}
  </section>;
}

/** One audience. Without an action it only states whether it applies. */
function AudienceTier({ checked, label, action, onClick }: {
  checked: boolean;
  label: string;
  action?: string;
  onClick?: () => void;
}) {
  return <DesktopMenuItem className="project-audience-tier" role="menuitemcheckbox" aria-checked={checked}
    aria-disabled={onClick ? undefined : "true"} data-checked={checked || undefined}
    icon={checked ? <Check size={14} strokeWidth={1.85} /> : <span />}
    label={label}
    trailing={onClick && action ? <span className="project-audience-action">{action}</span> : undefined}
    onClick={onClick} />;
}

/** A quiet line under an audience: how it is reached, or one thing to do about it. */
function AudienceDetail({ icon, label, trailing, tone, onClick }: {
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  tone?: "warning";
  onClick?: () => void;
}) {
  return <DesktopMenuItem className="project-audience-detail" data-tone={tone}
    aria-disabled={onClick ? undefined : "true"} icon={icon} label={label}
    trailing={trailing ? <span className="project-audience-action">{trailing}</span> : undefined}
    onClick={onClick} />;
}

function CloudCopyRows({ copy, run }: {
  copy: CloudCopy;
  run: (action?: () => void) => (() => void) | undefined;
}) {
  const { t } = useLocalization();
  const unsent = copy.unsent ?? 0;
  return <>
    <AudienceDetail icon={<CloudIcon size={13} strokeWidth={1.85} />} label={t("shell.projectAudience.cloudCopy")}
      trailing={copy.onOpen && <>{t("shell.projectAudience.open")}<ArrowUpRight size={12} strokeWidth={1.85} aria-hidden="true" /></>}
      onClick={run(copy.onOpen)} />
    {copy.problem && <AudienceDetail tone="warning" icon={<AlertTriangle size={13} strokeWidth={1.85} />}
      label={copy.problem} trailing={copy.onResolve && copy.resolveLabel} onClick={run(copy.onResolve)} />}
    {!copy.problem && unsent > 0 && <AudienceDetail icon={<ArrowUp size={13} strokeWidth={1.85} />}
      label={t("shell.projectAudience.unsent", { count: unsent })}
      trailing={copy.onSend && t("shell.projectAudience.send")} onClick={run(copy.onSend)} />}
  </>;
}

/** The owner's other computers that can open a folder: "Studio Mac and 2 others". */
export function OtherComputersLabel({ names, paused = false }: { names: readonly string[]; paused?: boolean }) {
  const { t } = useLocalization();
  const [first] = names;
  let text = t("shell.projectAudience.devicesOn");
  if (first) text = names.length > 1 ? t("shell.projectAudience.otherComputers", { name: first, count: names.length - 1 }) : first;
  return <>{paused ? `${text} · ${t("hosts.sharing.paused")}` : text}</>;
}
