import { ArrowLeft, FilePlus2, FileText, FolderSymlink, RotateCcw, Trash2 } from "lucide-react";
import { changes } from "../lib/mockData";
import type { Change, Session, Workspace } from "../lib/mockData";

type ReviewProps = {
  session: Session;
  workspace: Workspace;
  onBack: () => void;
};

export function Review({ session, workspace, onBack }: ReviewProps) {
  const firstChange = changes[0];

  return (
    <section className="review-grid">
      <div className="review-list-panel">
        <div className="review-header">
          <button className="icon-button" type="button" aria-label="Back" onClick={onBack}>
            <ArrowLeft size={17} />
          </button>
          <div>
            <div className="section-kicker">{workspace.name}</div>
            <h2>{session.agent}</h2>
          </div>
        </div>

        <div className="change-list">
          {changes.map((change) => (
            <button key={change.id} className="change-row" type="button">
              <ChangeIcon change={change} />
              <span className="change-copy">
                <span>{change.path}</span>
                <span>{change.detail}</span>
              </span>
              <span className={`risk-chip ${change.risk}`}>{change.risk}</span>
            </button>
          ))}
        </div>

        <button className="danger-action full" type="button">
          <RotateCcw size={16} />
          <span>Undo all changes</span>
        </button>
      </div>

      <div className="preview-panel">
        <div className="section-kicker">Preview</div>
        <h2>{firstChange.path}</h2>
        <div className="preview-split">
          <div>
            <span>Before</span>
            <pre>{`contract_status: signed\namount: 48000\nowner: Client A`}</pre>
          </div>
          <div>
            <span>After</span>
            <pre>{`File deleted by session.\nBackup exists locally.\nRestore is available.`}</pre>
          </div>
        </div>
        <div className="preview-actions">
          <button className="secondary-action" type="button">
            Restore selected
          </button>
          <button className="secondary-action" type="button">
            Keep change
          </button>
        </div>
      </div>
    </section>
  );
}

function ChangeIcon({ change }: { change: Change }) {
  if (change.kind === "created") return <FilePlus2 size={17} />;
  if (change.kind === "deleted") return <Trash2 size={17} />;
  if (change.kind === "moved") return <FolderSymlink size={17} />;
  return <FileText size={17} />;
}
