//! `AgentComposer` with `composer/AgentPromptEditor` (atomic `@path`
//! mentions), `AgentComposerToolbar` (the session pickers, the attachment
//! menu, send/stop), `AgentVisualAttachmentList` and
//! `AgentCommandSuggestions`. The container hands it a [`ComposerInput`] and
//! hears every request as a [`ComposerEvent`]; the composer holds only the
//! editor and what it last showed of the draft.
mod attachments;
mod commands;
#[cfg(test)]
mod tests;
mod toolbar;

use super::agent_chat_view_model::AgentChatViewModel;
use super::agent_theme::AgentTheme;
use super::elements::mention_chip;
use super::pickers::SessionPickers;
use crate::agent::contract::dto::{DraftReference, PromptMention, ReferenceStatus, SlashCommand};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::features::desktop_agent::domain::agent_prompt_mentions::{
    agent_prompt_mention_text, is_agent_media_reference, normalize_agent_prompt_mentions,
};
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControl;
use crate::localization::t;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::form_input::{InputEvent, PastedFiles, TextInput};
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::input::{InlineToken, InputContent};
use std::collections::HashMap;

/// What the composer shows: the draft and its references, and what the
/// conversation allows.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ComposerInput {
    pub draft: String,
    pub draft_mentions: Vec<PromptMention>,
    pub references: Vec<DraftReference>,
    /// The media references' previews (`getReferencePreviewUrl`).
    pub previews: HashMap<String, String>,
    pub placeholder: String,
    pub runtime_label: String,
    pub running: bool,
    pub stopping: bool,
    pub submitting: bool,
    /// `canSubmit`.
    pub submittable: bool,
    pub session_controls: Vec<AgentSessionControl>,
    pub configuration_disabled: bool,
    pub composer_disabled: bool,
    /// The runtime takes attachments or workspace entries.
    pub accepts_files: bool,
    pub commands: Vec<SlashCommand>,
}
impl ComposerInput {
    /// The composer's part of a chat's state and view model; `preview`
    /// resolves a media reference's preview.
    pub fn of(
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        preview: impl Fn(&str) -> Option<String>,
    ) -> Self {
        Self {
            draft: state.draft.clone(),
            draft_mentions: state.draft_mentions.clone(),
            references: state.references.clone(),
            previews: state
                .references
                .iter()
                .filter(|r| is_agent_media_reference(r))
                .filter_map(|r| Some((r.id.clone(), preview(&r.id)?)))
                .collect(),
            placeholder: view.composer_placeholder.clone(),
            runtime_label: view.runtime.runtime_label.clone(),
            running: view.running,
            stopping: state.stopping,
            submitting: view.submission_pending,
            submittable: can_submit(state, view),
            session_controls: view.session_controls.clone(),
            configuration_disabled: view.configuration_disabled,
            composer_disabled: view.composer_disabled,
            accepts_files: view.reference_capabilities.as_ref().is_some_and(|c| {
                crate::agent::contract::reference_input::has_attachment_support(c)
                    || c.workspace.files
                    || c.workspace.directories
            }),
            commands: view.commands.clone(),
        }
    }
}

/// What the composer asks of its container.
pub enum ComposerEvent {
    /// The editor's document became the draft; `removed` mentions take
    /// their references with them.
    DraftChanged {
        text: String,
        mentions: Vec<PromptMention>,
        removed: Vec<String>,
    },
    RemoveReference(String),
    Submit,
    Stop,
    /// `onPaste`: images and files from the clipboard.
    Paste(PastedFiles),
    /// "Add from computer" / "Add from workspace".
    PickFiles,
    PickWorkspace,
    /// A slash command was chosen.
    Command(String),
}
impl EventEmitter<ComposerEvent> for ComposerView {}

pub struct ComposerView {
    input: Entity<TextInput>,
    pickers: Entity<SessionPickers>,
    data: ComposerInput,
    /// The draft the editor last showed (text, mentions).
    shown_draft: (String, Vec<PromptMention>),
}

/// `.desktop-agent-prompt-mention`: the chip a mention token renders as.
fn token_renderer() -> crate::ui::form_input::TokenRenderer {
    std::rc::Rc::new(|token, _, cx| {
        let a = AgentTheme::new(&cx.palette());
        mention_chip(&a, token.token().label().to_string(), false)
            .when(token.is_selected(), |d| d.bg(theme::alpha(a.accent, 0.16)))
            .into_any_element()
    })
}

/// `canSubmit` of `AgentComposer`.
pub fn can_submit(state: &AgentControllerState, view: &AgentChatViewModel) -> bool {
    let attachment_only = view
        .reference_capabilities
        .as_ref()
        .is_some_and(|c| c.attachment_only);
    let has_submission = !crate::text::trim(&state.draft).is_empty()
        || (!state.references.is_empty() && attachment_only);
    let references_ready = state.references.iter().all(DraftReference::is_ready);
    let can_send_while_running = view.steer_available || view.queue_available;
    has_submission
        && references_ready
        && !view.composer_disabled
        && !view.submission_pending
        && (!view.running || can_send_while_running)
}

/// UTF-16 offset → byte offset in `text`.
fn byte_offset(text: &str, units: usize) -> usize {
    crate::text::head16(text, units).len()
}

/// The MIME type a dropped file's name implies.
pub fn mime_for(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "",
    }
}

impl ComposerView {
    pub fn new(
        pickers: Entity<SessionPickers>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = cx.new(|cx| {
            TextInput::new(
                crate::localization::t("agent.composer.placeholder.default"),
                true,
                64_000,
                window,
                cx,
            )
        });
        input.update(cx, |input, _| {
            // One 1.5em line at rest; Enter sends, Shift+Enter breaks the line.
            let size = crate::theme::ty().left.content;
            input.prompt_text = Some((size, size * 1.5));
            input.placeholder_color = Some(|t| AgentTheme::new(t).text_subtle);
            input.min_height = size * 1.5;
            input.appearance = false;
            input.submit_on_enter = true;
            input.paste_files = true;
            input.token_renderer = Some(token_renderer());
        });
        // `onPaste`: pasted images and files become references.
        cx.subscribe(&input, |_, _, pasted: &PastedFiles, cx| {
            cx.emit(ComposerEvent::Paste(pasted.clone()))
        })
        .detach();
        cx.subscribe(&input, |s, _, event: &InputEvent, cx| match event {
            InputEvent::Submit => cx.emit(ComposerEvent::Submit),
            InputEvent::Changed => s.changed(cx),
        })
        .detach();
        cx.observe(&pickers, |_, _, cx| cx.notify()).detach();
        Self {
            input,
            pickers,
            data: ComposerInput::default(),
            shown_draft: Default::default(),
        }
    }
    /// The conversation changed: the draft shows in the editor, and new
    /// path references become mentions.
    pub fn set_input(&mut self, data: ComposerInput, window: &mut Window, cx: &mut Context<Self>) {
        if data == self.data {
            return;
        }
        self.data = data;
        self.sync(window, cx);
        cx.notify();
    }
    /// Whether the editor is composing (IME) text.
    pub fn composing(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        self.input
            .update(cx, |input, cx| input.composing(window, cx))
    }
    /// The composer's document as `(text, mentions)`: each token is one
    /// mention, its range in UTF-16 units.
    fn composer_document(&self, cx: &App) -> (String, Vec<PromptMention>) {
        let input = self.input.read(cx);
        // Read with the tokens: right after an insertion the cached text
        // is still the previous one.
        let text = input.current_text(cx);
        let mentions = input
            .token_spans(cx)
            .into_iter()
            .map(|(id, range)| PromptMention {
                reference_id: id,
                start: crate::text::len16(&text[..range.start]),
                end: crate::text::len16(&text[..range.end]),
            })
            .collect();
        (text, mentions)
    }

    /// `AgentPromptEditor`'s controlled sync: the controller's draft shows in
    /// the editor, and new non-media references become mentions at the caret.
    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let state = &self.data;
        let draft = (
            state.draft.clone(),
            normalize_agent_prompt_mentions(&state.draft, &state.draft_mentions, None),
        );
        if draft != self.shown_draft {
            let current = self.composer_document(cx);
            if current != draft {
                let mut content = InputContent::new(draft.0.clone());
                for mention in &draft.1 {
                    let start = byte_offset(&draft.0, mention.start);
                    let end = byte_offset(&draft.0, mention.end);
                    let id = mention.reference_id.clone();
                    let label = draft.0[start..end].to_string();
                    if let Ok(next) = content
                        .clone()
                        .with_token(start..end, InlineToken::new(id, label))
                    {
                        content = next;
                    }
                }
                self.input
                    .update(cx, |input, cx| input.restore_content(content, cx));
            }
            self.shown_draft = draft;
        }
        // New path references become mentions (`AgentPromptEditor`).
        let existing: Vec<String> = self.input.read(cx).token_ids(cx);
        let insertions: Vec<(String, String)> = state
            .references
            .iter()
            .filter(|reference| !is_agent_media_reference(reference))
            .filter(|reference| !existing.contains(&reference.id))
            .map(|reference| (reference.id.clone(), agent_prompt_mention_text(reference)))
            .collect();
        if !insertions.is_empty() {
            self.input
                .update(cx, |input, cx| input.insert_tokens(&insertions, window, cx));
            self.changed(cx);
        }
    }

    /// The editor changed: a deleted mention takes its reference with it,
    /// and the document becomes the draft.
    fn changed(&mut self, cx: &mut Context<Self>) {
        let document = self.composer_document(cx);
        if document == self.shown_draft {
            return;
        }
        let previous: Vec<String> = self
            .shown_draft
            .1
            .iter()
            .map(|m| m.reference_id.clone())
            .collect();
        let next: Vec<String> = document.1.iter().map(|m| m.reference_id.clone()).collect();
        self.shown_draft = document.clone();
        let removed = previous
            .into_iter()
            .filter(|id| !next.contains(id))
            .collect();
        cx.emit(ComposerEvent::DraftChanged {
            text: document.0,
            mentions: document.1,
            removed,
        });
    }

    /// `AgentComposer`.
    fn render_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let view = self.data.clone();
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        self.input.update(cx, |input, _| {
            input.set_placeholder(view.placeholder.clone());
        });
        let toolbar = self.render_toolbar(&view, &a, window, cx);
        let focused = self.input.focus_handle(cx).contains_focused(window, cx);
        let size = theme::ty().left.content;
        let visual = self.render_visual_attachments(cx);
        let commands = self.render_commands(cx);
        let resolving = view
            .references
            .iter()
            .any(|r| r.status == ReferenceStatus::Resolving && !is_agent_media_reference(r));
        v_flex()
            .w_full()
            .min_w_0()
            .max_w(px(900.))
            .mx_auto()
            .gap(px(4.))
            .children(commands)
            .child(
                v_flex()
                    .w_full()
                    .min_w_0()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(if focused { a.border } else { a.border_subtle })
                    .bg(a.composer_surface)
                    .when(view.composer_disabled, |d| d.opacity(0.72))
                    .children(visual)
                    .child(
                        div()
                            .px(px(12.))
                            .py(px(12.))
                            .min_h(px(size * 1.5 + 24.))
                            .text_size(px(size))
                            .line_height(px(size * 1.5))
                            .child(
                                h_flex()
                                    .flex_wrap()
                                    .items_start()
                                    .gap_y(px(1.))
                                    .when(resolving, |d| {
                                        d.child(mention_chip(
                                            &a,
                                            t("agent.reference.resolving").into(),
                                            true,
                                        ))
                                    })
                                    .child(div().flex_1().min_w(px(40.)).child(self.input.clone())),
                            ),
                    )
                    .child(toolbar),
            )
            .into_any_element()
    }
}

impl Render for ComposerView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.render_composer(window, cx)
    }
}
