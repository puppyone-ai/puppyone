import { AlertTriangle, Play, RotateCcw } from "lucide-react";
import type { Session, Workspace } from "../lib/mockData";

type WorkspaceHomeProps = {
  sessions: Session[];
  selectedSessionId: string;
  selectedWorkspace: Workspace;
  onSelectSession: (sessionId: string) => void;
  onStartRecording: () => void;
  onReview: () => void;
  onUndo: () => void;
};

export function WorkspaceHome({
  sessions,
  selectedSessionId,
  selectedWorkspace,
  onSelectSession,
  onStartRecording,
  onReview,
  onUndo,
}: WorkspaceHomeProps) {
  const activeSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];

  return (
    <>
      <section className="session-column">
        <div className="section-header">
          <div>
            <div className="section-kicker">Protected folder</div>
            <h2>{selectedWorkspace.name}</h2>
          </div>
          <button className="primary-action compact" type="button" onClick={onStartRecording}>
            <Play size={16} />
            <span>Start session</span>
          </button>
        </div>

        <div className="timeline-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`session-row ${session.id === selectedSessionId ? "active" : ""}`}
              type="button"
              onClick={() => onSelectSession(session.id)}
            >
              <span className={`risk-bar ${session.risk}`} />
              <span className="session-main">
                <span className="session-title">
                  {session.startedAt} · {session.agent}
                </span>
                <span className="session-meta">
                  {session.summary.modified} modified · {session.summary.created} created ·{" "}
                  {session.summary.deleted} deleted
                </span>
              </span>
              <span className={`state-pill ${session.state}`}>{session.state.replace("-", " ")}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="detail-panel">
        <div className="section-kicker">Session detail</div>
        <h2>{activeSession.agent}</h2>
        <div className="summary-grid">
          <Stat label="Modified" value={activeSession.summary.modified} />
          <Stat label="Created" value={activeSession.summary.created} />
          <Stat label="Deleted" value={activeSession.summary.deleted} />
          <Stat label="Moved" value={activeSession.summary.moved} />
        </div>

        <div className={`risk-callout ${activeSession.risk}`}>
          <AlertTriangle size={18} />
          <div>
            <strong>{activeSession.risk === "high" ? "High risk" : "Review recommended"}</strong>
            <span>Binary files, deletes, or later edits may require confirmation.</span>
          </div>
        </div>

        <div className="detail-actions">
          <button className="secondary-action" type="button" onClick={onReview}>
            Review changes
          </button>
          <button className="danger-action" type="button" onClick={onUndo}>
            <RotateCcw size={16} />
            <span>Undo session</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-tile">
      <span>{value}</span>
      <span>{label}</span>
    </div>
  );
}
