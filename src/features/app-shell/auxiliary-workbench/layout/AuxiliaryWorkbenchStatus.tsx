import { SquareDashed } from "lucide-react";
import { WorkbenchLauncherIcon } from "./WorkbenchLauncherIcon";
import type { AuxiliaryWorkbenchHeaderItem } from "./AuxiliaryWorkbenchHeader.types";
export function AuxiliaryWorkbenchStatus({ className, item }: { className: string; item: AuxiliaryWorkbenchHeaderItem }) {
  return <span className={`${className} desktop-terminal-chat-tab-status ${item.snapshot.running ? "is-running" : ""}`} data-status={item.snapshot.status} aria-hidden="true">
    {item.statusIcon ?? (item.kind === "launcher" ? <SquareDashed size={14} /> : <WorkbenchLauncherIcon compact iconKey={item.snapshot.iconKey} />)}
    {!item.statusIcon && item.snapshot.running && <i />}
  </span>;
}
