import { Square } from "lucide-react";
import type { Workspace } from "../lib/mockData";

type RecordingProps = {
  workspace: Workspace;
  onStop: () => void;
};

export function Recording({ workspace, onStop }: RecordingProps) {
  return (
    <section className="single-stage">
      <div className="recording-dot" />
      <div className="section-kicker">Recording</div>
      <h2>{workspace.name}</h2>
      <p className="stage-copy">Claude Code is changing files in this protected folder.</p>

      <div className="live-metrics">
        <div>
          <span>3</span>
          <span>modified</span>
        </div>
        <div>
          <span>1</span>
          <span>created</span>
        </div>
        <div>
          <span>0</span>
          <span>deleted</span>
        </div>
      </div>

      <button className="primary-action stop" type="button" onClick={onStop}>
        <Square size={16} />
        <span>End session</span>
      </button>
    </section>
  );
}
