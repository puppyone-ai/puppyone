import { ShieldAlert } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentApproval } from "../domain/agent-projection-types";
import type { AgentApprovalDecision } from "../domain/agent-contract";

type AgentApprovalDockProps = {
  approval: AgentApproval;
  queueLength: number;
  resolving: boolean;
  onResolve: (decision: AgentApprovalDecision) => void;
  runtimeLabel?: string;
};

export function AgentApprovalDock({ approval, queueLength, resolving, onResolve, runtimeLabel: runtimeLabelProp }: AgentApprovalDockProps) {
  const { t } = useLocalization();
  const runtimeLabel = runtimeLabelProp || t("agent.name");
  const canAllowForSession = approval.availableDecisions.includes("acceptForSession");
  const title = approval.title.trim() || t("agent.approval.required");
  const reason = distinctApprovalReason(approval.reason, title);
  return (
    <section className="desktop-agent-approval" aria-label={t("agent.approval.ariaLabel", { agent: bidiIsolate(runtimeLabel) })} aria-live="polite">
      <header className="desktop-agent-approval-heading">
        <span className="desktop-agent-approval-icon" aria-hidden="true">
          <ShieldAlert size={14} strokeWidth={1.7} />
        </span>
        <strong dir="auto">{title}</strong>
        {queueLength > 1 && <small>{t("agent.approval.pending", { count: queueLength })}</small>}
      </header>
      {(approval.command
        || approval.cwd
        || approval.networkApprovalContext
        || approval.grantRoot
        || (!approval.command && approval.commandActions.length > 0)
        || reason
        || approval.policyChangeRequested) && (
        <div className="desktop-agent-approval-details">
          {approval.command && <code data-po-scrollbar="content">{approval.command}</code>}
          {approval.cwd && <div className="desktop-agent-approval-scope">{t("agent.approval.inPath", { path: bidiIsolate(approval.cwd) })}</div>}
          {approval.networkApprovalContext && (
            <div className="desktop-agent-approval-material">
              <span>{t("agent.approval.networkTarget")}</span>
              <code data-po-scrollbar="content" dir="ltr">{approval.networkApprovalContext.protocol}://{approval.networkApprovalContext.host}</code>
            </div>
          )}
          {approval.grantRoot && (
            <div className="desktop-agent-approval-material">
              <span>{t("agent.approval.writeScope")}</span>
              <code data-po-scrollbar="content" dir="ltr">{approval.grantRoot}</code>
            </div>
          )}
          {!approval.command && approval.commandActions.length > 0 && (
            <ul className="desktop-agent-approval-actions-list">
              {approval.commandActions.slice(0, 5).map((action, index) => (
                <li key={`${String(action.type ?? "action")}:${index}`}>{approvalActionLabel(action)}</li>
              ))}
            </ul>
          )}
          {reason && <p>{reason}</p>}
          {approval.policyChangeRequested && (
            <p className="desktop-agent-approval-policy-note">{t("agent.approval.policyNote", { agent: bidiIsolate(runtimeLabel) })}</p>
          )}
        </div>
      )}
      <div className="desktop-agent-approval-actions">
        <button
          type="button"
          className="desktop-agent-button is-secondary"
          disabled={resolving}
          onClick={() => onResolve("decline")}
          autoFocus
        >
          {t("agent.approval.deny")}
        </button>
        {canAllowForSession && (
          <button
            type="button"
            className="desktop-agent-button is-secondary"
            disabled={resolving}
            onClick={() => onResolve("acceptForSession")}
          >
            {t("agent.approval.allowSession")}
          </button>
        )}
        <button
          type="button"
          className="desktop-agent-button is-primary"
          disabled={resolving}
          onClick={() => onResolve("accept")}
        >
          {t("agent.approval.allowOnce")}
        </button>
      </div>
    </section>
  );
}

function distinctApprovalReason(reason: string | null, title: string) {
  if (!reason) return null;
  const normalizedReason = normalizeApprovalCopy(reason);
  return normalizedReason && normalizedReason !== normalizeApprovalCopy(title) ? reason.trim() : null;
}

function normalizeApprovalCopy(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function approvalActionLabel(action: Record<string, unknown>) {
  const type = typeof action.type === "string" ? action.type : "action";
  const name = typeof action.name === "string" ? action.name : null;
  const path = typeof action.path === "string" ? action.path : null;
  const command = typeof action.command === "string" ? action.command : null;
  return [name || type, path || command].filter(Boolean).join(": ");
}
