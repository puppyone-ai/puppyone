//! `AgentComposer` with `composer/AgentPromptEditor` (atomic `@path`
//! mentions), `AgentVisualAttachmentList`, `AgentComposerToolbar`
//! (`AgentSessionControlPicker`s, the attachment menu, send/stop) and
//! `AgentCommandSuggestions`, plus `useAgentReferenceIngestion`'s drops.
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_theme::AgentTheme;
use super::elements::{effort_label, mention_chip};
use super::{AgentChatTabPanel, text_of};
use crate::agent::contract::js;
use crate::features::desktop_agent::application::agent_client_port::{AgentFile, AgentFileSource};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::features::desktop_agent::application::agent_reference_preview_store::object_url_bytes;
use crate::features::desktop_agent::domain::agent_prompt_mentions::{
    agent_prompt_mention_text, is_agent_media_reference, normalize_agent_prompt_mentions,
};
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId,
};
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, IconButton, Menu, MenuItem, PopoverMenu, tooltip};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{InlineToken, InputContent};
use serde_json::{Value, json};
use std::path::PathBuf;

/// `--agent-reference-card-height`.
const CARD: f32 = 40.;
/// `agentPickerLimits.maxRenderedOptions`.
const MAX_RENDERED: usize = 120;
const PICKER_MAX_HEIGHT: f32 = 360.;
const PICKER_OFFSET: f32 = 8.;

/// `.desktop-agent-prompt-mention`: the chip a mention token renders as.
pub(super) fn token_renderer() -> crate::ui::form_input::TokenRenderer {
    std::rc::Rc::new(|token, _, cx| {
        let a = AgentTheme::new(&cx.palette());
        mention_chip(&a, token.token().label().to_string(), false)
            .when(token.is_selected(), |d| d.bg(theme::alpha(a.accent, 0.16)))
            .into_any_element()
    })
}

/// `canSubmit` of `AgentComposer`.
pub(super) fn can_submit(state: &AgentControllerState, view: &AgentChatViewModel) -> bool {
    let attachment_only = view
        .reference_capabilities
        .as_ref()
        .is_some_and(|c| c["attachmentOnly"] == true);
    let has_submission =
        !js::trim(&state.draft).is_empty() || (!state.references.is_empty() && attachment_only);
    let references_ready = state.references.iter().all(|r| r["status"] == "ready");
    let can_send_while_running = view.steer_available || view.queue_available;
    has_submission
        && references_ready
        && !view.composer_disabled
        && !view.submission_pending
        && (!view.running || can_send_while_running)
}

/// UTF-16 offset → byte offset in `text`.
fn byte_offset(text: &str, units: usize) -> usize {
    js::head16(text, units).len()
}

impl AgentChatTabPanel {
    /// The composer's document as `(text, mentions)`: each token is one
    /// mention, its range in UTF-16 units.
    fn composer_document(&self, cx: &App) -> (String, Vec<Value>) {
        let input = self.composer.read(cx);
        let text = input.text().to_string();
        let mentions = input
            .token_spans(cx)
            .into_iter()
            .map(|(id, range)| {
                json!({
                    "referenceId": id,
                    "start": js::len16(&text[..range.start]),
                    "end": js::len16(&text[..range.end]),
                })
            })
            .collect();
        (text, mentions)
    }

    /// `AgentPromptEditor`'s controlled sync: the controller's draft shows in
    /// the editor, and new non-media references become mentions at the caret.
    pub(super) fn sync_composer(
        &mut self,
        state: &AgentControllerState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let draft = (
            state.draft.clone(),
            normalize_agent_prompt_mentions(&state.draft, &state.draft_mentions, None),
        );
        if draft != self.shown_draft {
            let current = self.composer_document(cx);
            if current != draft {
                let mut content = InputContent::new(draft.0.clone());
                for mention in &draft.1 {
                    let start =
                        byte_offset(&draft.0, mention["start"].as_u64().unwrap_or(0) as usize);
                    let end = byte_offset(&draft.0, mention["end"].as_u64().unwrap_or(0) as usize);
                    let id = text_of(&mention["referenceId"]);
                    let label = draft.0[start..end].to_string();
                    if let Ok(next) = content
                        .clone()
                        .with_token(start..end, InlineToken::new(id, label))
                    {
                        content = next;
                    }
                }
                self.composer
                    .update(cx, |input, cx| input.restore_content(content, cx));
            }
            self.shown_draft = draft;
        }
        // New path references become mentions (`AgentPromptEditor`).
        let existing: Vec<String> = self.composer.read(cx).token_ids(cx);
        let insertions: Vec<(String, String)> = state
            .references
            .iter()
            .filter(|reference| !is_agent_media_reference(reference))
            .filter(|reference| !existing.contains(&text_of(&reference["id"])))
            .map(|reference| {
                (
                    text_of(&reference["id"]),
                    agent_prompt_mention_text(reference),
                )
            })
            .collect();
        if !insertions.is_empty() {
            self.composer
                .update(cx, |input, cx| input.insert_tokens(&insertions, window, cx));
            self.composer_changed(cx);
        }
    }

    /// The editor changed: a deleted mention takes its reference with it,
    /// and the document becomes the controller's draft.
    pub(super) fn composer_changed(&mut self, cx: &mut Context<Self>) {
        let document = self.composer_document(cx);
        if document == self.shown_draft {
            return;
        }
        let previous: Vec<String> = self
            .shown_draft
            .1
            .iter()
            .map(|m| text_of(&m["referenceId"]))
            .collect();
        let next: Vec<String> = document
            .1
            .iter()
            .map(|m| text_of(&m["referenceId"]))
            .collect();
        self.shown_draft = document.clone();
        for removed in previous.iter().filter(|id| !next.contains(id)) {
            self.controller.remove_reference(removed);
        }
        self.controller.set_draft_document(&document.0, &document.1);
    }

    /// Files dropped from outside the workspace (`useAgentReferenceIngestion`).
    pub(super) fn add_external_paths(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let mut files = Vec::new();
        for path in paths {
            if path.is_dir() {
                drop(
                    self.controller
                        .add_path_text_or_draft(&path.to_string_lossy()),
                );
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let size = std::fs::metadata(&path)
                .map(|m| m.len() as f64)
                .unwrap_or(0.);
            files.push(AgentFile {
                mime: mime_for(&name).into(),
                name,
                size,
                source: AgentFileSource::Path(path.to_string_lossy().into_owned()),
            });
        }
        if !files.is_empty() {
            drop(self.controller.stage_external_files(files));
        }
        cx.notify();
    }

    /// Explorer entries: workspace-relative paths.
    pub(super) fn add_workspace_paths(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        drop(self.controller.add_workspace_paths(paths, Vec::new()));
        cx.notify();
    }

    fn pick_external_files(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some(t("agent.reference.addFromComputer").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = prompt.await {
                let _ = this.update(cx, |s, cx| s.add_external_paths(paths, cx));
            }
        })
        .detach();
    }

    fn close_picker(&mut self, cx: &mut Context<Self>) {
        self.picker_open = None;
        self.picker_active = None;
        self.picker_query.update(cx, |q, cx| q.clear(cx));
        cx.notify();
    }

    /// `AgentSessionControlPicker`.
    fn session_picker(
        &self,
        control: &AgentSessionControl,
        width: f32,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let id = control.id;
        let label = control
            .value
            .as_ref()
            .and_then(|value| control.options.iter().find(|o| &o.value == value))
            .map(|option| {
                if id == AgentSessionControlId::Effort {
                    effort_label(&option.value)
                } else {
                    option.label.clone()
                }
            })
            .unwrap_or_else(|| {
                t(match id {
                    AgentSessionControlId::Model => "agent.model.placeholder",
                    AgentSessionControlId::Effort => "agent.effort.placeholder",
                    AgentSessionControlId::Mode => "agent.mode.placeholder",
                })
                .to_string()
            });
        let open = self.picker_open == Some(id);
        let searchable = control.options.len() > 6;
        let trigger = div()
            .id(SharedString::from(format!("agent-picker-{id:?}")))
            .h(px(theme::control_compact()))
            .px(px(6.))
            .flex()
            .items_center()
            .min_w_0()
            .max_w(px(width))
            .overflow_hidden()
            .rounded(px(theme::metric::CONTROL_RADIUS))
            .text_color(a.text_subtle)
            .when(disabled, |d| d.opacity(0.45))
            .when(!disabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(a.row_hover))
                    .on_click(cx.listener(move |s, _, window, cx| {
                        if s.picker_open == Some(id) {
                            s.close_picker(cx);
                            return;
                        }
                        s.picker_open = Some(id);
                        s.picker_active = None;
                        s.picker_query.update(cx, |q, cx| q.clear(cx));
                        if searchable {
                            s.picker_query.read(cx).focus_handle(cx).focus(window, cx);
                        } else {
                            s.picker_focus.focus(window, cx);
                        }
                        cx.notify();
                    }))
            })
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::ty().left.content))
                    .line_height(px(theme::ty().left.line_height))
                    .child(label),
            );
        let mut root = div().relative().flex_shrink(1.).min_w_0().child(trigger);
        if open {
            root = root.child(
                div().absolute().top_0().left_0().child(
                    deferred(
                        anchored()
                            .anchor(Anchor::BottomLeft)
                            .offset(point(px(0.), px(-PICKER_OFFSET)))
                            .snap_to_window_with_margin(px(8.))
                            .child(self.picker_popover(control, cx)),
                    )
                    .with_priority(1),
                ),
            );
        }
        root.into_any_element()
    }

    fn picker_popover(
        &self,
        control: &AgentSessionControl,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t_ = cx.palette();
        let m = theme::ty();
        let id = control.id;
        let width = if id == AgentSessionControlId::Model {
            248.
        } else {
            148.
        };
        let searchable = control.options.len() > 6;
        let query = self.picker_query.read(cx).text().trim().to_lowercase();
        let matched: Vec<(String, String, bool)> = control
            .options
            .iter()
            .filter(|option| {
                query.is_empty()
                    || option.label.to_lowercase().contains(&query)
                    || option
                        .keywords
                        .as_deref()
                        .is_some_and(|k| k.to_lowercase().contains(&query))
            })
            .map(|option| {
                let label = if id == AgentSessionControlId::Effort {
                    effort_label(&option.value)
                } else {
                    option.label.clone()
                };
                (
                    label,
                    option.value.clone(),
                    control.value.as_deref() == Some(option.value.as_str()),
                )
            })
            .collect();
        let total = matched.len();
        let shown: Vec<(String, String, bool)> = matched.into_iter().take(MAX_RENDERED).collect();
        let active = self
            .picker_active
            .or_else(|| shown.iter().position(|(_, _, selected)| *selected))
            .unwrap_or(0);
        let mut list = div()
            .id("agent-panel-picker-list")
            .min_h_0()
            .flex_shrink(1.)
            .overflow_y_scroll()
            .track_scroll(&self.picker_scroll)
            .p(px(theme::metric::MENU_PADDING));
        for (index, (label, value, selected)) in shown.iter().cloned().enumerate() {
            let highlighted = selected || self.picker_active == Some(index);
            list = list.child(
                div()
                    .id(("agent-panel-picker-option", index))
                    .h(px(theme::control()))
                    .px(px(8.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .rounded(px(theme::metric::CONTROL_RADIUS))
                    .text_size(px(m.right.content))
                    .line_height(px(m.right.control_line_height))
                    .text_color(if highlighted { t_.text } else { t_.muted })
                    .when(highlighted, |d| d.bg(t_.hover))
                    .hover(move |s| s.bg(t_.hover).text_color(t_.text))
                    .cursor(theme::clickable_cursor())
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.select_session_control(id, value.clone(), cx);
                        s.close_picker(cx);
                    }))
                    .child(div().flex_1().min_w_0().truncate().child(label))
                    .when(selected, |d| {
                        d.child(
                            Icon::new("check")
                                .with_size(px(14.))
                                .stroke(2.)
                                .color(t_.muted),
                        )
                    }),
            );
        }
        if shown.is_empty() {
            list = list.child(
                div()
                    .px(px(12.))
                    .py(px(22.))
                    .text_center()
                    .text_color(t_.muted)
                    .text_size(px(m.right.meta))
                    .child(t("agent.picker.noMatches")),
            );
        }
        let count = shown.len();
        let keyed = shown.clone();
        div()
            .id(SharedString::from(format!("agent-picker-{id:?}-popover")))
            .track_focus(&self.picker_focus)
            .w(px(width))
            .max_h(px(PICKER_MAX_HEIGHT))
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(px(theme::metric::MENU_RADIUS))
            .border_1()
            .border_color(t_.border)
            .bg(t_.menu_bg)
            .shadow(vec![BoxShadow {
                inset: false,
                color: theme::alpha(t_.shadow, if t_.dark { 0.28 } else { 0.32 }).into(),
                offset: point(px(0.), px(2.)),
                blur_radius: px(4.),
                spread_radius: px(-2.),
            }])
            .occlude()
            .on_mouse_down_out(cx.listener(|s, _, _, cx| s.close_picker(cx)))
            .on_key_down(cx.listener(move |s, event: &KeyDownEvent, _, cx| {
                let next = match event.keystroke.key.as_str() {
                    "escape" => {
                        s.close_picker(cx);
                        cx.stop_propagation();
                        return;
                    }
                    "enter" => {
                        if let Some((_, value, _)) = keyed.get(active) {
                            s.select_session_control(id, value.clone(), cx);
                            s.close_picker(cx);
                        }
                        cx.stop_propagation();
                        return;
                    }
                    "down" => (active + 1).min(count.saturating_sub(1)),
                    "up" => active.saturating_sub(1),
                    "home" => 0,
                    "end" => count.saturating_sub(1),
                    _ => return,
                };
                s.picker_active = Some(next);
                cx.stop_propagation();
                cx.notify();
            }))
            .when(searchable, |d| {
                d.child(
                    h_flex()
                        .min_h(px(36.))
                        .px(px(8.))
                        .gap(px(7.))
                        .border_b_1()
                        .border_color(t_.divider)
                        .child(
                            Icon::new("search")
                                .with_size(px(13.))
                                .stroke(2.)
                                .color(t_.subtle),
                        )
                        .child(div().flex_1().min_w_0().child(self.picker_query.clone())),
                )
            })
            .child(list)
            .when(total > count, |d| {
                d.child(
                    div()
                        .min_h(px(theme::control()))
                        .px(px(8.))
                        .flex()
                        .items_center()
                        .border_t_1()
                        .border_color(t_.divider)
                        .text_color(t_.muted)
                        .text_size(px(m.right.meta))
                        .child(tf(
                            "agent.picker.showing",
                            &[
                                ("visible", Arg::Number(count as i64)),
                                ("total", Arg::Number(total as i64)),
                            ],
                        )),
                )
            })
    }

    /// `AgentVisualAttachmentList`: image references on the 40px shelf.
    fn render_visual_attachments(
        &self,
        state: &AgentControllerState,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let media: Vec<Value> = state
            .references
            .iter()
            .filter(|r| is_agent_media_reference(r))
            .cloned()
            .collect();
        if media.is_empty() {
            return None;
        }
        let action_hover = theme::mix(t_.menu_bg, t_.text, 0.88);
        let mut shelf = h_flex()
            .w_full()
            .min_w_0()
            .flex_wrap()
            .items_start()
            .gap(px(14.))
            .pt(px(12.))
            .px(px(12.));
        for reference in media {
            let id = text_of(&reference["id"]);
            let name = text_of(&reference["displayName"]);
            let preview = self.controller.get_reference_preview_url(&id);
            let image: Option<ImageSource> = preview.map(|url| match object_url_bytes(&url) {
                Some(bytes) => {
                    let format = match reference["mime"].as_str().unwrap_or_default() {
                        "image/jpeg" => ImageFormat::Jpeg,
                        "image/gif" => ImageFormat::Gif,
                        "image/webp" => ImageFormat::Webp,
                        _ => ImageFormat::Png,
                    };
                    ImageSource::from(std::sync::Arc::new(Image::from_bytes(
                        format,
                        (*bytes).clone(),
                    )))
                }
                None => ImageSource::from(PathBuf::from(url)),
            });
            let group = SharedString::from(format!("panel-visual-attachment-{id}"));
            let failed = reference["status"] == "error";
            let remove = tf(
                "agent.reference.remove",
                &[("name", Arg::Text(name.clone()))],
            );
            let remove_id = id.clone();
            shelf = shelf.child(
                div()
                    .id(SharedString::from(format!("panel-visual-card-{id}")))
                    .group(group.clone())
                    .relative()
                    .size(px(CARD))
                    .flex_shrink_0()
                    .rounded(px(6.))
                    .border_1()
                    .border_color(if failed { t_.danger } else { a.border_subtle })
                    .bg(a.row_hover)
                    .tooltip(tooltip(name.clone()))
                    .child(
                        div()
                            .size_full()
                            .rounded(px(5.))
                            .overflow_hidden()
                            .flex()
                            .items_center()
                            .justify_center()
                            .map(|d| match image {
                                Some(image) => {
                                    d.child(img(image).size_full().object_fit(ObjectFit::Cover))
                                }
                                None => d.child(
                                    Icon::new("image")
                                        .with_size(px(18.))
                                        .stroke(2.)
                                        .color(a.text_muted),
                                ),
                            }),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("panel-visual-remove-{id}")))
                            .absolute()
                            .top(px(-6.))
                            .right(px(-6.))
                            .size(px(20.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(t_.menu_bg)
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .hover(move |s| s.bg(action_hover))
                            .tooltip(tooltip(remove))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.controller.remove_reference(&remove_id);
                                cx.notify();
                            }))
                            .child(
                                Icon::new("x")
                                    .with_size(px(12.))
                                    .stroke(2.)
                                    .color(a.text_muted),
                            ),
                    ),
            );
        }
        Some(shelf.into_any_element())
    }

    /// `AgentCommandSuggestions`: commands matching a leading `/word`.
    fn render_commands(
        &self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let draft = &state.draft;
        if !draft.starts_with('/')
            || draft.contains(char::is_whitespace)
            || view.commands.is_empty()
        {
            return None;
        }
        let needle = draft.trim_start_matches('/').to_lowercase();
        let commands: Vec<(String, String)> = view
            .commands
            .iter()
            .map(|command| (text_of(&command["name"]), text_of(&command["description"])))
            .filter(|(name, _)| !name.is_empty() && name.to_lowercase().starts_with(&needle))
            .take(8)
            .collect();
        if commands.is_empty() {
            return None;
        }
        let host = cx.weak_entity();
        Some(
            Menu::new("agent-panel-commands")
                .items(commands.into_iter().map(|(name, description)| {
                    let host = host.clone();
                    MenuItem::new(format!("/{name}"))
                        .detail(description)
                        .on_click(move |_, cx| {
                            let _ = host.update(cx, |s, cx| {
                                s.controller.set_draft_document(&format!("/{name} "), &[]);
                                cx.notify();
                            });
                        })
                }))
                .into_any_element(),
        )
    }

    /// `AgentComposer`.
    pub(super) fn render_composer(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let runtime_label = view.runtime.runtime_label.clone();
        self.composer.update(cx, |input, _| {
            input.set_placeholder(view.composer_placeholder.clone());
            input.placeholder_color = Some(a.text_subtle);
        });
        let running = view.running;
        let stopping = state.stopping;
        let submitting = view.submission_pending;
        let submittable = can_submit(state, view);
        let viewport = f32::from(window.viewport_size().width);
        let mut controls = h_flex().min_w_0().flex_1().gap(px(2.)).overflow_hidden();
        for control in &view.session_controls {
            let width = match control.id {
                AgentSessionControlId::Model => 148f32.min(viewport * 0.34),
                AgentSessionControlId::Effort => 72f32.min(viewport * 0.2),
                AgentSessionControlId::Mode => 88f32.min(viewport * 0.22),
            };
            controls = controls.child(div().min_w_0().flex_shrink(1.).child(self.session_picker(
                control,
                width,
                view.configuration_disabled,
                cx,
            )));
        }
        let accepts_files = view.reference_capabilities.as_ref().is_some_and(|c| {
            crate::agent::contract::reference_input::has_agent_attachment_support(c)
                || c["workspace"]["files"] == true
                || c["workspace"]["directories"] == true
        });
        let host = cx.weak_entity();
        let workspace_host = cx.weak_entity();
        let attach = PopoverMenu::new("agent-panel-attach-menu")
            .anchor(Anchor::BottomLeft)
            .trigger(
                IconButton::new(
                    "agent-panel-attach",
                    Icon::new("paperclip")
                        .with_size(px(15.))
                        .stroke(1.6)
                        .rotate(-std::f32::consts::FRAC_PI_4),
                )
                .label(t("agent.reference.add"))
                .with_size(px(theme::control_compact()))
                .color(a.text_subtle)
                .disabled(!accepts_files || view.composer_disabled),
            )
            .menu(move |menu, _, _| {
                let host = host.clone();
                let workspace_host = workspace_host.clone();
                menu.item(
                    MenuItem::new(t("agent.reference.addFromComputer"))
                        .icon("paperclip")
                        .on_click(move |window, cx| {
                            let _ = host.update(cx, |s, cx| s.pick_external_files(window, cx));
                        }),
                )
                .item(
                    MenuItem::new(t("agent.reference.addFromWorkspace"))
                        .product_icon(crate::ui::components::ProductIcon::Folder)
                        .on_click(move |_, cx| {
                            let _ = workspace_host.update(cx, |s, cx| {
                                drop(s.controller.pick_workspace_references());
                                cx.notify();
                            });
                        }),
                )
            });
        let action_label = if running {
            tf(
                if stopping {
                    "agent.composer.stopping"
                } else {
                    "agent.composer.stop"
                },
                &[("agent", Arg::Text(bidi_isolate(&runtime_label)))],
            )
        } else {
            t("agent.composer.send").to_owned()
        };
        let disabled = if running { stopping } else { !submittable };
        let busy = if running { stopping } else { submitting };
        let (surface, glyph_color) = if running || !disabled {
            (a.text, a.canvas)
        } else {
            (a.action_disabled_surface, a.action_disabled_text)
        };
        let glyph: AnyElement = if busy {
            Icon::new("loader-circle")
                .with_size(px(15.))
                .color(glyph_color)
                .into_any_element()
        } else if running {
            div()
                .size(px(10. * 18. / 24.))
                .rounded(px(10. * 2. / 24.))
                .bg(glyph_color)
                .into_any_element()
        } else {
            Icon::new("arrow-up")
                .with_size(px(15.))
                .stroke(2.1)
                .color(glyph_color)
                .into_any_element()
        };
        let primary = gpui_kit::base::Button::new("agent-panel-primary")
            .accessibility_label(action_label.clone())
            .disabled(disabled)
            .size(px(theme::control_compact()))
            .ml(px(4.))
            .opacity(if stopping { 0.52 } else { 1. })
            .child(
                div()
                    .size(px(theme::control_compact()))
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .bg(surface)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(glyph),
            )
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(|s| s.opacity(0.84))
            })
            .tooltip(tooltip(action_label))
            .on_click(cx.listener(move |s, _, window, cx| {
                if running {
                    drop(s.controller.stop());
                    cx.notify();
                } else {
                    s.submit(window, cx);
                }
            }));
        let focused = self.composer.focus_handle(cx).contains_focused(window, cx);
        let size = theme::ty().left.content;
        let visual = self.render_visual_attachments(state, cx);
        let commands = self.render_commands(state, view, cx);
        let resolving = state
            .references
            .iter()
            .any(|r| r["status"] == "resolving" && !is_agent_media_reference(r));
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
                                    .child(
                                        div().flex_1().min_w(px(40.)).child(self.composer.clone()),
                                    ),
                            ),
                    )
                    .child(
                        h_flex()
                            .min_h(px(theme::control_compact() + 6.))
                            .pb(px(6.))
                            .px(px(6.))
                            .gap(px(8.))
                            .child(controls)
                            .child(
                                h_flex()
                                    .gap(px(2.))
                                    .flex_shrink_0()
                                    .child(attach)
                                    .child(primary),
                            ),
                    ),
            )
            .into_any_element()
    }
}

/// The MIME type a dropped file's name implies.
fn mime_for(name: &str) -> &'static str {
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
