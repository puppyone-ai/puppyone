import { useCallback, useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization";
import { Tooltip } from "@puppyone/shared-ui";
import { agentChangedFilesStore } from "./agentChangedFilesStore";
import "./agent-changed-files.css";

export function AgentChangedFileMark({ root, path, folder = false }: { root: string; path: string; folder?: boolean }) {
  const { t } = useLocalization();
  const subscribe = useCallback((listener: () => void) => agentChangedFilesStore.subscribe(root, listener), [root]);
  const snapshot = useCallback(() => agentChangedFilesStore.has(root, path, folder), [root, path, folder]);
  const changed = useSyncExternalStore(subscribe, snapshot, () => false);
  if (!changed) return null;
  const label = t(folder ? "workspace.explorer.agentChangedFolder" : "workspace.explorer.agentChangedFile");
  return <Tooltip content={label}><span className="desktop-agent-changed-file-mark" data-folder={folder || undefined} aria-label={label} role="img" /></Tooltip>;
}
