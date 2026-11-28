//! `desktop-agent`: the Agent window. Its application layer talks to the
//! Agent host through a typed client port, its views read the typed display
//! model, and [`workbench`] contributes the chat tab to the Workbench. Its
//! chat views are shared: the hosted Agent's conversation (in the Cloud
//! feature) composes them over its own controller.
mod application;
mod domain;
#[cfg(any(test, feature = "dev-capture"))]
mod fixtures;
mod infrastructure;
mod ui;
mod workbench;

pub use application::ui_runtime::UiRuntime;
pub use domain::agent_workspace_path::resolve_agent_workspace_provider_path;

pub use domain::agent_chat_history_target::{
    AuxiliaryWorkbenchHistoryTarget as HistoryTarget, create_agent_chat_history_target,
};
pub use ui::agent_conversation_history::{
    HistoryBrowser, HistoryBrowserEvent, format_history_date,
};
pub use ui::panel::{AgentChatTabPanel, bind_keys};
#[cfg(feature = "dev-capture")]
pub use workbench::{AgentChatItem, lab_history_browser};
// What other features' tests drive.
#[cfg(test)]
pub use domain::agent_chat_history_target::AgentChatHistoryPayload;
pub use workbench::{AgentChats, OpenFailure};

// The shared chat surface: what a conversation container (the hosted
// Agent's) composes over its own controller.
pub use application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, ReplicaStatus,
};
pub use application::conversation_history_controller::ConversationHistoryState;
pub use application::conversation_history_source::ConversationHistorySource;
pub use domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId, AgentSessionControlSelection,
    derive_agent_session_controls,
};
pub use ui::agent_chat_view_model::AgentChatViewModel;
pub use ui::agent_theme::AgentTheme;
pub use ui::composer::{ComposerEvent, ComposerInput, ComposerView, can_submit, mime_for};
pub use ui::docks::{DockEvent, DocksInput, DocksView};
pub use ui::elements::{ButtonTone, agent_button, mention_chip};
pub use ui::empty_state::EmptyStateView;
pub use ui::panel::{
    AgentChatTabPresentation, SeededAttachment, SeededPromptSegment, SeededSubmission,
    SubmitPrompt, default_chat_view_model, filter_launcher_inspection,
};
pub use ui::pickers::{PickerEvent, SessionPickers};
pub use ui::provider_notices::ProviderNoticesView;
pub use ui::transcript::{TranscriptEvent, TranscriptInput, TranscriptView};
pub use workbench::{agent_chat_close_copy, present_agent_chat_workbench_item};
