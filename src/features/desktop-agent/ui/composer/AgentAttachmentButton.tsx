import { Tooltip } from "@puppyone/shared-ui";
import { Paperclip } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentReferenceInputCapabilities } from "../../domain/agent-contract";
import {
  acceptedAgentAttachmentPickerTypes,
  hasAgentAttachmentSupport,
} from "../../domain/agent-reference-capabilities";

type AgentAttachmentButtonProps = {
  capabilities?: AgentReferenceInputCapabilities;
  disabled?: boolean;
  onAddExternalFiles?: (files: File[]) => void;
  onPickWorkspaceReferences?: () => void;
};

/** Direct, one-step picker entry for the same ingestion path used by drag and paste. */
export function AgentAttachmentButton({
  capabilities,
  disabled = false,
  onAddExternalFiles,
  onPickWorkspaceReferences,
}: AgentAttachmentButtonProps) {
  const { t } = useLocalization();
  const inputRef = useRef<HTMLInputElement>(null);
  const externalAvailable = hasAgentAttachmentSupport(capabilities);
  const workspaceAvailable = Boolean(capabilities?.workspace.files || capabilities?.workspace.directories);
  const available = externalAvailable || workspaceAvailable;
  const label = externalAvailable ? t("agent.reference.addFromComputer") : t("agent.reference.addFromWorkspace");

  const choose = () => {
    if (disabled || !available) return;
    if (externalAvailable) inputRef.current?.click();
    else onPickWorkspaceReferences?.();
  };
  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onAddExternalFiles?.(files);
  };

  return (
    <div className="desktop-agent-attachment-control">
      <Tooltip content={label}><button
        type="button"
        className="desktop-agent-reference-trigger"
        aria-label={label}
        disabled={disabled || !available}
        onClick={choose}
      >
        <Paperclip size={16} strokeWidth={1.7} aria-hidden="true" />
      </button></Tooltip>
      <input
        ref={inputRef}
        className="desktop-agent-visually-hidden"
        type="file"
        multiple
        tabIndex={-1}
        accept={acceptedAgentAttachmentPickerTypes(capabilities).join(",") || undefined}
        onChange={onFilesSelected}
      />
    </div>
  );
}
