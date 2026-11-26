//! L1 composer-first launcher for the right sidebar (`New tab` / empty
//! workbench): opens directly onto a prominent, auto-focused prompt composer
//! with an inline Agent switcher pill, recent sessions when history is
//! permitted, discovery/setup feedback, and quiet utility actions at the
//! bottom (Terminal, History, Scan again).
use super::*;
use crate::features::desktop_agent::{
    AgentTheme, create_agent_chat_history_target, format_history_date,
};
use crate::localization::{Arg, bidi_isolate, t as tr, tf};
use crate::theme;
use crate::ui::agent_brand_mark::{AgentMark, LauncherIdentity, launcher_icon, monochrome_mark};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, Spinner, tooltip};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

/// Responsive L1 stage width inside the right sidebar.
fn content_width(container: f32) -> f32 {
    (container - 24.).clamp(220., 360.)
}

/// Discovery feedback appears only after 200ms (`useDelayedDiscoveryFeedback`).
const FEEDBACK_DELAY: std::time::Duration = std::time::Duration::from_millis(200);

impl WorkbenchLauncher {
    /// `availabilityMessage` while discovery runs: nothing for the first
    /// 200ms, then what it is doing. Never a failure or an empty result:
    /// background discovery is best-effort and manual refresh stays.
    pub(super) fn discovery_label(&self) -> Option<&'static str> {
        let shown = self.scanning
            && !self.hosted.is_open()
            && self
                .scan_started
                .is_some_and(|start| start.elapsed() >= FEEDBACK_DELAY);
        shown.then_some(if self.refreshing {
            "terminal.launcher.refreshing"
        } else {
            "terminal.launcher.detecting"
        })
    }

    /// `availabilityMessage`, the launcher's polite status: what discovery
    /// is doing once its feedback shows, then that it finished — unless it
    /// failed or found no Agent, which it never announces.
    pub(super) fn availability(&self) -> Option<&'static str> {
        use crate::platform::local_agent_setup::{ObservationFailure, ObservationStatus};
        if self.hosted.is_open() {
            return None;
        }
        if self.scanning {
            return self.discovery_label();
        }
        let failed = self.observations.iter().any(|o| {
            o.status == ObservationStatus::Failed
                || o.failure == Some(ObservationFailure::EnvironmentUnavailable)
        });
        let found = self.installations.iter().any(|i| !i.bundled());
        (!failed && found).then_some("terminal.launcher.detectionComplete")
    }

    /// A picker Agent row's focus, kept by its Agent id so discovery never
    /// drops keyboard focus when prepending newly found Agents.
    fn row_focus(&mut self, group: Id, id: &'static str, cx: &mut Context<Self>) -> FocusHandle {
        self.row_focus
            .entry((group, id))
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }

    /// `onReturnToLauncher`: when a setup dialog closes, return keyboard focus
    /// to the launcher's hero composer (if usable) or else its heading.
    pub(super) fn return_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let group = self
            .setup_group
            .filter(|group| self.heading_focus.contains_key(group))
            .or_else(|| self.heading_focus.keys().min().copied());
        let Some(group) = group else {
            return;
        };
        let target = self
            .return_targets
            .get(&group)
            .and_then(|targets| targets.first())
            .or_else(|| self.heading_focus.get(&group));
        if let Some(target) = target.cloned() {
            target.focus(window, cx);
        }
    }

    /// The launcher's setup section, narrowed to this launcher's surface and
    /// the detected Agents.
    fn setup_section(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Option<Entity<crate::features::local_agents::SetupSection>> {
        use crate::features::local_agents::{Presentation, SetupSection};
        use crate::platform::local_agent_setup::Surface;
        let surface = if self.chat_mode {
            Surface::Chat
        } else {
            Surface::Terminal
        };
        if self.setup.is_none() {
            let preferences = self.preferences.clone()?;
            let owner = self.owner.clone();
            let host = cx.weak_entity();
            let section = cx.new(|cx| {
                SetupSection::new(Presentation::Launcher, surface, preferences, owner, cx)
                    .on_return(move |window, cx| {
                        let _ = host.update(cx, |l, cx| l.return_focus(window, cx));
                    })
            });
            cx.observe(&section, |_, _, cx| cx.notify()).detach();
            self.setup = Some(section);
        }
        let section = self.setup.clone()?;
        let observations = if self.scanning {
            vec![]
        } else {
            self.observations.clone()
        };
        section.update(cx, |s, cx| {
            s.set_surface(surface, cx);
            s.set_observations(observations, cx);
        });
        section.update(cx, |s, cx| s.visible(cx)).then_some(section)
    }

    /// One row inside the Agent switcher popover.
    fn agent_picker_row(
        &mut self,
        group: Id,
        installation: &Installation,
        selected: bool,
        available: bool,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Button {
        let t = cx.palette();
        let m = theme::ty();
        let id = installation.id;
        let key = SharedString::from(format!("launcher-pick-{group}-{id}"));
        let focus = self.row_focus(group, id, cx);
        let id_owned = id.to_owned();
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
            .on_click(cx.listener(move |s, _, w, cx| {
                s.select_agent(group, id_owned.clone(), w, cx);
            }))
    }

    /// Floating popover menu anchored under the inline Agent selector pill.
    #[allow(clippy::too_many_arguments)]
    fn render_agent_popover(
        &mut self,
        group: Id,
        tab: Option<Id>,
        active: Option<&Installation>,
        visible: &[Installation],
        chats: bool,
        terminals: bool,
        cloud: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let active_id = active.map(|i| i.id);
        let focus = self
            .picker_focus
            .entry(group)
            .or_insert_with(|| cx.focus_handle())
            .clone();

        let mut external = v_flex()
            .id(("launcher-agents", group))
            .role(Role::List)
            .debug_selector(|| "launcher-agents".into())
            .gap(px(1.));
        for installation in visible.iter().filter(|i| !i.bundled()) {
            let selected = active_id == Some(installation.id);
            let available = if installation.chat { chats } else { terminals };
            external =
                external.child(self.agent_picker_row(group, installation, selected, available, cx));
        }

        let mut bundled = v_flex().gap(px(1.));
        for installation in visible.iter().filter(|i| i.bundled()) {
            let selected = active_id == Some(installation.id);
            let available = if installation.chat { chats } else { terminals };
            bundled =
                bundled.child(self.agent_picker_row(group, installation, selected, available, cx));
        }

        let active_for_term = active.cloned();
        let can_open_in_term =
            !cloud && terminals && active_for_term.as_ref().is_some_and(|i| !i.bundled());
        let heading_label = tr(if cloud {
            "cloud.home.cloud"
        } else {
            "native.launcher.localAgents"
        });
        let shadow = theme::popover_elevation(t.dark);

        v_flex()
            .id(("launcher-agent-popover", group))
            .debug_selector(|| "launcher-agent-popover".into())
            .track_focus(&focus)
            .w(px(236.))
            .p(px(5.))
            .rounded(px(12.))
            .border_1()
            .border_color(a.composer_border)
            .bg(t.menu_bg)
            .shadow(shadow)
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                if s.picker_open.take().is_some() {
                    cx.notify();
                }
            }))
            .on_key_down(cx.listener(move |s, event: &KeyDownEvent, w, cx| {
                if event.keystroke.key == "escape" {
                    s.picker_open = None;
                    s.focus_group(group, w, cx);
                    cx.stop_propagation();
                    cx.notify();
                }
            }))
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
                            .on_click(cx.listener(move |s, _, w, cx| {
                                s.picker_open = None;
                                s.chat_mode = false;
                                s.launch(group, tab, target.clone(), w, cx);
                            })),
                    )
            })
            .into_any_element()
    }

    /// Quiet bottom utility action button (`Terminal`, `History`, `Scan again`).
    fn footer_button(
        id: ElementId,
        selector: &'static str,
        icon: &'static str,
        label: &'static str,
        disabled: bool,
        cx: &App,
    ) -> gpui_kit::base::Button {
        let t = cx.palette();
        gpui_kit::base::Button::new(id)
            .accessibility_label(label)
            .debug_selector(move || selector.into())
            .h(px(26.))
            .px(px(9.))
            .gap(px(6.))
            .rounded(px(7.))
            .text_size(px(12.))
            .line_height(px(16.))
            .text_color(t.subtle)
            .disabled(disabled)
            .when(disabled, |b| b.opacity(0.45))
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
            })
            .child(
                Icon::new(icon)
                    .with_size(px(13.))
                    .stroke(1.75)
                    .color(t.subtle),
            )
            .child(label)
    }

    /// The launcher tab `context.tab`: its History browser when open, else
    /// the L1 composer-first launcher.
    pub(super) fn render_launcher(
        &mut self,
        context: LauncherContext,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if let Some(history) = context.tab.and_then(|tab| self.render_history(tab)) {
            return history;
        }
        self.launcher(context, window, cx).into_any_element()
    }

    fn launcher(
        &mut self,
        context: LauncherContext,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let LauncherContext {
            group, tab, width, ..
        } = context;
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let m = theme::ty();
        let cloud = self.hosted.is_open();
        let visible = self.visible_installations();
        let active = self.active_installation();
        let (chats, terminals) = (context.can_chat, context.can_terminal);

        // Hero prompt input + dynamic Agent-named placeholder.
        let input = self.hero_input(group, tab, window, cx);
        let placeholder = match &active {
            Some(inst) => tf(
                "native.launcher.askPlaceholder",
                &[("agent", Arg::Text(bidi_isolate(&inst.label)))],
            ),
            None => tr("agent.composer.placeholder.default").to_string(),
        };
        input.update(cx, |i, _| i.set_placeholder(placeholder));
        let focused = input.focus_handle(cx).contains_focused(window, cx);
        let has_text = !input.read(cx).current_text(cx).trim().is_empty();
        let can_send = has_text && chats && active.is_some();

        // Setup focus return targets: prefer the hero input when an Agent is
        // available, else fall back to the non-tab-stop heading.
        let mut returns = Vec::new();
        if chats && active.is_some() {
            returns.push(input.focus_handle(cx));
        }
        self.return_targets.insert(group, returns);

        let heading_focus = self
            .heading_focus
            .entry(group)
            .or_insert_with(|| cx.focus_handle().tab_stop(false))
            .clone();

        // Workspace folder name for the subtle greeting subtitle.
        let project_name = (!cloud)
            .then(|| {
                self.shown
                    .root
                    .as_ref()
                    .and_then(|root| root.file_name().map(|n| n.to_string_lossy().into_owned()))
                    .filter(|name| !name.is_empty())
            })
            .flatten();

        // Inline Agent selector pill + optional floating switcher popover.
        let picker_open = self.picker_open == Some(group);
        let popover = picker_open.then(|| {
            self.render_agent_popover(
                group,
                tab,
                active.as_ref(),
                &visible,
                chats,
                terminals,
                cloud,
                cx,
            )
        });
        let agent_pill = div()
            .relative()
            .min_w_0()
            .flex_shrink(1.)
            .child(
                gpui_kit::base::Button::new(("launcher-agent-picker", group))
                    .debug_selector(|| "launcher-agent-picker".into())
                    .h(px(28.))
                    .px(px(8.))
                    .gap(px(6.))
                    .rounded_full()
                    .text_size(px(12.5))
                    .line_height(px(16.))
                    .text_color(if picker_open { t.text } else { t.muted })
                    .when(picker_open, |b| b.bg(t.hover))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
                    .when_some(active.as_ref(), |b, inst| {
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
                    )
                    .on_click(cx.listener(move |s, _, w, cx| {
                        if s.picker_open == Some(group) {
                            s.picker_open = None;
                            s.focus_group(group, w, cx);
                        } else {
                            s.picker_open = Some(group);
                            let focus = s
                                .picker_focus
                                .entry(group)
                                .or_insert_with(|| cx.focus_handle())
                                .clone();
                            focus.focus(w, cx);
                        }
                        cx.notify();
                    })),
            )
            .when_some(popover, |d, pop| {
                d.child(
                    div().absolute().top_0().left_0().child(
                        deferred(
                            anchored()
                                .anchor(Anchor::TopLeft)
                                .offset(point(px(0.), px(32.)))
                                .snap_to_window_with_margin(px(8.))
                                .child(pop),
                        )
                        .with_priority(1),
                    ),
                )
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

        // Hero prominent composer card.
        let size = m.left.content;
        let line_height = size * 1.5;
        let hero_card = v_flex()
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
                    .child(agent_pill)
                    .child(div().flex_1())
                    .child(send_button),
            );

        // Discovery feedback (200ms delayed, outside the Agent list).
        let scanning = self.scanning && !cloud;
        let feedback = self.discovery_label();
        if scanning && feedback.is_none() {
            let wake = self.wake.clone();
            wake.after(FEEDBACK_DELAY);
        }
        let discovery_row = feedback.map(|label| {
            h_flex()
                .debug_selector(|| "launcher-discovery".into())
                .w_full()
                .justify_center()
                .gap(px(7.))
                .py(px(2.))
                .text_size(px(m.right.caption))
                .line_height(px(m.right.meta_line_height))
                .text_color(t.subtle)
                .child(Spinner::new(
                    ElementId::NamedInteger("launcher-scanning".into(), group),
                    t.border,
                    t.subtle,
                ))
                .child(tr(label))
        });

        // Optional local agent setup suggestion section.
        let setup_view = (!cloud)
            .then(|| self.setup_section(cx))
            .flatten()
            .map(|setup| {
                div()
                    .debug_selector(|| "launcher-setup".into())
                    .w_full()
                    .capture_any_mouse_down(
                        cx.listener(move |s, _, _, _| s.setup_group = Some(group)),
                    )
                    .capture_key_down(cx.listener(move |s, _, _, _| s.setup_group = Some(group)))
                    .child(setup)
            });

        // Launch refusal / failure error banner.
        let error_row = self.launch_errors.get(&group).map(|message| {
            h_flex()
                .debug_selector(|| "launcher-error".into())
                .w_full()
                .min_w_0()
                .items_start()
                .gap(px(6.))
                .px(px(10.))
                .py(px(7.))
                .rounded(px(8.))
                .bg(theme::alpha(t.danger, 0.08))
                .text_color(t.danger)
                .text_size(px(m.right.caption))
                .line_height(px(m.right.caption_line_height))
                .child(
                    div().mt(px(1.)).flex_shrink_0().child(
                        Icon::new("circle-alert")
                            .with_size(px(13.))
                            .stroke(1.7)
                            .color(t.danger),
                    ),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .whitespace_normal()
                        .child(message.clone()),
                )
        });

        // Recent sessions (shown only when history is already available/permitted).
        let recent = self.recent_sessions(cx);
        let recent_section = (!recent.is_empty()).then(|| {
            let mut list = v_flex().w_full().gap(px(1.));
            for (index, session) in recent.iter().enumerate() {
                let icon_key = session
                    .runtime
                    .as_ref()
                    .and_then(|r| r.icon_key.as_deref())
                    .or(session.runtime_id.as_deref())
                    .unwrap_or("");
                let mark = AgentMark::from_icon_key(icon_key);
                let title = if session.title.trim().is_empty() {
                    tr("agent.header.newChat").to_string()
                } else {
                    session.title.clone()
                };
                let updated = (session.updated_at_known != Some(false))
                    .then_some(session.updated_at.as_str())
                    .filter(|at| !at.is_empty())
                    .and_then(crate::clock::date_parse)
                    .map(format_history_date)
                    .unwrap_or_default();
                let target = create_agent_chat_history_target(session);
                list = list.child(
                    h_flex()
                        .id(("launcher-recent", group * 8 + index as u64))
                        .h(px(32.))
                        .w_full()
                        .px(px(8.))
                        .gap(px(8.))
                        .rounded(px(7.))
                        .text_size(px(13.))
                        .text_color(a.text_muted)
                        .cursor(theme::navigation_cursor())
                        .hover(move |s| s.bg(t.hover).text_color(t.text))
                        .children(mark.map(|runtime| {
                            monochrome_mark(runtime, t.dark, 14., a.text_subtle, t.canvas)
                        }))
                        .child(div().flex_1().min_w_0().truncate().child(title))
                        .when(!updated.is_empty(), |r| {
                            r.child(
                                div()
                                    .flex_shrink_0()
                                    .text_size(px(11.5))
                                    .text_color(a.text_subtle)
                                    .child(updated),
                            )
                        })
                        .on_click(cx.listener(move |s, _, w, cx| {
                            let Some(workbench) = s.workbench.upgrade() else {
                                return;
                            };
                            let Some(target_tab) = tab.or_else(|| {
                                workbench.update(cx, |wb, cx| wb.new_launcher_tab(group, cx))
                            }) else {
                                return;
                            };
                            if s.hosted.is_open() {
                                s.open_hosted_history_target(
                                    group,
                                    target_tab,
                                    target.clone(),
                                    w,
                                    cx,
                                );
                            } else {
                                s.restore_history_target(group, target_tab, target.clone(), w, cx);
                            }
                        })),
                );
            }
            v_flex()
                .w_full()
                .mt(px(10.))
                .gap(px(4.))
                .child(
                    h_flex()
                        .w_full()
                        .px(px(8.))
                        .items_center()
                        .justify_between()
                        .text_size(px(11.5))
                        .text_color(t.subtle)
                        .child(tr("native.launcher.recent"))
                        .child(
                            div()
                                .id(("launcher-recent-all", group))
                                .cursor(theme::clickable_cursor())
                                .hover(move |s| s.text_color(t.text))
                                .on_click(
                                    cx.listener(move |s, _, w, cx| {
                                        s.open_history(group, tab, w, cx)
                                    }),
                                )
                                .child(tr("native.launcher.allHistory")),
                        ),
                )
                .child(list)
        });

        // Quiet bottom utility bar: Terminal (local), History, Scan again (local).
        let history_btn = Self::footer_button(
            ElementId::NamedInteger("launcher-history".into(), group),
            "launcher-history",
            "history",
            tr("agent.history.title"),
            false,
            cx,
        )
        .on_click(cx.listener(move |s, _, w, cx| s.open_history(group, tab, w, cx)));

        let footer = h_flex()
            .flex_shrink_0()
            .w_full()
            .justify_center()
            .gap(px(4.))
            .pt(px(4.))
            .pb(px(12.))
            .when(!cloud, |f| {
                f.child(
                    Self::footer_button(
                        ElementId::NamedInteger("open-shell".into(), group),
                        "launcher-shell",
                        "square-terminal",
                        tr("terminal.title"),
                        !terminals,
                        cx,
                    )
                    .on_click(cx.listener(move |s, _, w, cx| s.launch(group, tab, None, w, cx))),
                )
            })
            .child(history_btn)
            .when(!cloud, |f| {
                f.child(
                    Self::footer_button(
                        ElementId::NamedInteger("launcher-scan".into(), group),
                        "launcher-scan",
                        "refresh-cw",
                        tr("terminal.launcher.scanAgain"),
                        self.scanning,
                        cx,
                    )
                    .on_click(cx.listener(|s, _, _, cx| s.rescan(cx))),
                )
            });

        // Accessible status region (`role="status"`), outside the Agent list.
        let availability = div()
            .id(("launcher-availability", group))
            .role(Role::Status)
            .when_some(self.availability(), |d, message| d.aria_label(tr(message)))
            .test_support()
            .absolute()
            .size(px(1.))
            .overflow_hidden();

        let greeting = v_flex()
            .w_full()
            .items_center()
            .mb(px(16.))
            .child(
                div().mb(px(10.)).child(
                    Icon::new("sparkles")
                        .with_size(px(26.))
                        .stroke(1.4)
                        .color(a.empty_brand),
                ),
            )
            .child(
                div()
                    .id(("launcher-heading", group))
                    .test_support()
                    .track_focus(&heading_focus)
                    .role(Role::Heading)
                    .aria_label(tr("native.launcher.greeting"))
                    .text_size(px(15.))
                    .line_height(px(21.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .text_center()
                    .child(tr("native.launcher.greeting")),
            )
            .when_some(project_name, |d, name| {
                d.child(
                    div()
                        .mt(px(4.))
                        .text_size(px(12.5))
                        .line_height(px(17.))
                        .text_color(t.subtle)
                        .text_center()
                        .child(tf(
                            "native.launcher.workingIn",
                            &[("project", Arg::Text(bidi_isolate(&name)))],
                        )),
                )
            });

        let scroll = self.launcher_scroll.entry(group).or_default().clone();
        div()
            .id(("launcher", group))
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&scroll)
            .bg(t.auxiliary())
            .text_color(t.terminal_fg)
            .child(
                v_flex()
                    .min_h_full()
                    .w_full()
                    .child(
                        v_flex()
                            .flex_1()
                            .w_full()
                            .px(px(12.))
                            .pt(px(20.))
                            .pb(px(12.))
                            .items_center()
                            .justify_center()
                            .child(
                                v_flex()
                                    .w(px(content_width(width)))
                                    .max_w_full()
                                    .child(greeting)
                                    .child(hero_card)
                                    .children(error_row.map(|e| div().mt(px(10.)).child(e)))
                                    .children(discovery_row.map(|d| div().mt(px(10.)).child(d)))
                                    .children(setup_view.map(|s| div().mt(px(12.)).child(s)))
                                    .children(recent_section)
                                    .child(availability),
                            ),
                    )
                    .child(footer),
            )
            .child(crate::ui::scrollbar::vertical(
                ("launcher-scrollbar", group),
                &scroll,
            ))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn content_width_scales_cleanly_within_sidebar() {
        assert_eq!(super::content_width(200.), 220.);
        assert_eq!(super::content_width(340.), 316.);
        assert_eq!(super::content_width(500.), 360.);
    }
}
