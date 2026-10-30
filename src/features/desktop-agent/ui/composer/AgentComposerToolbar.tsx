import { Tooltip } from "@puppyone/shared-ui";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import type { AgentReferenceInputCapabilities } from "../../domain/agent-contract";
import type { AgentSessionControl, AgentSessionControlId } from "../../domain/agent-session-controls";
import { AgentSessionControlPicker } from "../AgentSessionControlPicker";
import { AgentAttachmentButton } from "./AgentAttachmentButton";

type AgentComposerToolbarProps = {
  hideConfiguration: boolean;
  inputDisabled: boolean;
  configurationDisabled: boolean;
  running: boolean;
  sessionControls: AgentSessionControl[];
  onSelectSessionControl?: (id: AgentSessionControlId, value: string) => void;
  referenceCapabilities?: AgentReferenceInputCapabilities;
  onAddExternalFiles?: (files: File[]) => void;
  onPickWorkspaceReferences?: () => void;
  primaryActionLabel: string;
  primaryActionBusy: boolean;
  primaryActionDisabled: boolean;
  onPrimaryAction: () => void;
};

const ignoreSelection = () => {};

export function AgentComposerToolbar({
  hideConfiguration,
  inputDisabled,
  configurationDisabled,
  running,
  sessionControls,
  onSelectSessionControl,
  referenceCapabilities,
  onAddExternalFiles,
  onPickWorkspaceReferences,
  primaryActionLabel,
  primaryActionBusy,
  primaryActionDisabled,
  onPrimaryAction,
}: AgentComposerToolbarProps) {
  return (
    <div className="desktop-agent-composer-trailing">
      <div className="desktop-agent-composer-leading">
        {!hideConfiguration && sessionControls.map((control) => (
          <div className={`desktop-agent-composer-picker is-${control.id}`} key={control.id}>
            <AgentSessionControlPicker
              control={control}
              disabled={running || configurationDisabled}
              onSelect={onSelectSessionControl ?? ignoreSelection}
            />
          </div>
        ))}
      </div>
      <div className="desktop-agent-composer-actions">
        <AgentAttachmentButton
          capabilities={referenceCapabilities}
          disabled={inputDisabled || configurationDisabled}
          onAddExternalFiles={onAddExternalFiles}
          onPickWorkspaceReferences={onPickWorkspaceReferences}
        />
        <Tooltip content={primaryActionLabel}><button
          type="button"
          className={`desktop-agent-composer-action${running ? " is-stop" : ""}`}
          aria-label={primaryActionLabel}
          aria-busy={primaryActionBusy || undefined}
          disabled={primaryActionDisabled}
          onClick={onPrimaryAction}
        >
          {primaryActionBusy
            ? <LoaderCircle size={15} className="desktop-agent-spin" />
            : running
              ? <Square size={10} fill="currentColor" />
              : <ArrowUp size={15} strokeWidth={2.1} />}
        </button></Tooltip>
      </div>
    </div>
  );
}
