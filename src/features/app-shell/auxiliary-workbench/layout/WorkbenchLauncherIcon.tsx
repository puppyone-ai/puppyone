import { AgentLauncherIcon } from "../../../../components/brand/AgentLauncherIcon";

export function WorkbenchLauncherIcon({
  compact = false,
  iconKey,
  launcherId,
}: Readonly<{
  compact?: boolean;
  iconKey?: string | null;
  launcherId?: string;
}>) {
  return (
    <AgentLauncherIcon
      compact={compact}
      fallback="chat"
      iconKey={iconKey}
      launcherId={launcherId}
    />
  );
}
