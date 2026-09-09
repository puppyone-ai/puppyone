import { useLayoutEffect, useState } from "react";
import type { DesktopTerminalLauncherId } from "../../model/terminalLaunchers";
import type { DesktopTerminalSessionSummary } from "../../model/terminalSessions";
import type { TerminalRuntimeHandle } from "../../runtime/terminalRuntime";
import { TerminalActivityGrid } from "../TerminalActivityGrid";
import { AgentLauncherIcon } from "../../../../components/brand/AgentLauncherIcon";

type TerminalSessionHeaderStatusProps = {
  className: string;
  runtime: Pick<TerminalRuntimeHandle, "activity" | "subscribeActivity"> | null;
  session: DesktopTerminalSessionSummary;
};

export function TerminalSessionHeaderStatus({
  className,
  runtime,
  session,
}: TerminalSessionHeaderStatusProps) {
  const terminalActivity = useTerminalActivity(runtime);
  const agentSession = session.launcherId !== null && session.launcherId !== "shell";
  const active = agentSession && (
    session.status === "starting"
    || (session.status === "running" && terminalActivity)
  );

  return (
    <span
      className={`${className} ${active ? "is-activity" : ""}`}
      data-status={session.status}
      aria-hidden="true"
    >
      <TerminalSessionHeaderStatusIcon active={active} launcherId={session.launcherId} />
    </span>
  );
}

function TerminalSessionHeaderStatusIcon({
  active,
  launcherId,
}: {
  active: boolean;
  launcherId: DesktopTerminalLauncherId | null;
}) {
  return active ? (
    <TerminalActivityGrid className="desktop-terminal-tab-activity-indicator" />
  ) : (
    <AgentLauncherIcon compact launcherId={launcherId} />
  );
}

function useTerminalActivity(runtime: Pick<TerminalRuntimeHandle, "activity" | "subscribeActivity"> | null) {
  const [active, setActive] = useState(() => runtime?.activity ?? false);

  useLayoutEffect(() => {
    if (!runtime) {
      setActive(false);
      return undefined;
    }
    return runtime.subscribeActivity(setActive);
  }, [runtime]);

  return active;
}
