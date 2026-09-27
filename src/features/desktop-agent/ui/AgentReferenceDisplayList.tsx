import { Tooltip } from "@puppyone/shared-ui";
import { File, Folder, Image, Paperclip } from "lucide-react";
import type { AgentReferenceDisplay } from "../domain/agent-contract";
import { isAgentMediaReference } from "../domain/agent-prompt-mentions";

export function AgentReferenceDisplayList({ references }: { references: AgentReferenceDisplay[] }) {
  if (references.length === 0) return null;
  return (
    <div className="desktop-agent-message-references" role="list">
      {references.map((reference) => (
        <Tooltip content={reference.relativePath || reference.displayName} overflowOnly key={reference.id}><span dir="auto" role="listitem">
          {reference.kind === "workspace-directory"
            ? <Folder size={12} aria-hidden="true" />
            : reference.kind === "workspace-file"
              ? <File size={12} aria-hidden="true" />
              : isAgentMediaReference(reference)
                ? <Image size={12} aria-hidden="true" />
                : <Paperclip size={12} aria-hidden="true" />}
          <span>{reference.displayName}</span>
        </span></Tooltip>
      ))}
    </div>
  );
}
