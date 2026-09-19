import { CircleAlert, Image, LoaderCircle, X } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentDraftReference } from "../../domain/agent-contract";
import { isAgentMediaReference } from "../../domain/agent-prompt-mentions";
import { localizedReferenceError } from "./agent-reference-presentation";

type AgentVisualAttachmentListProps = {
  references: AgentDraftReference[];
  getPreviewUrl?: (id: string) => string | null;
  onRemove?: (id: string) => void;
};

/**
 * The composer shelf is reserved for visual inputs. Path-addressable files and
 * directories live in the prompt editor as atomic mentions instead.
 */
export function AgentVisualAttachmentList({
  references,
  getPreviewUrl,
  onRemove,
}: AgentVisualAttachmentListProps) {
  const { t } = useLocalization();
  const visualAttachments = references.filter(isAgentMediaReference);
  if (visualAttachments.length === 0) return null;
  return (
    <div className="desktop-agent-visual-attachments" role="list" aria-label={t("agent.reference.selected")}>
      {visualAttachments.map((reference) => (
        <VisualAttachmentCard
          key={reference.id}
          reference={reference}
          previewUrl={getPreviewUrl?.(reference.id) ?? null}
          onRemove={() => onRemove?.(reference.id)}
        />
      ))}
    </div>
  );
}

function VisualAttachmentCard({ reference, previewUrl, onRemove }: {
  reference: AgentDraftReference;
  previewUrl: string | null;
  onRemove: () => void;
}) {
  const { t } = useLocalization();
  const statusLabel = reference.status === "resolving"
    ? t("agent.reference.resolving")
    : reference.status === "error" ? localizedReferenceError(reference, t) : "";
  const rawError = reference.status === "error" ? reference.error?.message || "" : "";
  const details = [statusLabel, rawError !== statusLabel ? rawError : ""].filter(Boolean);

  return (
    <div
      className={`desktop-agent-visual-attachment is-${reference.status}`}
      dir="auto"
      role="listitem"
      title={details.join("\n") || undefined}
      aria-label={[reference.displayName, ...details].join(": ")}
    >
      <span className="desktop-agent-visual-attachment-preview">
        {previewUrl
          ? <img src={previewUrl} alt="" draggable={false} />
          : <Image size={22} aria-hidden="true" />}
      </span>
      {reference.status === "resolving" && (
        <span className="desktop-agent-visual-attachment-status" aria-hidden="true">
          <LoaderCircle size={13} className="desktop-agent-spin" />
        </span>
      )}
      {reference.status === "error" && (
        <span className="desktop-agent-visual-attachment-status is-error" aria-hidden="true">
          <CircleAlert size={13} />
        </span>
      )}
      <span className="desktop-agent-visual-attachment-actions">
        <button
          type="button"
          aria-label={t("agent.reference.remove", { name: bidiIsolate(reference.displayName) })}
          title={t("agent.reference.remove", { name: bidiIsolate(reference.displayName) })}
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
