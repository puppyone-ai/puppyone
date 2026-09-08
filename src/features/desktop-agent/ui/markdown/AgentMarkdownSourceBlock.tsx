import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useLocalization } from "@puppyone/localization/react";

export function AgentMarkdownSourceBlock({ language, source }: Readonly<{ language: string; source: string }>) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const copyLabel = copied ? t("common.action.copied") : t("common.action.copy");
  return (
    <div className="desktop-agent-code-block" data-language={language || "text"}>
      <div className="desktop-agent-code-toolbar">
        <span className="desktop-agent-code-language">{language || "text"}</span>
        <button type="button" className="desktop-agent-code-copy" aria-label={copyLabel} title={copyLabel} onClick={() => {
          const copy = navigator.clipboard?.writeText(source);
          void copy?.then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_200);
          }).catch(() => {});
        }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      </div>
      <pre data-po-scrollbar="content"><code>{source}</code></pre>
    </div>
  );
}
