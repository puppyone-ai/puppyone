//! Port of `AgentComposer` / `composer/AgentComposerToolbar`: prompt, compact
//! session pickers on one line, the attachment menu and the round primary
//! action (send / stop). While a turn runs, Enter steers when supported.
use super::agent_session_control_picker::Selection;
use super::*;
use crate::ui::appearance::ActiveAppearance;
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::components::{Icon, IconButton, MenuItem, PopoverMenu, tooltip},
};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
/// `agent.effort.*` label for a reasoning effort id.
fn effort_label(id: &str) -> String {
    let key = match id {
        "low" | "minimal" => "agent.effort.low",
        "medium" => "agent.effort.medium",
        "high" => "agent.effort.high",
        "xhigh" => "agent.effort.xhigh",
        "max" => "agent.effort.max",
        _ => return id.to_owned(),
    };
    tr(key).to_owned()
}
impl AgentChat {
    /// `composerPlaceholder` from the chat view model.
    pub(super) fn composer_placeholder(&self) -> String {
        let snapshot = self.session.snapshot();
        if snapshot.state == State::Starting {
            tr("agent.composer.placeholder.preparing").into()
        } else if snapshot.messages.is_empty() {
            tr("agent.composer.placeholder.default").into()
        } else {
            tr("agent.composer.placeholder.followUp").into()
        }
    }
    pub(super) fn render_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let label = self.installation.label.clone();
        let snapshot = self.session.snapshot();
        let model = snapshot
            .models
            .iter()
            .find(|(id, _)| Some(id) == snapshot.model.as_ref())
            .map(|(_, label)| label.clone())
            .unwrap_or_else(|| tr("agent.model.placeholder").into());
        // `AgentSessionControlPicker`: the runtime's options only; the
        // trigger shows the placeholder while no model is chosen.
        let models: Vec<_> = snapshot
            .models
            .iter()
            .map(|(id, label)| {
                (
                    label.clone(),
                    Selection::Model(Some(id.clone())),
                    snapshot.model.as_ref() == Some(id),
                )
            })
            .collect();
        let modes = snapshot
            .modes
            .iter()
            .map(|(id, label)| {
                (
                    label.clone(),
                    Selection::Mode(id.clone()),
                    snapshot.mode.as_ref() == Some(id),
                )
            })
            .collect::<Vec<_>>();
        let efforts = snapshot
            .efforts
            .iter()
            .map(|id| {
                (
                    effort_label(id),
                    Selection::Effort(id.clone()),
                    snapshot.effort.as_ref() == Some(id),
                )
            })
            .collect::<Vec<_>>();
        let mode = snapshot
            .modes
            .iter()
            .find(|(id, _)| Some(id) == snapshot.mode.as_ref())
            .map(|(_, label)| label.clone())
            .unwrap_or_else(|| tr("agent.mode.placeholder").into());
        let effort = snapshot
            .effort
            .as_deref()
            .map(effort_label)
            .unwrap_or_else(|| tr("agent.effort.placeholder").into());
        let running = snapshot.state == State::Running;
        let stopping = snapshot.state == State::Stopping;
        let ready = snapshot.state == State::Idle
            && self.attachment_rx.is_none()
            && (!self.composer.read(cx).text().trim().is_empty()
                || !self.session.references.is_empty());
        // `.desktop-agent-composer-picker.is-*`: max-content up to
        // min(148px, 34vw) / min(72px, 20vw) / min(88px, 22vw).
        let viewport = f32::from(window.viewport_size().width);
        let mut controls = h_flex()
            .min_w_0()
            .flex_1()
            .gap(px(2.))
            .overflow_hidden()
            .child(
                div()
                    .min_w_0()
                    .flex_shrink(1.)
                    .overflow_hidden()
                    .child(self.picker(
                        "model-picker",
                        model,
                        models,
                        148f32.min(viewport * 0.34),
                        cx,
                    )),
            );
        if !efforts.is_empty() {
            controls = controls.child(div().flex_shrink_0().child(self.picker(
                "effort-picker",
                effort,
                efforts,
                72f32.min(viewport * 0.2),
                cx,
            )))
        }
        if !modes.is_empty() {
            controls = controls.child(div().flex_shrink_0().child(self.picker(
                "mode-picker",
                mode,
                modes,
                88f32.min(viewport * 0.22),
                cx,
            )))
        }
        let a = super::agent_theme::AgentTheme::new(&cx.palette());
        let visual = self.render_visual_attachments(cx);
        let mentions = self.render_mentions(cx);
        // `AgentAttachmentButton`: 32px quiet trigger (Paperclip 16 / 1.7).
        let host = cx.weak_entity();
        let workspace_host = cx.weak_entity();
        let attach_disabled = self.session.busy() && !running;
        // The attachment menu opens above the composer.
        let attach = PopoverMenu::new("attach-agent-menu")
            .anchor(Anchor::BottomLeft)
            .trigger(
                IconButton::new("attach-agent", Icon::new("paperclip").large().stroke(1.7))
                    .label(tr("agent.reference.add"))
                    .with_size(px(theme::control()))
                    .color(a.text_subtle)
                    .disabled(attach_disabled),
            )
            .menu(move |menu, _, _| {
                menu.item(
                    MenuItem::new(tr("agent.reference.addFromComputer"))
                        .icon("paperclip")
                        .on_click(move |w, cx| {
                            let _ = host.update(cx, |s, cx| s.attach(false, w, cx));
                        }),
                )
                .item(
                    MenuItem::new(tr("agent.reference.addFromWorkspace"))
                        .product_icon(crate::ui::components::ProductIcon::Folder)
                        .on_click(move |w, cx| {
                            let _ = workspace_host.update(cx, |s, cx| s.attach(true, w, cx));
                        }),
                )
            });
        let action_label = if running || stopping {
            tf("agent.composer.stop", &[("agent", label.clone().into())])
        } else {
            tr("agent.composer.send").to_owned()
        };
        // `.desktop-agent-composer-action`: a 28px disc inside a 32px target.
        let enabled = running || ready;
        let (surface, glyph_color, opacity) = if running || stopping {
            (a.text, a.canvas, if stopping { 0.52 } else { 1. })
        } else if enabled {
            (a.text, a.canvas, 1.)
        } else {
            (a.action_disabled_surface, a.action_disabled_text, 1.)
        };
        let glyph: AnyElement = if stopping {
            Icon::new("loader-circle")
                .color(glyph_color)
                .into_any_element()
        } else if running {
            div()
                .size(px(11.))
                .rounded(px(2.))
                .bg(glyph_color)
                .into_any_element()
        } else {
            Icon::new("arrow-up")
                .with_size(px(17.))
                .stroke(1.6)
                .color(glyph_color)
                .into_any_element()
        };
        let primary = gpui_kit::base::Button::new("send-agent")
            .accessibility_label(action_label.clone())
            .disabled(!enabled || stopping)
            .size(px(theme::control()))
            .ml(px(4.))
            .opacity(opacity)
            .child(
                div()
                    .size(px(28.))
                    .rounded_full()
                    .bg(surface)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(glyph),
            )
            .when(enabled && !stopping, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(|s| s.opacity(0.84))
            })
            .tooltip(tooltip(action_label))
            .on_click(cx.listener(move |s, _, w, cx| {
                if running {
                    s.session.stop();
                    cx.notify()
                } else if ready {
                    s.send(w, cx)
                }
            }));
        let focused = self.composer.focus_handle(cx).contains_focused(window, cx);
        let size = theme::ty().left.content;
        v_flex()
            .w_full()
            .min_w_0()
            .max_w(px(900.))
            .mx_auto()
            .rounded(px(8.))
            .border_1()
            .border_color(if focused { a.border } else { a.border_subtle })
            .bg(a.composer_surface)
            .children(visual)
            .child(
                // `.cm-content`: 12px block padding, 16px inline inset (Kit's
                // xsmall editor adds 4px inline), 1.5em lines.
                div()
                    .px(px(12.))
                    .py(px(12.))
                    .min_h(px(size * 1.5 + 24.))
                    .text_size(px(size))
                    .line_height(px(size * 1.5))
                    .capture_key_down(cx.listener(|s, e: &KeyDownEvent, _, cx| {
                        if e.keystroke.key == "backspace"
                            && s.composer.read(cx).text().is_empty()
                            && s.remove_last_mention()
                        {
                            cx.stop_propagation();
                            cx.notify();
                        }
                    }))
                    .map(|d| {
                        if mentions.is_empty() {
                            d.child(self.composer.clone())
                        } else {
                            d.child(
                                h_flex()
                                    .flex_wrap()
                                    .items_start()
                                    .pl(px(4.))
                                    .gap_y(px(1.))
                                    .children(mentions)
                                    .child(
                                        div().flex_1().min_w(px(40.)).child(self.composer.clone()),
                                    ),
                            )
                        }
                    }),
            )
            .child(
                // `.desktop-agent-composer-trailing`.
                h_flex()
                    .min_h(px(38.))
                    .pb(px(8.))
                    .px(px(8.))
                    .gap(px(8.))
                    .child(controls)
                    .child(
                        h_flex()
                            .gap(px(2.))
                            .flex_shrink_0()
                            .child(attach)
                            .child(primary),
                    ),
            )
    }
}
