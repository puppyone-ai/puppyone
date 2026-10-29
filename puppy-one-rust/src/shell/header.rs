//! Port of `DesktopWindowChrome`, `DesktopTitlebarActions` and
//! `headerElements.tsx`: the Header's chrome and entries as components. The
//! shell decides what the Header shows (`Shell::header`) and wires the
//! project switcher to its popovers (`project_menu`); these only present.
//!
//! - [`TitleBar`]: `.desktop-titlebar`: leading entries after the native
//!   window controls, the empty space that moves the window, the trailing
//!   actions, and optionally a project centred over all of it
//! - [`ChangesButton`]: the Changes entry, showing [`GitTitlebarStatus`]
//! - [`agent_entry`], [`account_entry`]: the Agent entry and the homepage's
//!   public account / sign-in entry
use crate::{
    features::source_control::SourceControl,
    localization::{t as tr, tf},
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Icon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Selectable, h_flex};
use std::rc::Rc;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// `.desktop-titlebar`: the Header's chrome; it fills the frame it is
/// placed in.
#[derive(IntoElement, Default)]
pub(super) struct TitleBar {
    leading: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    centered: Option<AnyElement>,
    tabs: Option<AnyElement>,
    cloud: bool,
}
impl TitleBar {
    pub fn new() -> Self {
        Self::default()
    }
    /// The Cloud Computer is on screen (`--po-cloud-header-bg`).
    pub fn cloud(mut self, cloud: bool) -> Self {
        self.cloud = cloud;
        self
    }
    pub fn tabs(mut self, tabs: impl IntoElement) -> Self {
        self.tabs = Some(tabs.into_any_element());
        self
    }
    /// An entry after the native window controls (`.desktop-titlebar-left`),
    /// 2px from the previous one.
    pub fn leading(mut self, item: impl IntoElement) -> Self {
        self.leading.push(item.into_any_element());
        self
    }
    /// An entry at the window's end (`.desktop-titlebar-actions`), 2px from
    /// the previous one.
    pub fn action(mut self, item: impl IntoElement) -> Self {
        self.actions.push(item.into_any_element());
        self
    }
    /// `.desktop-titlebar-action-divider` (1×18, 3px margins) between two
    /// actions.
    pub fn divider(self, cx: &App) -> Self {
        let line = div()
            .w(px(1.))
            .h(px(18.))
            .mx(px(3.))
            .bg(cx.palette().shell_divider);
        self.action(line)
    }
    /// Centred over the whole bar (the `centeredProjectInHeader` experiment),
    /// at most 360px wide.
    pub fn centered(mut self, item: impl IntoElement) -> Self {
        self.centered = Some(item.into_any_element());
        self
    }
}
impl RenderOnce for TitleBar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        // Empty space moves the window; a double click zooms it.
        let with_tabs = self.tabs.is_some();
        let drag = div()
            .id("header-drag")
            .when(!with_tabs, |d| d.flex_1())
            .when(with_tabs, |d| {
                d.w(px(metric::TITLEBAR_DRAG_MIN_WIDTH)).flex_shrink_0()
            })
            .h_full()
            .min_w(px(metric::TITLEBAR_DRAG_MIN_WIDTH))
            .on_mouse_down(MouseButton::Left, |e, window, _| {
                if e.click_count == 2 {
                    window.zoom_window();
                } else {
                    window.start_window_move();
                }
            });
        div()
            .size_full()
            .flex()
            .items_center()
            .bg(if self.cloud {
                theme::cloud_header(&t)
            } else {
                t.header
            })
            .border_b_1()
            .border_color(t.shell_divider)
            .child(
                h_flex()
                    .h_full()
                    .min_w_0()
                    .pl(px(
                        metric::TITLEBAR_NATIVE_CONTROLS_INSET + metric::TITLEBAR_CONTENT_START
                    ))
                    .gap(px(2.))
                    .children(self.leading),
            )
            .when_some(self.tabs, |d, tabs| {
                d.child(div().flex_1().min_w_0().h_full().child(tabs))
            })
            .child(drag)
            .child(
                h_flex()
                    .h_full()
                    .gap(px(2.))
                    .pr(px(metric::TITLEBAR_CONTENT_END))
                    .children(self.actions),
            )
            .when_some(self.centered, |d, item| {
                d.child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .w_full()
                        .h_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(div().max_w(px(360.)).child(item)),
                )
            })
    }
}

/// `GitTitlebarStatus` projected from the native Git snapshot.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub(super) struct GitTitlebarStatus {
    pub conflicts: usize,
    pub incoming: u32,
    pub local: usize,
    pub outgoing: u32,
}
impl GitTitlebarStatus {
    pub fn of(source_control: &SourceControl) -> Self {
        source_control
            .snapshot
            .as_ref()
            .map(|s| Self {
                conflicts: s.changes.iter().filter(|c| c.conflict()).count(),
                incoming: s.behind,
                local: s.changes.len(),
                outgoing: s.ahead,
            })
            .unwrap_or_default()
    }
}
fn header_count(count: usize) -> String {
    if count > 99 {
        "99+".into()
    } else {
        count.to_string()
    }
}

/// The Header's Changes entry: conflicts (⚠), or incoming (↓), outgoing (↑)
/// and local (✱) counts, `✱ 0` when there is nothing; lit while the right
/// sidebar shows Changes.
#[derive(IntoElement)]
pub(super) struct ChangesButton {
    status: GitTitlebarStatus,
    selected: bool,
    coachmark: bool,
    on_click: Option<ClickHandler>,
}
impl ChangesButton {
    pub fn new(status: GitTitlebarStatus) -> Self {
        Self {
            status,
            selected: false,
            coachmark: false,
            on_click: None,
        }
    }
    /// Lit while its introduction shows.
    pub fn coachmark(mut self, coachmark: bool) -> Self {
        self.coachmark = coachmark;
        self
    }
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
    /// The accessible label: "Changes" and each count in words.
    fn label(&self) -> String {
        let status = self.status;
        let mut label = vec![tr("source-control.label.changes").to_string()];
        if status.conflicts > 0 {
            label.push(tf(
                "source-control.commit.conflicts",
                &[("count", status.conflicts.into())],
            ));
        }
        if status.local > 0 {
            label.push(tf(
                "source-control.commit.files",
                &[("count", status.local.into())],
            ));
        }
        if status.incoming > 0 {
            label.push(tf(
                "source-control.sync.pullCount",
                &[("count", status.incoming.into())],
            ));
        }
        if status.outgoing > 0 {
            label.push(tf(
                "source-control.sync.localWaiting",
                &[("count", status.outgoing.into())],
            ));
        }
        label.join(", ")
    }
}
impl Selectable for ChangesButton {
    fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    fn is_selected(&self) -> bool {
        self.selected
    }
}
impl RenderOnce for ChangesButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let status = self.status;
        let indicator = |icon: &'static str, color: Rgba, count: String| {
            h_flex()
                .h(px(20.))
                .gap(px(2.))
                .text_size(px(theme::ty().header.meta))
                .text_color(t.muted)
                .child(Icon::new(icon).color(color))
                .child(count)
        };
        let mut indicators = h_flex().gap(px(4.));
        if status.conflicts > 0 {
            let danger = theme::tint(t.danger, 0.78);
            indicators = indicators.child(
                indicator("triangle-alert", danger, header_count(status.conflicts))
                    .text_color(danger),
            );
        } else if status.local == 0 && status.incoming == 0 && status.outgoing == 0 {
            indicators = indicators.child(indicator("asterisk", t.muted, "0".into()));
        } else {
            if status.incoming > 0 {
                indicators = indicators.child(indicator(
                    "arrow-down",
                    theme::tint(t.accent, 0.74),
                    header_count(status.incoming as usize),
                ));
            }
            if status.outgoing > 0 {
                indicators = indicators.child(indicator(
                    "arrow-up",
                    theme::tint(t.success, 0.72),
                    header_count(status.outgoing as usize),
                ));
            }
            if status.local > 0 {
                indicators = indicators.child(indicator(
                    "asterisk",
                    theme::tint(t.warning, 0.76),
                    header_count(status.local),
                ));
            }
        }
        let label = self.label();
        Button::new("changes")
            .variant(if self.coachmark {
                ButtonVariant::TitlebarCoachmark
            } else {
                ButtonVariant::Titlebar
            })
            .accessibility_label(label.clone())
            .tooltip(label)
            .selected(self.selected)
            .min_w(px(theme::control()))
            .trailing(indicators)
            .when_some(self.on_click, |button, handler| {
                button.on_click(move |event, window, cx| handler(event, window, cx))
            })
    }
}

/// The Agent entry (`.desktop-titlebar-tool-action`): lit, and labelled
/// "Hide", while the right sidebar shows the workbench.
pub(super) fn agent_entry(open: bool) -> Button {
    let label = tr(if open {
        "shell.titlebar.hideAgent"
    } else {
        "shell.titlebar.showAgent"
    });
    Button::new("right")
        .variant(ButtonVariant::Titlebar)
        .icon("agent-entry")
        .accessibility_label(label)
        .tooltip(label)
        .selected(open)
        .w(px(metric::TITLEBAR_TOOL_ACTION_WIDTH))
}

/// `desktop-titlebar-share`: 16 px curved arrow (1.8 stroke) and "Share"
/// on a committed Cloud workspace (`CloudWorkspaceHeaderTools`).
pub(super) fn share_entry() -> Button {
    Button::new("cloud-share")
        .variant(ButtonVariant::Titlebar)
        .icon("forward")
        .label(tr("shell.titlebar.share"))
        .accessibility_label(tr("shell.titlebar.share"))
        .tooltip(tr("shell.titlebar.share"))
}

/// `desktop-titlebar-cloud-tool` History: a 15 px clock, pressed while the
/// sidebar shows it.
pub(super) fn history_entry(open: bool) -> Button {
    use gpui_kit::component::Sizable as _;
    Button::new("cloud-history")
        .variant(ButtonVariant::Titlebar)
        .icon(Icon::new("history").with_size(px(15.)))
        .accessibility_label(tr("source-control.history.title"))
        .tooltip(tr("source-control.history.title"))
        .selected(open)
}

/// Account settings entry; signing in does not enable Cloud project opening.
pub(super) fn account_entry(has_account: bool) -> Button {
    let ty = theme::ty().header;
    Button::new("home-sign-in")
        .variant(ButtonVariant::Titlebar)
        .label(tr(if has_account {
            "settings.account.title"
        } else {
            "cloud.auth.signIn"
        }))
        .accessibility_label(tr(if has_account {
            "settings.account.title"
        } else {
            "cloud.auth.signInToCloud"
        }))
        .pr(px(8.))
        .text_size(px(ty.content))
        .line_height(px(ty.line_height))
}
