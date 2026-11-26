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
use crate::agent::contract::dto::{
    DraftReference, PromptMention, ReferenceKind, ReferenceStatus, SlashCommand,
};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::features::desktop_agent::domain::agent_prompt_mentions::{
    agent_prompt_mention_text, is_agent_media_reference, normalize_agent_prompt_mentions,
};
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControl;
use crate::localization::{Arg, bidi_isolate, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use crate::ui::form_input::{InputEvent, PastedFiles, TextInput};
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{InlineToken, InputContent};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

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
    /// A failed inline reference's Retry (`onRetryReference`).
    RetryReference(String),
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
    /// The draft's references by id, for the mention chips.
    references: Rc<RefCell<HashMap<String, DraftReference>>>,
    /// Mentions removed by their Retry: their reference is acquired again,
    /// not released (`retryMentionRemoval`).
    retried: Vec<String>,
    /// Whether the capsule has morphed into its 2-row full-width layout (M1).
    multiline: bool,
    /// Character count where single-line soft-wrap first triggered expansion,
    /// providing hysteresis so widening the input never causes oscillation.
    wrap_expand_chars: Option<usize>,
}

/// `.desktop-agent-prompt-mention`: the chip a mention token renders as,
/// in its reference's state (`is-resolving`, `is-ready`, `is-error`).
fn token_renderer(
    references: Rc<RefCell<HashMap<String, DraftReference>>>,
    composer: WeakEntity<ComposerView>,
) -> crate::ui::form_input::TokenRenderer {
    Rc::new(move |token, _, cx| {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let label = token.token().label().to_string();
        let reference = references
            .borrow()
            .get(token.token().id().as_ref())
            .cloned();
        let status = reference
            .as_ref()
            .map_or(ReferenceStatus::Ready, |r| r.status);
        let selector = format!("agent-mention:{label}:{}", status_name(status));
        let chip = mention_chip(&a, label, status == ReferenceStatus::Resolving)
            .debug_selector(move || selector)
            .when(token.is_selected(), |d| d.bg(theme::alpha(a.accent, 0.16)));
        match reference.filter(|r| r.status == ReferenceStatus::Error) {
            Some(reference) => {
                failed_mention(chip, &reference, palette.danger, &composer).into_any_element()
            }
            None => chip.into_any_element(),
        }
    })
}

fn status_name(status: ReferenceStatus) -> &'static str {
    match status {
        ReferenceStatus::Resolving => "resolving",
        ReferenceStatus::Ready => "ready",
        ReferenceStatus::Error => "error",
    }
}

/// `AgentPromptReferenceWidget` of a failed reference: the error is its
/// accessible description, never shown, and it offers Retry and Remove.
fn failed_mention(
    chip: Div,
    reference: &DraftReference,
    danger: Rgba,
    composer: &WeakEntity<ComposerView>,
) -> Stateful<Div> {
    let name = bidi_isolate(&reference.display_name);
    let action = |kind: &'static str, glyph: &'static str, label: String| {
        let id = reference.id.clone();
        let composer = composer.clone();
        div()
            .id(SharedString::from(format!("agent-mention-{kind}-{id}")))
            .debug_selector({
                let label = label.clone();
                move || format!("agent-mention-{kind}:{label}")
            })
            .role(Role::Button)
            .aria_label(label)
            .size(px(16.))
            .ml(px(2.))
            .rounded(px(3.))
            .flex()
            .items_center()
            .justify_center()
            .cursor(theme::clickable_cursor())
            .hover(|s| s.bg(theme::alpha(danger, 0.16)))
            .child(Icon::new(glyph).with_size(px(11.)).stroke(2.).color(danger))
            // The editor neither moves its caret nor selects the token.
            .on_mouse_down(MouseButton::Left, |_, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
            })
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                let _ = composer.update(cx, |c, cx| c.act_on_mention(kind, &id, window, cx));
            })
            .test_support()
    };
    chip.id(SharedString::from(format!(
        "agent-mention-{}",
        reference.id
    )))
    .flex()
    .items_center()
    .border_color(danger)
    .text_color(danger)
    .role(Role::Group)
    .aria_label(agent_prompt_mention_text(reference))
    .aria_description(reference_title(reference))
    .child(action(
        "retry",
        "refresh-cw",
        tf(
            "agent.reference.retry",
            &[("name", Arg::Text(name.clone()))],
        ),
    ))
    .child(action(
        "remove",
        "x",
        tf("agent.reference.remove", &[("name", Arg::Text(name))]),
    ))
}

/// The failed mention's description: its identity, the localized error,
/// then the raw error when it says more (`referenceDecorations`).
fn reference_title(reference: &DraftReference) -> String {
    let identity = if reference.kind == ReferenceKind::WorkspaceEntry {
        reference.relative_path.clone().unwrap_or_default()
    } else {
        reference.display_name.clone()
    };
    std::iter::once(identity)
        .chain(attachments::reference_details(reference))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
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
        input.update(cx, |input, cx| {
            // One 1.5em line at rest; Enter sends, Shift+Enter breaks the line.
            // Cap auto-grow at 7 rows before internal scrolling.
            let size = crate::theme::ty().left.content;
            input.prompt_text = Some((size, size * 1.5));
            input.placeholder_color = Some(|t| AgentTheme::new(t).composer_placeholder);
            input.min_height = size * 1.5;
            input.appearance = false;
            input.submit_on_enter = true;
            input.paste_files = true;
            input.set_max_rows(7, cx);
        });
        let references = Rc::<RefCell<HashMap<String, DraftReference>>>::default();
        let renderer = token_renderer(references.clone(), cx.weak_entity());
        input.update(cx, |input, _| input.token_renderer = Some(renderer));
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
        cx.observe(&input, |s, _, cx| s.sync_multiline(cx)).detach();
        cx.observe(&pickers, |_, _, cx| cx.notify()).detach();
        Self {
            input,
            pickers,
            data: ComposerInput::default(),
            shown_draft: Default::default(),
            references,
            retried: Vec::new(),
            multiline: false,
            wrap_expand_chars: None,
        }
    }
    /// The conversation changed: the draft shows in the editor, and new
    /// path references become mentions.
    pub fn set_input(&mut self, data: ComposerInput, window: &mut Window, cx: &mut Context<Self>) {
        if data == self.data {
            return;
        }
        *self.references.borrow_mut() = data
            .references
            .iter()
            .map(|r| (r.id.clone(), r.clone()))
            .collect();
        self.data = data;
        let placeholder = if crate::text::trim(&self.data.placeholder).is_empty() {
            crate::localization::t("agent.composer.placeholder.default").to_string()
        } else {
            self.data.placeholder.clone()
        };
        self.input
            .update(cx, |input, cx| input.set_placeholder(placeholder, cx));
        self.sync(window, cx);
        self.sync_multiline(cx);
        cx.notify();
    }
    /// Whether the editor is composing (IME) text.
    pub fn composing(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        self.input
            .update(cx, |input, cx| input.composing(window, cx))
    }
    /// Focuses the prompt input.
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.input.focus_handle(cx).focus(window, cx);
    }
    /// Current `(text, mentions)` shown in the prompt input.
    pub fn document(&self, cx: &App) -> (String, Vec<PromptMention>) {
        self.composer_document(cx)
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
            .filter(|(_, range)| {
                range.start <= range.end
                    && range.end <= text.len()
                    && text.is_char_boundary(range.start)
                    && text.is_char_boundary(range.end)
            })
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
                    .update(cx, |input, cx| input.set_content(content, window, cx));
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

    /// A failed mention's Retry or Remove: the mention leaves the editor;
    /// Retry acquires its reference again in its place, Remove releases it.
    fn act_on_mention(
        &mut self,
        kind: &str,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if kind == "retry" {
            self.retried.push(id.to_owned());
            cx.emit(ComposerEvent::RetryReference(id.to_owned()));
        }
        self.input
            .update(cx, |input, cx| input.remove_token(id, window, cx));
        self.changed(cx);
        self.input.focus_handle(cx).focus(window, cx);
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
        let retried = std::mem::take(&mut self.retried);
        let removed = previous
            .into_iter()
            .filter(|id| !next.contains(id) && !retried.contains(id))
            .collect();
        cx.emit(ComposerEvent::DraftChanged {
            text: document.0,
            mentions: document.1,
            removed,
        });
        self.sync_multiline(cx);
    }

    /// Approximate display width units (ASCII = 1, wide/CJK = 2) for safe
    /// collapse hysteresis when no single-line wrap threshold was measured.
    fn weighted_len(text: &str) -> usize {
        text.chars().map(|c| if c.is_ascii() { 1 } else { 2 }).sum()
    }

    /// Adaptive M1 morphing: stay a compact 42px single-line pill while text
    /// fits on one line with no visual attachments; morph into a full-width
    /// 2-row soft card on newline, soft-wrap, or visual attachment, with
    /// hysteresis so widening the text field never oscillates.
    fn sync_multiline(&mut self, cx: &mut Context<Self>) {
        let has_visual = self.data.references.iter().any(is_agent_media_reference);
        let text = self.input.read(cx).current_text(cx);
        let has_newline = text.contains('\n');
        let wrap_rows = self.input.read(cx).wrap_row_count(cx);
        let chars = text.chars().count();

        let next = if has_visual || has_newline {
            true
        } else if wrap_rows > 1 {
            if !self.multiline && wrap_rows == 2 {
                self.wrap_expand_chars = Some(chars);
            }
            true
        } else if !self.multiline || text.is_empty() {
            self.wrap_expand_chars = None;
            false
        } else {
            match self.wrap_expand_chars {
                Some(trigger) => chars + 6 >= trigger,
                None => Self::weighted_len(&text) > 20,
            }
        };

        if !next {
            self.wrap_expand_chars = None;
        }
        if next != self.multiline {
            self.multiline = next;
            cx.notify();
        }
    }

    /// `AgentComposer`: M1 adaptive floating capsule (`[+ | prompt | ↑]` at
    /// 1 line, morphing into full-width text over `[+ ... ↑]` when multiline
    /// or holding visual attachments), with quiet session chips below on 16pt.
    fn render_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let view = self.data.clone();
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let attach = self.render_attach(&view, &a, cx);
        let primary = self.render_primary_action(&view, &a, cx);
        let controls = self.render_controls_row(&view, window, cx);
        let focused = self.input.focus_handle(cx).contains_focused(window, cx);
        let size = theme::ty().left.content;
        let line_height = size * 1.5;
        let text_pad_y = ((toolbar::CAPSULE_ACTION - line_height) * 0.5).max(3.);
        let visual = self.render_visual_attachments(cx);
        let has_visual = visual.is_some();
        let expanded = self.multiline || has_visual;
        let commands = self.render_commands(cx);
        let shadow = a.composer_shadows(t_.dark, focused);
        let body: AnyElement = if expanded {
            v_flex()
                .w_full()
                .min_w_0()
                .child(
                    div()
                        .debug_selector(|| "agent-composer-input".into())
                        .w_full()
                        .min_w_0()
                        .pt(px(if has_visual { 6. } else { 11. }))
                        .pb(px(4.))
                        // 9px wrapper + Textarea's 4px inner inset = 13px symmetric horizontal padding.
                        .px(px(9.))
                        .text_size(px(size))
                        .line_height(px(line_height))
                        .child(self.input.clone()),
                )
                .child(
                    h_flex()
                        .w_full()
                        .items_center()
                        .justify_between()
                        .pt(px(2.))
                        .pb(px(6.))
                        .px(px(6.))
                        .child(attach)
                        .child(primary),
                )
                .into_any_element()
        } else {
            h_flex()
                .w_full()
                .min_w_0()
                .items_end()
                .gap(px(2.))
                .p(px(5.))
                .child(attach)
                .child(
                    div()
                        .debug_selector(|| "agent-composer-input".into())
                        .flex_1()
                        .min_w_0()
                        .py(px(text_pad_y))
                        .text_size(px(size))
                        .line_height(px(line_height))
                        .child(self.input.clone()),
                )
                .child(primary)
                .into_any_element()
        };
        v_flex()
            .w_full()
            .min_w_0()
            .max_w(px(900.))
            .mx_auto()
            .children(commands.map(|c| div().mb(px(6.)).child(c)))
            .child(
                v_flex()
                    .w_full()
                    .min_w_0()
                    .rounded(px(if expanded { 18. } else { 21. }))
                    .border_1()
                    .border_color(if focused {
                        a.composer_border_focus
                    } else {
                        a.composer_border
                    })
                    .bg(a.composer_surface)
                    .shadow(shadow)
                    .when(view.composer_disabled, |d| d.opacity(0.72))
                    .children(visual)
                    .child(body),
            )
            .children(controls)
            .into_any_element()
    }
}

impl Render for ComposerView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.render_composer(window, cx)
    }
}
