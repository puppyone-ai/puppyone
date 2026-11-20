//! `AgentComposerToolbar`: the session pickers, the attachment menu and
//! the send/stop action.
use super::super::agent_theme::AgentTheme;
use super::{ComposerEvent, ComposerInput, ComposerView};
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlId;
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::components::{Icon, IconButton, MenuItem, PopoverMenu, tooltip};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};
use gpui_kit::component::Sizable as _;

impl ComposerView {
    pub(super) fn render_toolbar(
        &mut self,
        view: &ComposerInput,
        a: &AgentTheme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let runtime_label = view.runtime_label.clone();
        let running = view.running;
        let stopping = view.stopping;
        let submitting = view.submitting;
        let submittable = view.submittable;
        let viewport = f32::from(window.viewport_size().width);
        let mut controls = h_flex().min_w_0().flex_1().gap(px(2.)).overflow_hidden();
        for control in &view.session_controls {
            let width = match control.id {
                AgentSessionControlId::Model => 148f32.min(viewport * 0.34),
                AgentSessionControlId::Effort => 72f32.min(viewport * 0.2),
                AgentSessionControlId::Mode => 88f32.min(viewport * 0.22),
                AgentSessionControlId::Source => 160f32.min(viewport * 0.3),
            };
            let disabled = view.configuration_disabled;
            let picker = self
                .pickers
                .update(cx, |p, cx| p.picker(control, width, disabled, cx));
            controls = controls.child(div().min_w_0().flex_shrink(1.).child(picker));
        }
        let accepts_files = view.accepts_files;
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
                        .on_click(move |_, cx| {
                            let _ = host.update(cx, |_, cx| cx.emit(ComposerEvent::PickFiles));
                        }),
                )
                .item(
                    MenuItem::new(t("agent.reference.addFromWorkspace"))
                        .product_icon(crate::ui::components::ProductIcon::Folder)
                        .on_click(move |_, cx| {
                            let _ = workspace_host
                                .update(cx, |_, cx| cx.emit(ComposerEvent::PickWorkspace));
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
                .spinning("composer-send-busy")
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
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.emit(if running {
                    ComposerEvent::Stop
                } else {
                    ComposerEvent::Submit
                });
            }));
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
            )
    }
}
