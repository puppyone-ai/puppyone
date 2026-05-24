import { AlertTriangle, FilePlus2, FileText, RotateCcw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Session, Workspace } from "../lib/mockData";

type ReceiptProps = {
  session: Session;
  workspace: Workspace;
  onReview: () => void;
  onUndo: () => void;
};

export function Receipt({ session, workspace, onReview, onUndo }: ReceiptProps) {
  return (
    <section className="receipt-stage">
      <div className="receipt-header">
        <div>
          <div className="section-kicker">{workspace.name}</div>
          <h2>{session.agent} changed files</h2>
        </div>
        <span className={`state-pill ${session.state}`}>{session.state.replace("-", " ")}</span>
      </div>

      <div className="receipt-counts">
        <Count icon={<FileText size={18} />} value={session.summary.modified} label="modified" />
        <Count icon={<FilePlus2 size={18} />} value={session.summary.created} label="created" />
        <Count icon={<Trash2 size={18} />} value={session.summary.deleted} label="deleted" />
      </div>

      <div className="risk-callout high">
        <AlertTriangle size={18} />
        <div>
          <strong>High-risk changes</strong>
          <span>Deleted contracts/final_contract.docx and modified finance/2026_budget.xlsx.</span>
        </div>
      </div>

      <div className="receipt-actions">
        <button className="secondary-action" type="button" onClick={onReview}>
          Review changes
        </button>
        <button className="danger-action strong" type="button" onClick={onUndo}>
          <RotateCcw size={16} />
          <span>Undo session</span>
        </button>
      </div>
    </section>
  );
}

function Count({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="receipt-count">
      {icon}
      <span>{value}</span>
      <span>{label}</span>
    </div>
  );
}
