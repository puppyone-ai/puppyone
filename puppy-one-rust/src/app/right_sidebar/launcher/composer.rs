//! L1 hero prompt composer card and its occluding Agent switcher popover.
//!
//! Uses the shared [`PopoverMenu`] and [`SurfaceFrame`] primitives so the
//! switcher inherits proper overlay layering (`POPUP_PRIORITY`), pointer
//! occlusion (preventing clicks from passing through to underlying recent
//! sessions), outside-click dismissal, and Escape focus restoration.
use super::*;
use crate::features::desktop_agent::AgentTheme;
use crate::localization::t as tr;
use crate::theme;
use crate::ui::agent_brand_mark::{LauncherIdentity, launcher_icon};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Dismiss, Icon, PopoverMenu, SurfaceFrame, SurfaceVariant, tooltip};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

impl WorkbenchLauncher {
    /// One row inside the Agent switcher popover. Keyed focus handles keep
    /// keyboard focus stable when discovery prepends newly found Agents.
    fn agent_picker_row(
        &mut self,
        group: Id,
        installation: &Installation,
        selected: bool,
        available: bool,
        dismiss: Dismiss,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Button {
        let t = cx.palette();
        let m = theme::ty();
        let id = installation.id;
        let key = SharedString::from(format!("launcher-pick-{group}-{id}"));
        let focus = self.row_focus(group, id, cx);
        let id_owned = id.to_owned();
        let host = cx.weak_entity();
        gpui_kit::base::Button::new(ElementId::Name(key.clone()))
            .accessibility_label(format!(
                "{}: {}",
                tr("terminal.launcher.title"),
                installation.label
            ))
            .debug_selector(move || format!("launcher-agent-{id}"))
            .track_focus(&focus)
            .group(key.clone())
            .w_full()
            .h(px(32.))
            .justify_start()
            .gap(px(9.))
            .px(px(8.))
            .rounded(px(7.))
            .text_color(if selected { t.text } else { t.muted })
            .disabled(!available)
            .when(available, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
            })
            .when(!available, |b| b.opacity(0.5))
            .child(
                launcher_icon(
                    LauncherIdentity::brand(installation.runtime.icon_key()),
                    true,
                    t.dark,
                    t.muted,
                )
                .group_hover(key, |s| s.opacity(1.)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .text_size(px(m.right.content))
                    .line_height(px(18.))
                    .truncate()
                    .child(installation.label.clone()),
            )
            .when(selected, |b| {
                b.child(
                    Icon::new("check")
                        .with_size(px(13.5))
                        .stroke(2.)
                        .color(t.text),
                )
            })
            .on_mouse_down(MouseButton::Left, |_, _, cx| {
                cx.stop_propagation();
            })
            .on_click(move |_, w, cx| {
                cx.stop_propagation();
                dismiss(w, cx);
                let _ = host.update(cx, |s, cx| s.select_agent(group, id_owned.clone(), w, cx));
            })
    }

    /// Floating occluding Agent switcher surface anchored under the selector pill.
    #[allow(clippy::too_many_arguments)]
    fn render_agent_popover_surface(
        &mut self,
        group: Id,
        tab: Option<Id>,
        active: Option<&Installation>,
        visible: &[Installation],
        chats: bool,
        terminals: bool,
        cloud: bool,
        dismiss: Dismiss,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let active_id = active.map(|i| i.id);

        let mut external = v_flex()
            .id(("launcher-agents", group))
            .role(Role::List)
            .debug_selector(|| "launcher-agents".into())
            .gap(px(1.));
        for installation in visible.iter().filter(|i| !i.bundled()) {
            let selected = active_id == Some(installation.id);
            let available = if installation.chat { chats } else { terminals };
            external = external.child(self.agent_picker_row(
                group,
                installation,
                selected,
                available,
                dismiss.clone(),
                cx,
            ));
        }

        let mut bundled = v_flex().gap(px(1.));
        for installation in visible.iter().filter(|i| i.bundled()) {
            let selected = active_id == Some(installation.id);
            let available = if installation.chat { chats } else { terminals };
            bundled = bundled.child(self.agent_picker_row(
                group,
                installation,
                selected,
                available,
                dismiss.clone(),
                cx,
            ));
        }

        let active_for_term = active.cloned();
        let can_open_in_term =
            !cloud && terminals && active_for_term.as_ref().is_some_and(|i| !i.bundled());
        let heading_label = tr(if cloud {
            "cloud.home.cloud"
        } else {
            "native.launcher.localAgents"
        });
        let host = cx.weak_entity();
        let dismiss_term = dismiss.clone();

        SurfaceFrame::new(("launcher-agent-popover", group))
            .variant(SurfaceVariant::Menu)
            .palette(t)
            .radius(12.)
            .absorb_mouse_down()
            .debug_selector(|| "launcher-agent-popover".into())
            .w(px(236.))
            .p(px(5.))
            .child(
                div()
                    .px(px(8.))
                    .pt(px(5.))
                    .pb(px(4.))
                    .text_size(px(11.))
                    .line_height(px(14.))
                    .text_color(t.subtle)
                    .child(heading_label),
            )
            .child(external)
            .child(bundled)
            .when(can_open_in_term, |d| {
                let target = active_for_term.clone();
                d.child(div().h(px(1.)).bg(t.divider).my(px(4.)).mx(px(6.)))
                    .child(
                        gpui_kit::base::Button::new(("launcher-open-in-term", group))
                            .w_full()
                            .h(px(30.))
                            .justify_start()
                            .gap(px(8.))
                            .px(px(8.))
                            .rounded(px(7.))
                            .text_size(px(12.))
                            .text_color(t.subtle)
                            .cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(t.hover).text_color(t.text))
                            .child(
                                Icon::new("square-terminal")
                                    .with_size(px(13.5))
                                    .stroke(1.75)
                                    .color(t.subtle),
                            )
                            .child(tr("native.launcher.openInTerminal"))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                cx.stop_propagation();
                            })
                            .on_click(move |_, w, cx| {
                                cx.stop_propagation();
                                dismiss_term(w, cx);
                                let target = target.clone();
                                let _ = host.update(cx, |s, cx| {
                                    s.set_picker_open(group, false, cx);
                                    s.chat_mode = false;
                                    s.launch(group, tab, target, w, cx);
                                });
                            }),
                    )
            })
            .into_any_element()
    }

    /// Prominent L1 hero composer card with inline occluding Agent switcher and
    /// circular send action. Performs zero child-entity mutations during render.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn render_hero_composer(
        &mut self,
        group: Id,
        tab: Option<Id>,
        active: Option<&Installation>,
        visible: &[Installation],
        chats: bool,
        terminals: bool,
        cloud: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let m = theme::ty();

        let input = self.ensure_group_input(group, tab, window, cx);
        let focused = input.focus_handle(cx).contains_focused(window, cx);
        let has_text = !input.read(cx).current_text(cx).trim().is_empty();
        let can_send = has_text && chats && active.is_some();
        let picker_open = self.is_picker_open(group);

        // Trigger pill: left edge sits at 6px bar + 7px pill = 13px, flush with
        // the prompt text inset (9px wrapper + 4px Textarea xsmall inset = 13px).
        let trigger = gpui_kit::base::Button::new(("launcher-agent-picker", group))
            .debug_selector(|| "launcher-agent-picker".into())
            .h(px(28.))
            .px(px(7.))
            .gap(px(6.))
            .rounded_full()
            .text_size(px(12.5))
            .line_height(px(16.))
            .text_color(if picker_open { t.text } else { t.muted })
            .when(picker_open, |b| b.bg(t.hover))
            .cursor(theme::clickable_cursor())
            .hover(move |s| s.bg(t.hover).text_color(t.text))
            .when_some(active, |b, inst| {
                b.child(launcher_icon(
                    LauncherIdentity::brand(inst.runtime.icon_key()),
                    true,
                    t.dark,
                    t.muted,
                ))
                .child(div().min_w_0().truncate().child(inst.label.clone()))
            })
            .child(
                Icon::new("chevron-down")
                    .with_size(px(10.5))
                    .stroke(2.)
                    .color(theme::alpha(t.subtle, 0.8)),
            );

        let host_toggle = cx.weak_entity();
        let host_content = cx.weak_entity();
        let active_cloned = active.cloned();
        let visible_cloned = visible.to_vec();
        let agent_pill = PopoverMenu::new(("launcher-agent-popover-menu", group))
            .anchor(Anchor::TopLeft)
            .offset(px(4.))
            .open(picker_open)
            .on_open_change(move |opened, _w, cx| {
                let _ = host_toggle.update(cx, |s, cx| {
                    s.set_picker_open(group, *opened, cx);
                });
            })
            .trigger(trigger)
            .content(move |dismiss, _w, cx| {
                host_content
                    .update(cx, |s, cx| {
                        s.render_agent_popover_surface(
                            group,
                            tab,
                            active_cloned.as_ref(),
                            &visible_cloned,
                            chats,
                            terminals,
                            cloud,
                            dismiss,
                            cx,
                        )
                    })
                    .unwrap_or_else(|_| div().into_any_element())
            });

        // Circular send button (matches active chat capsule geometry & states).
        let (send_bg, send_fg) = if can_send {
            (a.text, a.canvas)
        } else {
            (a.action_disabled_surface, a.action_disabled_text)
        };
        let send_button = gpui_kit::base::Button::new(("launcher-send", group))
            .debug_selector(|| "launcher-send".into())
            .accessibility_label(tr("agent.composer.send"))
            .disabled(!can_send)
            .flex_none()
            .size(px(30.))
            .child(
                div()
                    .size(px(30.))
                    .rounded_full()
                    .bg(send_bg)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        Icon::new("arrow-up")
                            .with_size(px(14.))
                            .stroke(2.)
                            .color(send_fg),
                    ),
            )
            .when(can_send, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(|s| s.opacity(0.86))
            })
            .tooltip(tooltip(tr("agent.composer.send")))
            .on_click(cx.listener(move |s, _, w, cx| s.submit_hero(group, w, cx)));

        let size = m.left.content;
        let line_height = size * 1.5;
        v_flex()
            .w_full()
            .min_w_0()
            .rounded(px(18.))
            .border_1()
            .border_color(if focused {
                a.composer_border_focus
            } else {
                a.composer_border
            })
            .bg(a.composer_surface)
            .shadow(a.composer_shadows(t.dark, focused))
            .child(
                div()
                    .debug_selector(|| "launcher-composer-input".into())
                    .w_full()
                    .min_w_0()
                    .pt(px(12.))
                    .pb(px(4.))
                    // 9px wrapper + Textarea's 4px inner inset = 13px symmetric horizontal padding.
                    .px(px(9.))
                    .text_size(px(size))
                    .line_height(px(line_height))
                    .child(input),
            )
            .child(
                h_flex()
                    .w_full()
                    .items_center()
                    .gap(px(2.))
                    .pt(px(2.))
                    .pb(px(6.))
                    .px(px(6.))
                    .child(div().min_w_0().flex_shrink(1.).child(agent_pill))
                    .child(div().flex_1())
                    .child(send_button),
            )
            .into_any_element()
    }
}
