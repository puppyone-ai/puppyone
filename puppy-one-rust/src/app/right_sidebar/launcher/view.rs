//! L1 composer-first launcher layout composition for the right sidebar:
//! hero composer card (`composer.rs`), delayed discovery feedback, local Agent
//! setup suggestions, recent sessions when history is permitted, and quiet
//! bottom utility actions (Terminal, History, Scan again).
use super::*;
use crate::features::desktop_agent::{
    AgentTheme, create_agent_chat_history_target, format_history_date,
};
use crate::localization::{Arg, bidi_isolate, t as tr, tf};
use crate::theme;
use crate::ui::agent_brand_mark::{AgentMark, monochrome_mark};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, Spinner};
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

    /// `onReturnToLauncher`: when a setup dialog closes, return keyboard focus
    /// to the launcher's hero composer (when an Agent is usable) or else its
    /// non-tab-stop heading.
    pub(super) fn return_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let group = self
            .setup_group
            .filter(|group| self.groups.contains_key(group))
            .or_else(|| self.groups.keys().min().copied());
        let Some(group) = group else {
            return;
        };
        let can_chat = self
            .workbench
            .upgrade()
            .is_none_or(|w| w.read(cx).can_create(ItemKind::Chat));
        let target = if can_chat && self.active_installation().is_some() {
            self.groups
                .get(&group)
                .and_then(|g| g.input.as_ref().map(|i| i.focus_handle(cx)))
        } else {
            None
        }
        .or_else(|| self.groups.get(&group).map(|g| g.heading_focus.clone()));
        if let Some(target) = target {
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

    /// Recent sessions list shown beneath the hero composer when history is
    /// permitted and cached sessions exist.
    fn render_recent_sessions(
        &self,
        group: Id,
        tab: Option<Id>,
        recent: &[crate::agent::contract::dto::SessionMetadata],
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if recent.is_empty() {
            return None;
        }
        let t = cx.palette();
        let a = AgentTheme::new(&t);
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
                    .debug_selector(move || format!("launcher-recent-{index}"))
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
                            s.open_hosted_history_target(group, target_tab, target.clone(), w, cx);
                        } else {
                            s.restore_history_target(group, target_tab, target.clone(), w, cx);
                        }
                    })),
            );
        }
        Some(
            v_flex()
                .w_full()
                .mt(px(22.))
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
                                .debug_selector(|| "launcher-history".into())
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
                .into_any_element(),
        )
    }

    /// Quiet bottom utility bar: Terminal (local), History (only when Recent
    /// isn't already showing "All history"), Scan again (local).
    fn render_footer(
        &self,
        group: Id,
        tab: Option<Id>,
        cloud: bool,
        terminals: bool,
        has_recent: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let history_btn = (!has_recent).then(|| {
            Self::footer_button(
                ElementId::NamedInteger("launcher-history".into(), group),
                "launcher-history",
                "history",
                tr("agent.history.title"),
                false,
                cx,
            )
            .on_click(cx.listener(move |s, _, w, cx| s.open_history(group, tab, w, cx)))
        });

        h_flex()
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
            .children(history_btn)
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
            })
            .into_any_element()
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
        let m = theme::ty();
        let cloud = self.hosted.is_open();
        let visible = self.visible_installations();
        let active = self.active_installation();
        let (chats, terminals) = (context.can_chat, context.can_terminal);

        let hero_card = self.render_hero_composer(
            group,
            tab,
            active.as_ref(),
            &visible,
            chats,
            terminals,
            cloud,
            window,
            cx,
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
        let error_row = self.launch_error(group).map(|message| {
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
                        .child(message.to_owned()),
                )
        });

        let recent = self.recent_sessions(cx);
        let has_recent = !recent.is_empty();
        let recent_section = self.render_recent_sessions(group, tab, &recent, cx);
        let footer = self.render_footer(group, tab, cloud, terminals, has_recent, cx);

        // Polite screen-reader availability region (visually silent).
        let availability = div()
            .id(("launcher-availability", group))
            .role(Role::Status)
            .when_some(self.availability(), |d, message| d.aria_label(tr(message)))
            .test_support()
            .absolute()
            .size(px(1.))
            .overflow_hidden();

        // Restrained header above the composer: quiet PuppyOne brand mark,
        // calm medium title, and a single subtle workspace line.
        let subtitle = if cloud {
            Some(tr("cloud.home.cloud").to_string())
        } else {
            self.shown
                .root
                .as_ref()
                .and_then(|root| root.file_name().map(|n| n.to_string_lossy().into_owned()))
                .filter(|name| !name.is_empty())
                .map(|name| {
                    tf(
                        "native.launcher.workingIn",
                        &[("project", Arg::Text(bidi_isolate(&name)))],
                    )
                })
        };
        let heading_focus = self.heading_focus(group, cx);
        let header = v_flex()
            .w_full()
            .items_center()
            .mb(px(16.))
            .child(
                div()
                    .debug_selector(|| "launcher-brand-logo".into())
                    .mb(px(10.))
                    .opacity(0.78)
                    .child(
                        img(SharedString::from(if t.dark {
                            "brand/puppy-dark-onboarding.svg"
                        } else {
                            "brand/puppy-lite.svg"
                        }))
                        .size(px(24.))
                        .object_fit(ObjectFit::Contain),
                    ),
            )
            .child(
                div()
                    .id(("launcher-heading", group))
                    .debug_selector(|| "launcher-heading".into())
                    .test_support()
                    .track_focus(&heading_focus)
                    .role(Role::Heading)
                    .aria_label(tr("native.launcher.greeting"))
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .text_center()
                    .child(tr("native.launcher.greeting")),
            )
            .when_some(subtitle, |d, line| {
                d.child(
                    div()
                        .debug_selector(|| "launcher-subtitle".into())
                        .mt(px(3.))
                        .max_w_full()
                        .truncate()
                        .text_size(px(12.))
                        .line_height(px(16.))
                        .text_color(t.subtle)
                        .text_center()
                        .child(line),
                )
            });

        let scroll = self.group_scroll(group, cx);
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
                                    .relative()
                                    .w(px(content_width(width)))
                                    .max_w_full()
                                    .child(header)
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
