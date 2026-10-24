//! Port of `AgentComposer` / `composer/AgentComposerToolbar`: prompt, compact
//! session pickers on one line, the attachment menu and the round primary
//! action (send / stop). While a turn runs, Enter steers when supported.
use super::agent_session_control_picker::Selection;
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme::{self, metric},
    ui::{icon_sized, menu_icon, tooltip},
};
use gpui_kit::component::{
    Disableable, Sizable,
    button::{Button, ButtonVariants},
    menu::{DropdownMenu, PopupMenuItem},
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
    pub(super) fn render_composer(&mut self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let label = self.installation.label.clone();
        let snapshot = self.session.snapshot();
        let model = snapshot
            .models
            .iter()
            .find(|(id, _)| Some(id) == snapshot.model.as_ref())
            .map(|(_, label)| label.clone())
            .unwrap_or_else(|| tr("agent.model.placeholder").into());
        let mut models = vec![(
            tr("agent.model.placeholder").to_owned(),
            Selection::Model(None),
            snapshot.model.is_none(),
        )];
        models.extend(snapshot.models.iter().map(|(id, label)| {
            (
                label.clone(),
                Selection::Model(Some(id.clone())),
                snapshot.model.as_ref() == Some(id),
            )
        }));
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
        // The model label yields space first; effort and mode stay readable.
        let mut controls = row()
            .min_w_0()
            .flex_1()
            .gap(px(2.))
            .overflow_hidden()
            .child(
                div()
                    .min_w_0()
                    .flex_shrink(1.)
                    .overflow_hidden()
                    .child(self.picker("model-picker", model, models, 148., cx)),
            );
        if !efforts.is_empty() {
            controls = controls.child(div().flex_shrink_0().child(self.picker(
                "effort-picker",
                effort,
                efforts,
                96.,
                cx,
            )))
        }
        if !modes.is_empty() {
            controls = controls.child(div().flex_shrink_0().child(self.picker(
                "mode-picker",
                mode,
                modes,
                96.,
                cx,
            )))
        }
        let references = self.render_references(cx);
        let has_references = !self.session.references.is_empty() || self.attachment_rx.is_some();
        // Attachment menu (`AgentAttachmentButton`).
        let host = cx.weak_entity();
        let workspace_host = cx.weak_entity();
        let attach = Button::new("attach-agent")
            .ghost()
            .small()
            .icon(menu_icon("paperclip"))
            .text_color(t.subtle)
            .tooltip(tr("agent.reference.add"))
            .disabled(self.session.busy() && !running)
            .dropdown_menu(move |menu, _, _| {
                let host = host.clone();
                let workspace_host = workspace_host.clone();
                menu.item(
                    PopupMenuItem::new(tr("agent.reference.addFromComputer"))
                        .icon(menu_icon("paperclip"))
                        .on_click(move |_, w, cx| {
                            let _ = host.update(cx, |s, cx| s.attach(false, w, cx));
                        }),
                )
                .item(
                    PopupMenuItem::new(tr("agent.reference.addFromWorkspace"))
                        .icon(menu_icon("folder"))
                        .on_click(move |_, w, cx| {
                            let _ = workspace_host.update(cx, |s, cx| s.attach(true, w, cx));
                        }),
                )
            });
        let action_label = if running || stopping {
            tf("agent.composer.stop", &[("agent", label.clone().into())])
        } else {
            tr("agent.composer.send").to_owned()
        };
        let enabled = running || ready;
        let (surface, glyph_color) = if enabled {
            (t.text, t.canvas)
        } else {
            (theme::alpha(t.text, 0.14), theme::alpha(t.text, 0.48))
        };
        let glyph: AnyElement = if stopping {
            icon_sized("loader-circle", 15., glyph_color).into_any_element()
        } else if running {
            div()
                .size(px(10.))
                .rounded(px(2.))
                .bg(glyph_color)
                .into_any_element()
        } else {
            icon_sized("arrow-up", 17., glyph_color).into_any_element()
        };
        let primary = gpui_kit::base::Button::new("send-agent")
            .accessibility_label(action_label.clone())
            .disabled(!enabled || stopping)
            .size(px(theme::control()))
            .flex()
            .items_center()
            .justify_center()
            .ml(px(4.))
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
            .when(enabled, |b| {
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
        column()
            .flex_shrink_0()
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .py(px(12.))
            .child(
                column()
                    .w_full()
                    .min_w_0()
                    .max_w(px(900.))
                    .mx_auto()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(t.divider)
                    .bg(t.active)
                    .when(has_references, |d| {
                        d.child(div().px(px(12.)).pt(px(10.)).child(references))
                    })
                    .child(
                        div()
                            .px(px(8.))
                            .pt(px(6.))
                            .text_size(px(theme::ty().left.content))
                            .child(self.composer.clone()),
                    )
                    .child(
                        row()
                            .min_h(px(38.))
                            .pb(px(8.))
                            .px(px(8.))
                            .gap(px(8.))
                            .child(controls)
                            .child(row().gap(px(2.)).child(attach).child(primary)),
                    ),
            )
    }
}
