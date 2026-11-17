//! `AgentApprovalDock` and `AgentQuestionDock` (`styles/blocking.css`):
//! pending interactions sit above the composer and cannot scroll away. The
//! container hands them a [`DocksInput`] and hears the person's decision as
//! a [`DockEvent`]; the docks keep the answers being written.
use super::agent_chat_view_model::AgentChatViewModel;
use super::agent_theme::AgentTheme;
use crate::agent::contract::dto::{Approval, Question};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::features::desktop_agent::application::agent_session_controller::QuestionResolution;
use std::collections::HashMap;

mod approval;
mod question;
use crate::theme;
use crate::ui::form_input::TextInput;
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;

/// What the docks show: the request on top of each queue, and whether its
/// answer is on its way.
#[derive(Clone, Default)]
pub struct DocksInput {
    pub approval: Option<Approval>,
    pub approvals: usize,
    pub approval_resolving: bool,
    pub question: Option<Question>,
    pub questions: usize,
    pub question_resolving: bool,
    pub runtime_label: String,
}
impl DocksInput {
    pub fn of(state: &AgentControllerState, view: &AgentChatViewModel) -> Self {
        Self {
            approval: view.approval.clone(),
            approvals: state.projection.approvals.len(),
            approval_resolving: view.approval_resolving,
            question: view.question.clone(),
            questions: state.projection.questions.len(),
            question_resolving: view.question_resolving,
            runtime_label: view.runtime.runtime_label.clone(),
        }
    }
}

/// The person's decision.
pub enum DockEvent {
    /// `decision` (`accept`, `acceptForSession`, `decline`, …) on `request_id`.
    Approve {
        request_id: String,
        decision: &'static str,
    },
    Answer(QuestionResolution),
}
impl EventEmitter<DockEvent> for DocksView {}

pub struct DocksView {
    data: DocksInput,
    scroll: ScrollHandle,
    /// `AgentQuestionDock`'s answers per question index, per request.
    question_answers: HashMap<String, HashMap<usize, Vec<String>>>,
    question_inputs: HashMap<String, Entity<TextInput>>,
}

impl Default for DocksView {
    fn default() -> Self {
        Self {
            data: DocksInput::default(),
            scroll: ScrollHandle::new(),
            question_answers: HashMap::new(),
            question_inputs: HashMap::new(),
        }
    }
}

impl DocksView {
    pub fn set_input(&mut self, data: DocksInput, cx: &mut Context<Self>) {
        self.data = data;
        cx.notify();
    }
    pub(super) fn dock_card(&self, a: &AgentTheme) -> Stateful<Div> {
        let m = theme::ty();
        v_flex()
            .id("agent-interaction-dock")
            .relative()
            .w_full()
            .max_w(px(900.))
            .mx_auto()
            .max_h(px(360.))
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .flex_shrink_0()
            .p(px(10.))
            .rounded(px(8.))
            .border_1()
            .border_color(a.blocking_border)
            .bg(a.blocking_surface)
            .text_size(px(m.left.content))
            .text_color(a.text)
    }
}

impl Render for DocksView {
    /// The approval dock, then the question dock, 8px apart in the dock
    /// region (`desktop-agent-dock-region`).
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let data = self.data.clone();
        let approval = data
            .approval
            .as_ref()
            .map(|approval| self.render_approval_dock(approval, data.approvals, cx));
        let question = data
            .question
            .as_ref()
            .map(|question| self.render_question_dock(question, data.questions, window, cx));
        v_flex().gap(px(8.)).children(approval).children(question)
    }
}
