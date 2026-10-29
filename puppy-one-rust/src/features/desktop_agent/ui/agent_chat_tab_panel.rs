#[path = "agent_activity.rs"]
mod agent_activity;
#[path = "agent_blocking_interaction.rs"]
mod agent_blocking_interaction;
#[path = "agent_composer.rs"]
mod agent_composer;
#[path = "agent_composer_references.rs"]
mod agent_composer_references;
#[path = "agent_history.rs"]
mod agent_history;
#[path = "agent_session_control_picker.rs"]
mod agent_session_control_picker;
#[path = "agent_status.rs"]
mod agent_status;
#[path = "agent_surface_header.rs"]
mod agent_surface_header;
use super::agent_theme;
use crate::ui::appearance::ActiveAppearance;
pub use agent_surface_header::AgentChatEvent;
#[path = "agent_transcript.rs"]
mod agent_transcript;
#[cfg(feature = "dev-capture")]
#[path = "visual_fixture.rs"]
mod visual_fixture;
use super::super::{
    application::agent_session_controller::AgentSessionController,
    domain::agent_chat_presentation::message_preview,
    infrastructure::native::{native_agent_client, native_attachment_client},
};
use crate::{
    agent::{
        connections::local_agent_inventory::Installation,
        domain::agent_session_model::{Decision, InteractionKind, Resolution, State},
    },
    theme::Theme,
    ui::form_input::TextInput,
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use std::{collections::HashMap, path::PathBuf, time::Duration};
actions!(agent, [SendMessage]);
pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-enter", SendMessage, Some("AgentChat")),
        KeyBinding::new("ctrl-enter", SendMessage, Some("AgentChat")),
    ]);
}
pub struct AgentChat {
    installation: Installation,
    root: PathBuf,
    wake: Wake,
    pub session: AgentSessionController,
    composer: Entity<TextInput>,
    answers: HashMap<String, Entity<TextInput>>,
    /// Options chosen per pending question (`AgentQuestionDock` answers).
    question_choices: HashMap<String, Vec<String>>,
    transcript: ListState,
    follow: bool,
    /// Timeline rows (`domain::agent_timeline`) and their list signatures.
    rows: Vec<super::super::domain::agent_timeline::Row>,
    row_signatures: Vec<(String, blake3::Hash)>,
    /// Open standalone disclosures (reasoning, plan, overflow tools).
    expanded: std::collections::HashSet<String>,
    /// The tool rail's single open item and open `+N` panels, per row.
    rail_selected: HashMap<String, String>,
    rail_overflow: std::collections::HashSet<String>,
    run_summary_open: bool,
    unread: usize,
    transcript_width: f32,
    attachment_rx: Option<
        std::sync::mpsc::Receiver<
            Result<Vec<crate::agent::domain::reference_input::Reference>, String>,
        >,
    >,
    attachment_thread: Option<String>,
    history_filter: Entity<TextInput>,
    rename_input: Entity<TextInput>,
    show_rename: bool,
    logo_turns: u32,
    /// `AgentStatusCard` diagnostics disclosure.
    diagnostics_open: bool,
    image_previews: HashMap<String, std::sync::Arc<Image>>,
    pending_resume: Option<String>,
    /// The open session-control picker, its keyboard row and search field.
    picker_open: Option<&'static str>,
    picker_active: Option<usize>,
    picker_query: Entity<TextInput>,
    picker_focus: FocusHandle,
    /// `AgentHistoryNotice` disclosure and the empty-state logo press.
    history_notice_open: bool,
    logo_pressed: bool,
    drafts: super::super::application::session_draft_store::SessionDraftStore,
}
impl AgentChat {
    pub fn new(
        installation: Installation,
        root: PathBuf,
        history: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self::with_client_factory(
            installation,
            root,
            history,
            window,
            cx,
            native_agent_client::create,
        )
    }
    fn with_client_factory(
        installation: Installation,
        root: PathBuf,
        history: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
        create: impl FnOnce(
            Installation,
            PathBuf,
            bool,
            Wake,
        )
            -> Box<dyn crate::agent::runtime::agent_runtime_port::AgentRuntimePort>,
    ) -> Self {
        let (wake, rx) = Wake::channel();
        let timer = wake.clone();
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, _, cx| {
                        let before = s.session.snapshot().revision;

                        s.session.poll();
                        if !s.session.busy()
                            && s.session.snapshot().state != State::Failed
                            && let Some(id) = s.pending_resume.take()
                        {
                            s.session.resume(id);
                        }
                        s.sync_draft(cx);
                        if s.session.snapshot().revision != before {
                            s.refresh_transcript();
                            cx.notify();
                        }
                        if let Some(result) =
                            s.attachment_rx.as_ref().and_then(|rx| rx.try_recv().ok())
                        {
                            s.attachment_rx = None;
                            match result {
                                Ok(refs) if s.attachment_thread == s.session.snapshot().thread => {
                                    s.session.stage(refs)
                                }
                                Ok(_) => {
                                    s.session.draft_error = Some(
                                        crate::localization::t("native.agent.attachmentsChanged")
                                            .into(),
                                    )
                                }
                                Err(error) => s.session.draft_error = Some(error),
                            }
                            cx.notify();
                        }
                        if s.session.busy() {
                            timer.after(Duration::from_secs(1));
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let composer = cx.new(|cx| {
            TextInput::new(
                crate::localization::t("agent.composer.placeholder.default"),
                true,
                64_000,
                window,
                cx,
            )
        });
        composer.update(cx, |i, _| {
            // One 1.5em line at rest; Enter sends, Shift+Enter breaks the line.
            let size = crate::theme::ty().left.content;
            i.prompt_text = Some((size, size * 1.5));
            i.min_height = size * 1.5;
            i.appearance = false;
            i.submit_on_enter = true;
        });
        cx.subscribe_in(
            &composer,
            window,
            |s, _, event: &crate::ui::form_input::InputEvent, window, cx| {
                if matches!(event, crate::ui::form_input::InputEvent::Submit) {
                    s.send(window, cx);
                }
                cx.notify();
            },
        )
        .detach();
        let session = AgentSessionController::new(create(
            installation.clone(),
            root.clone(),
            history,
            wake.clone(),
        ));
        let transcript = ListState::new(0, ListAlignment::Top, px(300.));
        let weak = cx.entity().downgrade();
        transcript.set_scroll_handler(move |event, _, cx| {
            let _ = weak.update(cx, |s, cx| {
                s.follow = event.visible_range.end >= event.count;
                cx.notify();
            });
        });
        let history_filter = cx.new(|cx| {
            TextInput::new(
                crate::localization::t("agent.history.search"),
                false,
                500,
                window,
                cx,
            )
        });
        let rename_input = cx.new(|cx| {
            TextInput::new(
                crate::localization::t("native.agent.conversationName"),
                false,
                160,
                window,
                cx,
            )
        });
        cx.observe(&history_filter, |_, _, cx| cx.notify()).detach();
        let picker_query = cx.new(|cx| {
            let mut input = TextInput::new("", false, 200, window, cx);
            input.appearance = false;
            input
        });
        cx.observe(&picker_query, |s: &mut Self, _, cx| {
            s.picker_active = None;
            cx.notify()
        })
        .detach();
        cx.observe(&composer, |_, _, cx| cx.notify()).detach();
        Self {
            pending_resume: None,
            picker_open: None,
            picker_active: None,
            picker_query,
            picker_focus: cx.focus_handle(),
            history_notice_open: false,
            logo_pressed: false,
            drafts: Default::default(),
            logo_turns: 0,
            diagnostics_open: false,
            image_previews: HashMap::new(),
            installation,
            root,
            wake,
            session,
            composer,
            answers: HashMap::new(),
            question_choices: HashMap::new(),
            transcript,
            follow: true,
            rows: vec![],
            row_signatures: vec![],
            expanded: Default::default(),
            rail_selected: HashMap::new(),
            rail_overflow: Default::default(),
            run_summary_open: false,
            unread: 0,
            transcript_width: 0.,
            attachment_rx: None,
            attachment_thread: None,
            history_filter,
            rename_input,
            show_rename: false,
        }
    }
    pub fn runtime(&self) -> crate::agent::runtime::agent_runtime_registry::Runtime {
        self.installation.runtime
    }
    pub fn resume_when_ready(&mut self, id: String) {
        self.pending_resume = Some(id);
    }
    fn sync_draft(&mut self, cx: &mut Context<Self>) {
        use super::super::application::session_draft_store::Draft;
        let next = self.session.snapshot().thread.clone();
        if self.drafts.active() == &next {
            return;
        }
        let current = Draft {
            text: self.composer.read(cx).text().into(),
            references: self.session.references.clone(),
        };
        if let Some(draft) = self.drafts.switch(next, current) {
            self.session.references = draft.references;
            self.set_draft(draft.text, cx);
        }
    }
    fn set_draft(&mut self, text: String, cx: &mut Context<Self>) {
        let end = text.len();
        let marks = vec![crate::ui::input::Mark::default(); text.chars().count()];
        self.composer.update(cx, |i, cx| {
            i.restore(
                crate::ui::input::InputSnapshot {
                    text,
                    marks,
                    anchor: end,
                    cursor: end,
                },
                cx,
            )
        });
    }
    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composer.update(cx, |i, cx| i.composing(window, cx)) {
            return;
        }
        // `steerAvailable`: Enter while a turn runs steers it.
        if self.session.snapshot().state == State::Running
            && self.session.snapshot().capabilities.steer
        {
            let text = self.composer.read(cx).text().to_owned();
            if !text.trim().is_empty() && self.session.steer(text) {
                self.composer.update(cx, |i, cx| i.clear(cx));
            }
            cx.notify();
            return;
        }
        if self.session.snapshot().state != State::Idle {
            return;
        }
        let text = self.composer.read(cx).text().to_owned();
        if text.trim().is_empty() && self.session.references.is_empty() {
            return;
        }
        if !self.session.send(text) {
            cx.notify();
            return;
        }
        self.follow = true;
        self.refresh_transcript();
        self.composer.update(cx, |i, cx| i.clear(cx));
        self.composer.focus_handle(cx).focus(window, cx);
        cx.notify();
    }
    pub fn busy(&self) -> bool {
        self.session.busy()
    }

    fn stage(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        if self.attachment_rx.is_some() {
            return;
        }
        self.attachment_thread = self.session.snapshot().thread.clone();
        self.attachment_rx = Some(native_attachment_client::stage(paths, self.wake.clone()));
        cx.notify();
    }
    /// `addFromComputer` / `addFromWorkspace`: both stage through the same
    /// reference ingestion; workspace picks start at the project root.
    fn attach(&mut self, workspace: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.attachment_rx.is_some() {
            return;
        }
        let prompt = if workspace {
            cx.prompt_for_paths(PathPromptOptions {
                files: true,
                directories: true,
                multiple: true,
                prompt: Some(crate::localization::t("agent.reference.addFromWorkspace").into()),
            })
        } else {
            cx.prompt_for_paths(PathPromptOptions {
                files: true,
                directories: false,
                multiple: true,
                prompt: Some(crate::localization::t("agent.reference.addFromComputer").into()),
            })
        };
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update_in(cx, |s, _, cx| {
                match result {
                    Ok(Ok(Some(paths))) => s.stage(paths, cx),
                    Ok(Err(e)) => s.session.draft_error = Some(e.to_string()),
                    Err(e) => s.session.draft_error = Some(e.to_string()),
                    _ => {}
                }
                cx.notify();
            });
        })
        .detach();
    }
}
impl Render for AgentChat {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        // A leading mention makes the prompt non-empty (`.cm-placeholder` hides).
        let placeholder = if self.render_mentions(cx).is_empty() {
            self.composer_placeholder()
        } else {
            String::new()
        };
        let subtle = super::agent_theme::AgentTheme::new(&t).text_subtle;
        self.composer.update(cx, |i, _| {
            i.set_placeholder(placeholder);
            // `.cm-placeholder { color: var(--agent-text-subtle) }`.
            i.placeholder_color = Some(subtle);
        });
        let picker_placeholder = self.picker_search_placeholder().unwrap_or_default();
        let m = crate::theme::ty();
        self.picker_query.update(cx, |i, _| {
            i.set_placeholder(picker_placeholder);
            // `.desktop-agent-picker-search input`: menu item type, subtle placeholder.
            i.prompt_text = Some((m.right.content, m.right.control_line_height));
            i.placeholder_color = Some(t.subtle);
        });
        self.refresh_transcript();
        let mut pane = v_flex()
            .id("agent-chat")
            .key_context("AgentChat")
            .size_full()
            .min_h_0()
            .bg(t.agent())
            .text_size(px(crate::theme::ty().left.content))
            .text_color(t.text)
            .on_drop(
                cx.listener(|s, paths: &ExternalPaths, _, cx| s.stage(paths.paths().to_vec(), cx)),
            )
            // Explorer entries are references through the same ingestion.
            .on_drop(
                cx.listener(|s, drag: &crate::ui::resource_drag::ResourceDrag, _, cx| {
                    if let Some(paths) = drag.local_paths() {
                        s.stage(paths, cx);
                    }
                }),
            )
            .on_action(cx.listener(|s, _: &SendMessage, w, cx| s.send(w, cx)))
            .children(self.render_header(cx))
            .child(self.render_status(cx));
        // A chat opened from History resumes its locator; it never shows
        // the in-chat list while that resume is pending.
        if self.session.snapshot().history_mode && self.pending_resume.is_none() {
            return pane.child(self.render_history(cx));
        }
        if self.rows.is_empty() && self.live_status_visible() {
            pane = pane.child(self.render_transcript(cx));
        } else if self.rows.is_empty() {
            pane = pane.child(self.render_empty(cx));
        } else {
            pane = pane.child(self.render_transcript(cx));
        }
        // `.desktop-agent-dock-region`: 12px padding, 8px between its cards.
        let card = self.render_interaction(window, cx);
        let commands = self.render_commands(cx);
        let composer = self.render_composer(window, cx);
        pane.child(
            v_flex()
                .flex_shrink_0()
                .pt(px(12.))
                .px(px(12.))
                .pb(px(12.))
                .gap(px(8.))
                .children(card)
                .children(commands)
                .child(composer),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn native_chat_renders_markdown_forms_and_restores_a_draft(cx: &mut TestAppContext) {
        // Session construction includes a real native runtime worker.
        cx.executor().allow_parking();
        use crate::agent::{
            domain::{
                agent_session_model::{Interaction, Question, SessionSnapshot},
                interaction_form::Field,
            },
            runtime::{agent_runtime_registry::Runtime, session_lease::Unavailable},
        };
        let root = std::env::temp_dir().join(format!("puppyone-ui-{}", uuid::Uuid::new_v4()));
        let (view, cx) = cx.add_window_view(|w, cx| {
            AgentChat::new(
                Installation {
                    runtime: Runtime::PuppyOne,
                    id: "puppyone-agent",
                    label: "Built-in Agent".into(),
                    executable: PathBuf::new(),
                    chat: true,
                },
                root,
                false,
                w,
                cx,
            )
        });
        view.update(cx,|s,cx|{
            let mut snapshot=SessionSnapshot::new("Fixture",false);snapshot.state=State::Idle;snapshot.thread=Some("a".into());
            snapshot.upsert("answer","Fixture","# Native transcript\n\n**Bold** and `code`.\n\n| A | B |\n| - | - |\n| one | two |\n\n```rust\nlet x = 1;\n```","");
            snapshot.interactions.push(Interaction{id:serde_json::Value::String("form".into()),thread:"a".into(),turn:"".into(),kind:InteractionKind::Form{prompt:"MCP form".into(),fields:vec![Field{id:"count".into(),label:"Count".into(),kind:"integer".into(),required:true,options:vec![]}],url:None}});
            s.session.replace_client(Box::new(Unavailable{snapshot}));s.drafts.switch(Some("a".into()),Default::default());s.set_draft("draft A".into(),cx);s.refresh_transcript();
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.update(cx, |s, cx| {
            let mut snapshot = s.session.snapshot().clone();
            snapshot.thread = Some("b".into());
            snapshot.interactions[0].kind = InteractionKind::Questions(vec![Question {
                id: "answer".into(),
                text: "Choose".into(),
                options: vec!["One".into(), "Two".into()],
                ..Default::default()
            }]);
            s.session.replace_client(Box::new(Unavailable { snapshot }));
            s.sync_draft(cx);
            assert!(s.composer.read(cx).text().is_empty());
            s.set_draft("draft B".into(), cx);
            let mut snapshot = s.session.snapshot().clone();
            snapshot.thread = Some("a".into());
            s.session.replace_client(Box::new(Unavailable { snapshot }));
            s.sync_draft(cx);
            assert_eq!(s.composer.read(cx).text(), "draft A");
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
}
