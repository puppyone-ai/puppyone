//! Port of `app-shell/headerCoachmarks.ts` (`useHeaderCoachmarks`) and
//! `HeaderFeatureCoachmark.tsx`: one-time Header introductions. The Agent
//! entry is introduced when a project is entered, Changes when its first
//! local change appears; each is acknowledged once (persisted) unless the
//! experiment shows them every time. Only one shows at a time; Changes waits
//! behind the Agent introduction.
//!
//! [`HeaderCoachmarks`] is the entity: it follows the right sidebar, the
//! Git status and the preferences itself, takes what the window shows as a
//! [`SessionView`], measures its entry where the Header paints it
//! ([`HeaderCoachmarks::anchor`]) and draws the overlay as its view.
use super::{
    Command, dialogs::DialogLayer, right_sidebar::RightSidebar, right_sidebar::Surface,
    session::SessionView,
};
use crate::features::settings::{HeaderCoachmarks as Progress, PreferencesStore};
use crate::theme;
use crate::theme::Theme;
use crate::theme::metric;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Button;
use crate::ui::components::ButtonVariant;
use crate::ui::components::Icon;
use crate::ui::components::MenuVariant;
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Coachmark {
    Agent,
    Changes,
}
impl Coachmark {
    fn key(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Changes => "changes",
        }
    }
}
/// What the Header knows this frame.
pub struct Inputs<'a> {
    pub agent_open: bool,
    pub changes_open: bool,
    /// Local changes of a repository; `None` outside one.
    pub local: Option<usize>,
    /// The current project entry (one per opening).
    pub entry: Option<&'a str>,
    /// The focused project.
    pub scope: Option<&'a str>,
    /// `enableAlwaysShowOnboardingCoachmarks`.
    pub always: bool,
    pub progress: Progress,
}
#[derive(Default)]
pub struct Coachmarks {
    pub active: Option<Coachmark>,
    last_agent_key: Option<String>,
    previous_scope: Option<String>,
    previous_local: Option<usize>,
    last_replay_scope: Option<String>,
    pending_changes: bool,
    /// The anchor of the shown introduction, as last painted.
    pub anchor: Option<Bounds<Pixels>>,
}
impl Coachmarks {
    /// The hook's effects, idempotent per frame; returns the progress to
    /// persist when an introduction was acknowledged.
    pub fn observe(&mut self, i: &Inputs) -> Option<Progress> {
        let mut progress = i.progress;
        let agent_key = if i.always {
            i.scope.map(|s| format!("always:{s}"))
        } else {
            i.entry.map(|e| format!("once:{e}"))
        };
        if let Some(key) = agent_key
            && self.last_agent_key.as_ref() != Some(&key)
            && !((!i.always && progress.agent) || i.agent_open)
        {
            self.last_agent_key = Some(key);
            self.active = self.active.or(Some(Coachmark::Agent));
        }
        let scope = i.scope.map(str::to_owned);
        if self.previous_scope != scope {
            self.previous_scope = scope.clone();
            self.previous_local = None;
            self.last_replay_scope = None;
            self.pending_changes = false;
        }
        match i.local {
            None => {
                self.previous_local = None;
                self.last_replay_scope = None;
            }
            Some(local) => {
                let previous = self.previous_local.replace(local);
                let trigger = if i.always {
                    if local == 0 {
                        self.last_replay_scope = None;
                        false
                    } else if scope.is_none() || self.last_replay_scope == scope || i.changes_open {
                        false
                    } else {
                        self.last_replay_scope = scope;
                        true
                    }
                } else {
                    self.last_replay_scope = None;
                    previous == Some(0) && local > 0 && !progress.changes && !i.changes_open
                };
                if trigger {
                    match self.active {
                        None => self.active = Some(Coachmark::Changes),
                        Some(Coachmark::Agent) => self.pending_changes = true,
                        Some(Coachmark::Changes) => {}
                    }
                }
            }
        }
        let mut changed = false;
        if i.agent_open {
            changed |= self.acknowledge(Coachmark::Agent, i.always, &mut progress);
        }
        if i.changes_open {
            changed |= self.acknowledge(Coachmark::Changes, i.always, &mut progress);
        }
        changed.then_some(progress)
    }
    /// `acknowledge`: true when the persisted progress changed.
    pub fn acknowledge(&mut self, id: Coachmark, always: bool, progress: &mut Progress) -> bool {
        if id == Coachmark::Changes {
            self.pending_changes = false;
        }
        let mut changed = false;
        if !always {
            let seen = match id {
                Coachmark::Agent => &mut progress.agent,
                Coachmark::Changes => &mut progress.changes,
            };
            changed = !*seen;
            *seen = true;
        }
        if self.active == Some(id) {
            self.active = if id == Coachmark::Agent && self.pending_changes {
                self.pending_changes = false;
                Some(Coachmark::Changes)
            } else {
                None
            };
            self.anchor = None;
        }
        changed
    }
}

/// `COACHMARK_WIDTH`, `gap`, `margin`.
const WIDTH: f32 = 320.;
const GAP: f32 = 10.;
const MARGIN: f32 = 8.;

/// The Header introductions of one window.
pub(super) struct HeaderCoachmarks {
    pub state: Coachmarks,
    session: SessionView,
    preferences: Entity<PreferencesStore>,
    sidebar: Entity<RightSidebar>,
    dialogs: Entity<DialogLayer>,
    weak: WeakEntity<Self>,
}
/// The overlay's primary action: the window opens what it introduces.
pub(super) struct Introduce(pub Command);
impl EventEmitter<Introduce> for HeaderCoachmarks {}

impl HeaderCoachmarks {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        sidebar: Entity<RightSidebar>,
        dialogs: Entity<DialogLayer>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&preferences, |s, _, cx| s.sync(cx)).detach();
        cx.observe(&sidebar, |s, _, cx| s.sync(cx)).detach();
        let source_control = sidebar.read(cx).source_control.clone();
        cx.observe(&source_control, |s, _, cx| s.sync(cx)).detach();
        cx.observe(&dialogs, |_, _, cx| cx.notify()).detach();
        // An open introduction closes on Escape wherever focus is
        // (`dismissOnEscape`, a capturing document listener that lets the
        // key go on).
        let guide = cx.weak_entity();
        let own = window.window_handle();
        cx.intercept_keystrokes(move |event, window, cx| {
            if window.window_handle() != own || event.keystroke.key != "escape" {
                return;
            }
            let _ = guide.update(cx, |s, cx| s.dismiss_on_escape(cx));
        })
        .detach();
        Self {
            state: Coachmarks::default(),
            session: SessionView::default(),
            preferences,
            sidebar,
            dialogs,
            weak: cx.weak_entity(),
        }
    }
    /// What the window shows changed.
    pub fn set_session(&mut self, session: SessionView, cx: &mut Context<Self>) {
        if self.session != session {
            self.session = session;
            self.sync(cx);
        }
    }
    pub fn active(&self) -> Option<Coachmark> {
        self.state.active
    }
    /// Feeds the Header's state to the introductions.
    fn sync(&mut self, cx: &mut Context<Self>) {
        let prefs = self.preferences.read(cx).state.clone();
        let sidebar = self.sidebar.read(cx);
        let source_control = sidebar.source_control.read(cx);
        let status = super::header::GitTitlebarStatus::of(source_control);
        let repository = source_control.snapshot.is_some();
        let scope = self
            .session
            .root
            .as_ref()
            .map(|r| r.to_string_lossy().into_owned());
        let entry = scope
            .as_ref()
            .map(|s| format!("{s}#{}", self.session.entries));
        let home = self.session.home_requested;
        let inputs = Inputs {
            agent_open: sidebar.shows(Surface::Agent, cx),
            changes_open: sidebar.shows(Surface::Git, cx),
            local: repository.then_some(status.local),
            entry: entry.as_deref().filter(|_| !home),
            scope: scope.as_deref().filter(|_| !home),
            always: prefs.experimental.always_show_onboarding_coachmarks,
            progress: prefs.header_coachmarks,
        };
        let before = self.state.active;
        if let Some(progress) = self.state.observe(&inputs) {
            self.preferences
                .update(cx, |p, cx| p.change(|p| p.header_coachmarks = progress, cx));
        }
        if self.state.active != before {
            self.state.anchor = None;
            cx.notify();
        }
    }
    /// The Header entry, measured while its introduction shows
    /// (`.desktop-header-coachmark-anchor`).
    pub fn anchor(&self, id: Coachmark, button: AnyElement) -> AnyElement {
        if self.state.active != Some(id) {
            return button;
        }
        let weak = self.weak.clone();
        div()
            .relative()
            .flex()
            .flex_shrink_0()
            .items_center()
            .child(button)
            .child(
                canvas(
                    move |bounds, _, cx| {
                        let _ = weak.update(cx, |s, cx| {
                            if s.state.anchor != Some(bounds) {
                                s.state.anchor = Some(bounds);
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }
    fn acknowledge(&mut self, id: Coachmark, cx: &mut Context<Self>) {
        let prefs = self.preferences.read(cx).state.clone();
        let mut progress = prefs.header_coachmarks;
        if self.state.acknowledge(
            id,
            prefs.experimental.always_show_onboarding_coachmarks,
            &mut progress,
        ) {
            self.preferences
                .update(cx, |p, cx| p.change(|p| p.header_coachmarks = progress, cx));
        }
        cx.notify();
    }
    /// Whether an introduction is on screen (it waits for its entry's
    /// measurement, and hides on the Homepage and under dialogs).
    pub fn shown(&self, cx: &App) -> bool {
        self.state.active.is_some()
            && self.state.anchor.is_some()
            && !self.session.home
            && self.dialogs.read(cx).is_empty()
    }
    /// `dismissOnEscape`: Escape acknowledges the introduction on screen.
    fn dismiss_on_escape(&mut self, cx: &mut Context<Self>) {
        if self.shown(cx)
            && let Some(id) = self.state.active
        {
            self.acknowledge(id, cx);
        }
    }
}

impl Render for HeaderCoachmarks {
    /// `HeaderFeatureCoachmark`'s overlay: end-aligned below its entry.
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let shown = self
            .state
            .active
            .zip(self.state.anchor)
            .filter(|_| self.shown(cx));
        let Some((id, anchor)) = shown else {
            return div().into_any_element();
        };
        let w = f32::from(window.viewport_size().width);
        let dismiss = cx.listener(move |s, _, _, cx| s.acknowledge(id, cx));
        let primary = cx.listener(move |s, _, _, cx| {
            s.acknowledge(id, cx);
            let sidebar = s.sidebar.read(cx);
            match id {
                Coachmark::Agent if !sidebar.shows(Surface::Agent, cx) => {
                    cx.emit(Introduce(Command::ToggleRightSidebar))
                }
                Coachmark::Changes if !sidebar.shows(Surface::Git, cx) => {
                    cx.emit(Introduce(Command::Changes))
                }
                _ => {}
            }
        });
        let outside = cx.listener(move |s, _, _, cx| s.acknowledge(id, cx));
        overlay(id, anchor, w, cx.palette(), dismiss, primary, outside)
    }
}

/// The overlay of `id` below `anchor` in a window `w` wide: Later, the
/// primary action, and a press outside.
pub(crate) fn overlay(
    id: Coachmark,
    anchor: Bounds<Pixels>,
    w: f32,
    t: Theme,
    dismiss: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    primary: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    outside: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    let ty = theme::ty();
    let width = WIDTH.min(w - 2. * MARGIN);
    let right = f32::from(anchor.origin.x + anchor.size.width);
    let left = (right - width).clamp(MARGIN, (w - MARGIN - width).max(MARGIN));
    let top = f32::from(anchor.origin.y + anchor.size.height) + GAP;
    let key = id.key();
    let text = |k: &str| crate::localization::t(&format!("shell.coachmark.{key}.{k}"));
    let glyph: Icon = match id {
        Coachmark::Agent => Icon::new("agent-entry"),
        Coachmark::Changes => Icon::new("version-control"),
    };
    // `.desktop-titlebar-menu.desktop-header-coachmark` on the header
    // typography surface.
    let surface = v_flex()
        .id("header-coachmark")
        .w(px(width))
        .p(px(2. * metric::MENU_ITEM_PADDING_INLINE))
        .gap(px(metric::MENU_ITEM_GAP + metric::MENU_PADDING))
        .border_1()
        .border_color(t.border)
        .rounded(px(metric::MENU_RADIUS))
        .relative()
        .child(crate::ui::components::menu::padding_box_fill(
            metric::MENU_RADIUS,
            t.menu_bg,
        ))
        .shadow(MenuVariant::Default.shadow(t))
        .text_color(t.text)
        .on_mouse_down_out(outside)
        .child(
            h_flex()
                .items_start()
                .gap(px(metric::MENU_ITEM_GAP))
                .child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .size(px(theme::control()))
                        .items_center()
                        .justify_center()
                        .border_1()
                        .border_color(t.border)
                        .rounded(px(metric::CONTROL_RADIUS))
                        .bg(t.control)
                        .child(
                            glyph
                                .with_size(px(metric::MENU_ICON_SLOT))
                                .stroke(1.9)
                                .color(t.accent),
                        ),
                )
                .child(
                    v_flex()
                        .min_w_0()
                        .gap(px(metric::MENU_PADDING))
                        .child(
                            div()
                                .text_size(px(ty.header.content))
                                .line_height(px(ty.header.line_height))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(text("title")),
                        )
                        .child(
                            div()
                                .text_size(px(ty.header.meta))
                                .line_height(px(ty.header.meta_line_height))
                                .text_color(t.muted)
                                .child(text("body")),
                        ),
                ),
        )
        .child(
            h_flex()
                .justify_end()
                .gap(px(metric::MENU_ITEM_GAP))
                .child(
                    Button::new("coachmark-dismiss")
                        .variant(ButtonVariant::Pattern)
                        .label(text("dismiss"))
                        .on_click(dismiss),
                )
                .child(
                    Button::new("coachmark-primary")
                        .variant(ButtonVariant::PatternPrimary)
                        .label(text("primary"))
                        .on_click(primary),
                ),
        );
    deferred(
        anchored()
            .position(point(px(left), px(top)))
            .position_mode(AnchoredPositionMode::Window)
            .child(surface),
    )
    .with_priority(1)
    .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    fn inputs<'a>(entry: Option<&'a str>, local: Option<usize>, progress: Progress) -> Inputs<'a> {
        Inputs {
            agent_open: false,
            changes_open: false,
            local,
            entry,
            scope: Some("/p"),
            always: false,
            progress,
        }
    }
    #[test]
    fn the_agent_is_introduced_once_and_changes_wait_their_turn() {
        let mut c = Coachmarks::default();
        let none = Progress::default();
        assert_eq!(c.observe(&inputs(Some("/p#1"), Some(0), none)), None);
        assert_eq!(c.active, Some(Coachmark::Agent));
        // The first local change queues behind the Agent introduction.
        c.observe(&inputs(Some("/p#1"), Some(2), none));
        assert_eq!(c.active, Some(Coachmark::Agent));
        let mut progress = none;
        assert!(c.acknowledge(Coachmark::Agent, false, &mut progress));
        assert_eq!(c.active, Some(Coachmark::Changes));
        assert!(progress.agent && !progress.changes);
        // Opening Changes acknowledges it.
        let opened = Inputs {
            changes_open: true,
            ..inputs(Some("/p#1"), Some(2), progress)
        };
        let stored = c.observe(&opened).unwrap();
        assert!(stored.agent && stored.changes);
        assert_eq!(c.active, None);
        // Acknowledged introductions never return.
        c.observe(&inputs(Some("/p#2"), Some(0), stored));
        c.observe(&inputs(Some("/p#2"), Some(3), stored));
        assert_eq!(c.active, None);
    }
    #[test]
    fn an_open_agent_needs_no_introduction_and_the_experiment_repeats_them() {
        let mut c = Coachmarks::default();
        let none = Progress::default();
        let open = Inputs {
            agent_open: true,
            ..inputs(Some("/p#1"), None, none)
        };
        assert!(c.observe(&open).unwrap().agent);
        assert_eq!(c.active, None);
        let seen = Progress {
            agent: true,
            changes: true,
        };
        let always = |entry, local| Inputs {
            always: true,
            ..inputs(entry, local, seen)
        };
        c.observe(&always(Some("/p#2"), Some(1)));
        assert_eq!(c.active, Some(Coachmark::Agent));
        let mut progress = seen;
        assert!(!c.acknowledge(Coachmark::Agent, true, &mut progress));
        assert_eq!(c.active, Some(Coachmark::Changes));
    }
}
