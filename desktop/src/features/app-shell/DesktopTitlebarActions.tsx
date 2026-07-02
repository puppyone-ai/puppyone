import { Eraser, SquareTerminal } from "lucide-react";
import {
  DesktopUpdateTitlebarButton,
  type useDesktopUpdates,
} from "../../components/DesktopUpdateControls";

type DesktopUpdatesController = ReturnType<typeof useDesktopUpdates>;

type DesktopTitlebarActionsProps = {
  desktopUpdates: DesktopUpdatesController;
  terminalSidebarOpen: boolean;
  terminalToolEnabled: boolean;
  onClearTerminal: () => void;
  onToggleTerminal: () => void;
  onUpdateNow: () => void;
};

export function DesktopTitlebarActions({
  desktopUpdates,
  terminalSidebarOpen,
  terminalToolEnabled,
  onClearTerminal,
  onToggleTerminal,
  onUpdateNow,
}: DesktopTitlebarActionsProps) {
  return (
    <>
      <DesktopUpdateTitlebarButton
        state={desktopUpdates.state}
        onUpdateNow={onUpdateNow}
      />
      {terminalToolEnabled && terminalSidebarOpen && (
        <button
          className="desktop-titlebar-action"
          type="button"
          title="Clear terminal"
          aria-label="Clear terminal"
          onClick={onClearTerminal}
        >
          <Eraser size={15} />
        </button>
      )}
      {terminalToolEnabled && (
        <button
          className="desktop-titlebar-action"
          type="button"
          title={terminalSidebarOpen ? "Hide terminal" : "Show terminal"}
          aria-label={terminalSidebarOpen ? "Hide terminal" : "Show terminal"}
          aria-pressed={terminalSidebarOpen}
          onClick={onToggleTerminal}
        >
          <SquareTerminal size={16} />
        </button>
      )}
    </>
  );
}
