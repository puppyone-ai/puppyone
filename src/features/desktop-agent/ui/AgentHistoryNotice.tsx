import { Info } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { agentHistoryNotice } from "./agent-history-presentation";

export function AgentHistoryNotice({ notice }: { notice: ReturnType<typeof agentHistoryNotice> }) {
  const { t } = useLocalization();
  if (!notice) return null;
  return (
    <details className="desktop-agent-history-notice" data-history-notice={notice.kind}>
      <summary><Info size={14} aria-hidden="true" /><span role="status">{t(notice.messageKey)}</span></summary>
      {notice.reasonKeys.map((key) => <p key={key}>{t(key)}</p>)}
    </details>
  );
}
