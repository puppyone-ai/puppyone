//! `AgentComposerToolbar`: the capsule's inline attach & circular send/stop
//! buttons, plus the quiet model / effort / mode chips underneath.
use super::super::agent_theme::AgentTheme;
use super::{ComposerEvent, ComposerInput, ComposerView};
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlId;
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::components::{Icon, IconButton, MenuItem, PopoverMenu, tooltip};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};
use gpui_kit::component::Sizable as _;

/// Capsule inline button height (matches single-line prompt `21px + 2 * 4.5px`).
pub(super) const CAPSULE_ACTION: f32 = 30.;

impl ComposerView {
    /// Leading `+` attachment menu inside the capsule.
    pub(super) fn render_attach(
        &self,
        view: &ComposerInput,
        a: &AgentTheme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let accepts_files = view.accepts_files;
        let host = cx.weak_entity();
        let workspace_host = cx.weak_entity();
        PopoverMenu::new("agent-panel-attach-menu")
            .anchor(Anchor::BottomLeft)
            .trigger(
                IconButton::new(
                    "agent-panel-attach",
                    Icon::new("plus").with_size(px(16.)).stroke(1.75),
                )
                .label(t("agent.reference.add"))
                .with_size(px(CAPSULE_ACTION))
                .size(px(CAPSULE_ACTION))
                .rounded_full()
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
            })
            .into_any_element()
    }

    /// Trailing circular send/stop action inside the capsule: ghost circle when
    /// empty/disabled, high-contrast solid circle when ready or running.
    pub(super) fn render_primary_action(
        &self,
        view: &ComposerInput,
        a: &AgentTheme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let runtime_label = view.runtime_label.clone();
        let running = view.running;
        let stopping = view.stopping;
        let submitting = view.submitting;
        let submittable = view.submittable;
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
                .with_size(px(14.))
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
                .with_size(px(14.))
                .stroke(2.)
                .color(glyph_color)
                .into_any_element()
        };
        gpui_kit::base::Button::new("agent-panel-primary")
            .debug_selector(|| "agent-composer-action".into())
            .accessibility_label(action_label.clone())
            .disabled(disabled)
            .flex_none()
            .size(px(CAPSULE_ACTION))
            .opacity(if stopping { 0.52 } else { 1. })
            .child(
                div()
                    .size(px(CAPSULE_ACTION))
                    .rounded_full()
                    .bg(surface)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(glyph),
            )
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(|s| s.opacity(0.86))
            })
            .tooltip(tooltip(action_label))
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.emit(if running {
                    ComposerEvent::Stop
                } else {
                    ComposerEvent::Submit
                });
            }))
            .into_any_element()
    }

    /// Quiet model / effort / mode chips sitting below the capsule, left-aligned
    /// to the sidebar's 16pt grid (`dock` 8 + `pl` 2 + chip `px` 6 = 16).
    pub(super) fn render_controls_row(
        &mut self,
        view: &ComposerInput,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if view.session_controls.is_empty() {
            return None;
        }
        let viewport = f32::from(window.viewport_size().width);
        let mut controls = h_flex()
            .w_full()
            .min_w_0()
            .mt(px(5.))
            .pl(px(2.))
            .gap(px(4.))
            .overflow_hidden();
        for control in &view.session_controls {
            let width = match control.id {
                AgentSessionControlId::Model => 160f32.min(viewport * 0.42),
                AgentSessionControlId::Effort => 84f32.min(viewport * 0.24),
                AgentSessionControlId::Mode => 96f32.min(viewport * 0.26),
            };
            let disabled = view.configuration_disabled;
            let picker = self
                .pickers
                .update(cx, |p, cx| p.picker(control, width, disabled, cx));
            controls = controls.child(div().min_w_0().flex_shrink(1.).child(picker));
        }
        Some(controls.into_any_element())
    }
}
