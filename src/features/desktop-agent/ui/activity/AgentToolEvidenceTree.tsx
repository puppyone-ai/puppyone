import type { ReactNode } from "react";

type AgentToolEvidenceNodeKind = "command" | "request" | "result";

export function AgentToolEvidenceTree({ children }: { children: ReactNode }) {
  return <div className="desktop-agent-evidence-tree">{children}</div>;
}

export function AgentToolEvidenceNode({
  kind,
  marker,
  tone,
  label,
  children,
}: {
  kind: AgentToolEvidenceNodeKind;
  marker?: ReactNode;
  tone?: "addition" | "deletion";
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className={`desktop-agent-evidence-node is-${kind}${tone ? ` is-${tone}` : ""}`} data-evidence-kind={kind}
      role={label ? "group" : undefined} aria-label={label}>
      {marker !== undefined && <span className="desktop-agent-evidence-marker" aria-hidden="true">{marker}</span>}
      <div className="desktop-agent-evidence-content">{children}</div>
    </div>
  );
}
