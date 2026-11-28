//! Port of `workbench/AgentChatHistoryBrowser`, `AgentConversationHistory`
//! and `useAgentConversationHistory` (`styles/launcher.css`): the launcher's
//! cross-runtime History over the project's `ConversationHistoryController`.
//! Discovery waits for the explicit permission; rows are locators only, and
//! opening one is the workbench's job (`HistoryBrowserEvent::Open`).
mod list;
mod model;
#[cfg(test)]
mod tests;
mod toolbar;

use super::agent_theme::AgentTheme;
use crate::agent::contract::dto::{SessionDiscovery, SessionMetadata};
use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryState;
use crate::features::desktop_agent::application::conversation_history_source::ConversationHistorySource;
use crate::features::desktop_agent::domain::agent_chat_history_target::{
    AuxiliaryWorkbenchHistoryTarget, create_agent_chat_history_target,
};
use crate::ui::agent_brand_mark::{AgentMark, monochrome_mark};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, tooltip};
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::form_input::TextInput,
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use model::*;
use std::rc::Rc;

/// `--desktop-chrome-height` in the right sidebar.
const TOOLBAR: f32 = 40.;
/// `.desktop-agent-history-toolbar-button` / search: `--po-control-size-compact`.
const BUTTON: f32 = 28.;
/// `.desktop-agent-history-option`: row height and its 1px block margins.
const ROW: f32 = 32.;

pub enum HistoryBrowserEvent {
    Back,
    /// "I understand": persist `chatHistoryDiscoveryEnabled`.
    Allow,
    /// `onOpen(createAgentChatHistoryTarget(session))`.
    Open(AuxiliaryWorkbenchHistoryTarget),
}

pub struct HistoryBrowser {
    source: Rc<dyn ConversationHistorySource>,
    /// Discovery has the user's permission (`historyDiscoveryEnabled`).
    enabled: bool,
    excluded: Vec<String>,
    search_open: bool,
    search: Entity<TextInput>,
    focus: FocusHandle,
    details_open: bool,
    /// `.desktop-agent-history-search:focus-within`, sampled each frame.
    search_focused: bool,
    /// The locator being opened (`openingTargetId`).
    pub opening: Option<String>,
    list_scroll: ScrollHandle,
    _subscription: Box<dyn FnOnce()>,
}

impl EventEmitter<HistoryBrowserEvent> for HistoryBrowser {}

impl HistoryBrowser {
    /// The browser over `source` (retained while hidden).
    pub fn new(
        source: Rc<dyn ConversationHistorySource>,
        enabled: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| {
            let mut input = TextInput::new(tr("agent.history.search"), false, 200, window, cx);
            input.appearance = false;
            input.prompt_text = Some((
                theme::ty().right.caption,
                theme::ty().right.meta_line_height,
            ));
            input.placeholder_color = Some(|t| AgentTheme::new(t).launcher_placeholder_text);
            input
        });
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        let (wake, changes) = crate::wake::Wake::channel();
        let unsubscribe = source.watch(wake);
        cx.spawn(async move |this, cx| {
            while changes.recv().await.is_ok() {
                while changes.try_recv().is_ok() {}
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }
        })
        .detach();
        let mut browser = Self {
            source,
            enabled: false,
            excluded: vec![],
            search_open: false,
            search,
            focus: cx.focus_handle(),
            details_open: false,
            search_focused: false,
            opening: None,
            list_scroll: ScrollHandle::new(),
            _subscription: unsubscribe,
        };
        if enabled {
            browser.enable(cx);
        }
        browser
    }
    pub fn enabled(&self) -> bool {
        self.enabled
    }
    /// Start discovery once permission exists (`useAgentConversationHistory active`).
    pub fn enable(&mut self, cx: &mut Context<Self>) {
        if self.enabled {
            return;
        }
        self.enabled = true;
        self.source.activate();
        cx.notify();
    }
    /// Sessions already open in a tab (`excludedResourceIds`).
    pub fn set_excluded(&mut self, ids: Vec<String>, cx: &mut Context<Self>) {
        if self.excluded != ids {
            self.excluded = ids;
            cx.notify();
        }
    }
    /// Dev captures: the first listed chat's target.
    #[cfg(feature = "dev-capture")]
    pub fn capture_first_target(&self) -> Option<AuxiliaryWorkbenchHistoryTarget> {
        self.history()
            .sessions
            .first()
            .map(create_agent_chat_history_target)
    }
    fn history(&self) -> History {
        History::new(self.source.snapshot(), &self.excluded)
    }
    fn back(&mut self, cx: &mut Context<Self>) {
        cx.emit(HistoryBrowserEvent::Back);
    }
    fn close_search(&mut self, cx: &mut Context<Self>) {
        self.search.update(cx, |s, cx| s.clear(cx));
        self.search_open = false;
        cx.notify();
    }
}

impl Render for HistoryBrowser {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        self.search_focused = self
            .search
            .read(cx)
            .focus_handle(cx)
            .contains_focused(window, cx);
        let content = if self.enabled {
            self.list(a, t, cx)
        } else {
            self.permission(a, t, cx)
        };
        div()
            .id("agent-history-browser")
            .track_focus(&self.focus)
            .size_full()
            .font_family(crate::theme::sans())
            .on_key_down(cx.listener(|s, e: &KeyDownEvent, window, cx| {
                if e.keystroke.key != "escape" {
                    return;
                }
                cx.stop_propagation();
                if s.search_open {
                    s.close_search(cx);
                    s.focus.focus(window, cx);
                } else {
                    s.back(cx);
                }
            }))
            .child(content)
    }
}

/// A Lucide glyph turning once every 900ms (`.is-spinning`).
fn spinning(
    id: &'static str,
    icon: &'static str,
    size: f32,
    stroke: f32,
    color: Rgba,
) -> AnyElement {
    Icon::new(icon)
        .with_size(px(size))
        .stroke(stroke)
        .color(color)
        .spinning(id)
        .into_any_element()
}

/// `formatHistoryDate`: `Intl.DateTimeFormat(undefined, { month: "short",
/// day: "numeric", hour: "numeric", minute: "2-digit" })` — the system's
/// region, in local time.
pub fn format_history_date(unix_ms: i64) -> String {
    crate::platform::locale_format::month_day_time(unix_ms)
}
