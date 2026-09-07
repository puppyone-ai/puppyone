/** Renderer-only, disposable view memory. Never a Harness history or wire payload. */
export type AgentTimelineScrollAnchor =
  | { kind: "row"; rowId: string; offset: number }
  | { kind: "absolute"; scrollTop: number };

export type AgentViewportGeometry = {
  layoutSignature: string;
  anchor: AgentTimelineScrollAnchor | null;
};
