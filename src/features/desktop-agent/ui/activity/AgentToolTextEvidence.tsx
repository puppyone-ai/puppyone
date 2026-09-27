import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { createAgentToolEvidencePreview } from "../../domain/agent-tool-evidence";

type AgentToolTextEvidenceProps = {
  text: string;
  className?: string;
  dir?: "ltr" | "rtl" | "auto";
};

export function AgentToolTextEvidence({ text, className = "desktop-agent-tool-output", dir }: AgentToolTextEvidenceProps) {
  const { t, formatNumber } = useLocalization();
  const [copied, setCopied] = useState(false);
  const preview = useMemo(() => createAgentToolEvidencePreview(text), [text]);
  const marker = preview.truncated
    ? t("agent.activity.outputOmitted", {
        lines: formatNumber(preview.omittedLines),
        characters: formatNumber(preview.omittedChars),
      })
    : "";
  const visibleText = preview.truncated
    ? [preview.head, marker, preview.tail].filter(Boolean).join("\n")
    : preview.head;

  return (
    <div
      className="desktop-agent-tool-text-evidence"
      data-source-length={preview.sourceLength}
      data-source-lines={preview.totalLines}
      data-truncated={preview.truncated ? "true" : "false"}
    >
      <pre className={className} data-po-scrollbar="content" dir={dir}>{visibleText}</pre>
      {preview.truncated && (
        <button
          type="button"
          className="desktop-agent-tool-copy"
          aria-label={copied ? t("agent.activity.outputCopied") : t("agent.activity.copyFullOutput")}
          data-tooltip={copied ? t("agent.activity.outputCopied") : t("agent.activity.copyFullOutput")}
          onClick={async () => {
            if (!navigator.clipboard) return;
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch (error) {
              console.warn("Desktop Agent output copy failed", error);
            }
          }}
        >
          <Copy size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
