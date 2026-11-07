//! `domain/agent-ui-state.ts`: Renderer-only, disposable view memory. Never
//! a Harness history or wire payload.

/// `AgentTimelineScrollAnchor`.
#[derive(Clone, Debug, PartialEq)]
/// Product views keep their own scroll position; the anchors are the ported
/// model, exercised by its tests.
pub enum AgentTimelineScrollAnchor {
    #[cfg(test)]
    Row { row_id: String, offset: f64 },
    #[cfg(test)]
    Absolute { scroll_top: f64 },
}

/// `AgentViewportGeometry`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentViewportGeometry {
    pub layout_signature: String,
    pub anchor: Option<AgentTimelineScrollAnchor>,
}
