import { ArrowLeft, FilePlus2, FileText, FolderSymlink, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { changes, sessions, type Change, type Workspace } from "../lib/mockData";

type ChangesWorkspaceProps = {
  workspace: Workspace;
  onBackToData: () => void;
};

export function ChangesWorkspace({ workspace, onBackToData }: ChangesWorkspaceProps) {
  const [selectedChangeId, setSelectedChangeId] = useState(changes[0].id);
  const activeSession = sessions.find((session) => session.workspaceId === workspace.id) ?? sessions[0];
  const selectedChange = useMemo(
    () => changes.find((change) => change.id === selectedChangeId) ?? changes[0],
    [selectedChangeId],
  );

  return (
    <section className="changes-workspace">
      <header className="projects-header">
        <div className="header-left">
          <button className="icon-button" type="button" aria-label="Back to data" onClick={onBackToData}>
            <ArrowLeft size={15} />
          </button>
          <div className="breadcrumb">
            <span>{workspace.name}</span>
            <span>
              <span className="breadcrumb-separator">/</span>
              Changes
            </span>
            <span className="last">
              <span className="breadcrumb-separator">/</span>
              {activeSession.agent}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button className="danger-action compact" type="button">
            <RotateCcw size={15} />
            <span>Undo session</span>
          </button>
        </div>
      </header>

      <div className="changes-content">
        <aside className="change-list-panel">
          <div className="browser-toolbar">
            <div>
              <span className="section-kicker">Session</span>
              <h1>{activeSession.startedAt} · {activeSession.agent}</h1>
            </div>
          </div>

          <div className="review-list">
            {changes.map((change) => (
              <button
                key={change.id}
                className={`review-row ${change.id === selectedChangeId ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedChangeId(change.id)}
              >
                <ChangeIcon change={change} />
                <span className="review-copy">
                  <strong>{change.path}</strong>
                  <small>{change.detail}</small>
                </span>
                <span className={`risk-chip ${change.risk}`}>{change.risk}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="diff-preview-panel">
          <div className="file-preview-header">
            <div className="file-preview-title">
              <ChangeIcon change={selectedChange} />
              <div>
                <h2>{selectedChange.path}</h2>
                <span>{selectedChange.kind} · {selectedChange.risk} risk</span>
              </div>
            </div>
            <div className="file-preview-actions">
              <button className="secondary-action compact" type="button">
                Keep
              </button>
              <button className="danger-action compact" type="button">
                <RotateCcw size={15} />
                <span>Restore</span>
              </button>
            </div>
          </div>

          <div className="diff-grid">
            <DiffPane title="Before" content={selectedChange.before ?? ""} variant="before" />
            <DiffPane title="After" content={selectedChange.after ?? ""} variant="after" />
          </div>
        </main>
      </div>
    </section>
  );
}

function DiffPane({
  title,
  content,
  variant,
}: {
  title: string;
  content: string;
  variant: "before" | "after";
}) {
  return (
    <section className={`diff-pane ${variant}`}>
      <header>{title}</header>
      <pre>{content || "No file existed at this path."}</pre>
    </section>
  );
}

function ChangeIcon({ change }: { change: Change }) {
  if (change.kind === "created") return <FilePlus2 size={17} />;
  if (change.kind === "deleted") return <Trash2 size={17} />;
  if (change.kind === "moved") return <FolderSymlink size={17} />;
  return <FileText size={17} />;
}
