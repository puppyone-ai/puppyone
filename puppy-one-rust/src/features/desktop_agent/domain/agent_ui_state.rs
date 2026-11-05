//! `domain/agent-ui-state.ts`: Renderer-only, disposable view memory. Never
//! a Harness history or wire payload.

/// `AgentTimelineScrollAnchor`.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentTimelineScrollAnchor {
    Row { row_id: String, offset: f64 },
    Absolute { scroll_top: f64 },
}

/// `AgentViewportGeometry`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentViewportGeometry {
    pub layout_signature: String,
    pub anchor: Option<AgentTimelineScrollAnchor>,
}
