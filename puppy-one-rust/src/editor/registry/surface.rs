//! What an open viewer gives the document host (`DocumentSurfaceHost`): the
//! element it paints and the common editing, find, view-state and pane-menu
//! hooks the host drives (`RG-20`, `RG-21`, `WB-10`).
//!
//! Format-specific capabilities (standalone HTML File Mode tools, companion
//! source history delegation) live on optional capability traits queried via
//! `as_html_tools()` / `as_companion_history()`, and test probes live behind
//! [`SurfaceTestProbe`] (`RG-20`).

use super::actions::{HostCommand, PaneItemId, PaneSegmentId};
pub use super::request::SurfaceRequest;
use crate::{
    editor::{
        viewers::html_tools::{HtmlToolAction, HtmlToolEvent, HtmlToolMode, HtmlToolSnapshot},
        workbench::{
            find::FindEvent,
            pane::{Item, Segmented, Switch},
            view_state::SurfaceViewState,
        },
    },
    typography::Scale,
};
#[cfg(any(test, feature = "test-support"))]
use gpui::SharedString;
use gpui::{AnyElement, App, FocusHandle, Subscription, Window};
use std::rc::Rc;

/// A companion source view delegates undo/redo to its document's one history.
pub type SurfaceHistory = Rc<dyn Fn(bool, &mut App)>;

pub use crate::editor::viewers::html_tools::{
    HtmlJsError as SurfaceHtmlJsError, HtmlToolAction as SurfaceHtmlToolAction,
    HtmlToolEvent as SurfaceHtmlToolEvent, HtmlToolMode as SurfaceHtmlToolMode,
    HtmlToolSnapshot as SurfaceHtmlToolSnapshot,
};

/// What a surface reports to its host.
#[derive(Clone, Debug, PartialEq)]
pub enum SurfaceEvent {
    /// Reacquire the provider input before retrying a failed preview.
    RetryInput,
    /// The document text changed (the host derives the dirty state).
    Changed,
    /// The surface's own view state or pane contribution changed.
    Redraw,
    /// Match counts changed after editing or async WebView find while the pane find bar is open.
    FindResult { current: usize, total: usize },
    /// Open workspace paths the document referenced.
    OpenPaths(Vec<String>),
    /// Standalone HTML File Mode interactive tool event.
    HtmlTool(HtmlToolEvent),
}
pub type SurfaceEvents = Rc<dyn Fn(SurfaceEvent, &mut App)>;

/// The pane menu entries a viewer contributes
/// (`EditorPaneMenuContribution`), and whether it has a find adapter.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PaneEntries {
    pub segmented: Option<Segmented>,
    pub toggles: Vec<Switch>,
    pub items: Vec<Item>,
    pub find: bool,
}

/// Optional capability implemented by HTML File Mode surfaces (`RG-20`).
pub trait HtmlWindowTools {
    /// Standalone HTML File Mode tool snapshot (`None` when not in File Mode).
    fn html_tool_state(&self) -> Option<HtmlToolSnapshot>;
    /// Switches the active in-page HTML tool overlay in standalone File Mode.
    fn set_html_tool(&self, mode: HtmlToolMode, window: &mut Window, cx: &mut App);
    /// Runs an imperative HTML File Mode tool action (reload/reset, full-page capture, clear).
    fn trigger_html_action(&self, action: HtmlToolAction, window: &mut Window, cx: &mut App);
}

/// Optional capability implemented by companion source editors that delegate
/// undo/redo to their parent document surface (`RG-20`).
pub trait CompanionHistory {
    fn set_history_owner(&self, history: SurfaceHistory, cx: &mut App);
}

/// Inspection snapshot for oversized (`RG-02`) and faulted (`RG-23`) fallback cards in tests.
#[cfg(test)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpecialSurfaceProbe {
    pub kind: &'static str,
    pub size_bytes: Option<u64>,
    pub limit_bytes: Option<u64>,
    pub can_open_default_app: bool,
    pub can_reveal_in_finder: bool,
    pub can_switch_plain_text: bool,
    pub detail: String,
}

/// Test and dev-capture inspection probes kept outside the production
/// [`ViewerSurface`] contract (`RG-20`).
#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
pub trait SurfaceTestProbe {
    fn editor_view(&self) -> Option<gpui::Entity<crate::editor::view::EditorView>> {
        None
    }
    #[cfg(test)]
    fn code_editor(&self) -> Option<gpui::Entity<crate::editor::viewers::code::CodeView>> {
        None
    }
    #[cfg(test)]
    fn html_visual_deliver(&self, _body: &str) -> bool {
        false
    }
    #[cfg(any(test, feature = "test-support"))]
    fn html_page_deliver(&self, _body: &str, _cx: &mut App) -> Option<SharedString> {
        None
    }
    #[cfg(any(test, feature = "test-support"))]
    fn csv_editor(&self) -> Option<gpui::Entity<crate::editor::csv::CsvEditor>> {
        None
    }
    #[cfg(test)]
    fn special_surface(&self, _cx: &App) -> Option<SpecialSurfaceProbe> {
        None
    }
    /// A web page's message, as its engine would deliver it.
    #[cfg(any(test, feature = "test-support"))]
    fn page_deliver(&self, _body: &str, _cx: &mut App) -> bool {
        false
    }
    /// The generation the page's next messages must carry.
    #[cfg(any(test, feature = "test-support"))]
    fn page_generation(&self, _cx: &App) -> Option<u64> {
        None
    }
    /// The entry document a created or recreated page boots.
    #[cfg(test)]
    fn page_entry(&self, _cx: &App) -> Option<String> {
        None
    }
}

pub trait ViewerSurface {
    /// Workspace-scoped, hydrated reference metadata owned by the shell.
    fn set_reference_context(
        &self,
        _context: Option<crate::editor::navigation::ReferenceContext>,
        _cx: &mut App,
    ) {
    }
    /// The element the pane shows.
    fn element(&self) -> AnyElement;
    /// Report changes; `None` for surfaces that never change.
    fn subscribe(&self, _events: SurfaceEvents, _cx: &mut App) -> Option<Subscription> {
        None
    }
    /// The document text, for editable surfaces (snapshots, dirty state).
    fn text(&self, _cx: &App) -> Option<String> {
        None
    }
    /// `O(1)` rope [`crate::editor::text::buffer::Buffer`] snapshot for
    /// rope-backed surfaces (`CE-02`, `DP-44`); falls back to `self.text(cx)`.
    fn buffer(&self, cx: &App) -> Option<crate::editor::text::buffer::Buffer> {
        self.text(cx).map(crate::editor::text::buffer::Buffer::new)
    }
    /// An input-method composition is open (snapshots wait for it).
    fn composing(&self, _cx: &App) -> bool {
        false
    }
    /// The undo history lives only in the surface's page (a web engine model
    /// that cannot be detached): releasing the surface would lose it.
    fn holds_page_history(&self, _cx: &App) -> bool {
        false
    }
    /// The file changed on disk: show its new text in place.
    fn replace_text(&self, _text: &str, _window: &mut Window, _cx: &mut App) {}
    /// Applies local edits (UTF-16 ranges of the current text, ascending
    /// and disjoint) as one user change with history; `false` when the
    /// surface cannot take them (read-only, composing, not text).
    fn edit_utf16(
        &self,
        _edits: &[(std::ops::Range<usize>, String)],
        _window: &mut Window,
        _cx: &mut App,
    ) -> bool {
        false
    }
    /// Highlight and reveal a UTF-8 byte range in the source editor when
    /// another view (the HTML visual editor) selects an element.
    fn reveal_range(
        &self,
        _range: Option<std::ops::Range<usize>>,
        _window: &mut Window,
        _cx: &mut App,
    ) {
    }
    fn rebind_name(&self, _name: &str, _cx: &mut App) {}
    fn rebind_resource(&self, _resource: &crate::workspace::PreviewResource, _cx: &mut App) {}
    fn undo(&self, _redo: bool, _window: &mut Window, _cx: &mut App) {}
    /// Input is blocked (modal UI, a save barrier) and the app appearance.
    fn apply(
        &self,
        _read_only: bool,
        _dark: bool,
        _scale: Scale,
        _window: &mut Window,
        _cx: &mut App,
    ) {
    }
    /// `--po-editor-chrome-inset-block-start`: the host's chrome floats over
    /// the top `top` points (a file window's title bar).
    fn set_chrome_inset(&self, _top: f32, _cx: &mut App) {}
    /// How far the document's own scroller is from its top, and whether
    /// its top edge is a pinned header row, which never fades.
    fn scroll_state(&self, _cx: &App) -> (f32, bool) {
        (0., false)
    }
    /// Captures serializable cursor/scroll/mode/zoom/fold state (`WB-10`).
    fn view_state(&self, _cx: &App) -> Option<SurfaceViewState> {
        None
    }
    /// Restores cursor/scroll/mode/zoom/fold state, clamping to current bounds (`WB-10`, `WB-11`).
    fn restore_view_state(&self, _state: &SurfaceViewState, _window: &mut Window, _cx: &mut App) {}
    /// Dispatches a typed host command (`RG-21`).
    fn command(&self, _command: HostCommand, _window: &mut Window, _cx: &mut App) {}
    /// Where keyboard focus goes when the document is focused.
    fn focus_handle(&self, _cx: &App) -> Option<FocusHandle> {
        None
    }
    fn pane(&self, _cx: &App) -> PaneEntries {
        PaneEntries::default()
    }
    /// A segment of the pane menu's segmented control was chosen (`RG-21`).
    fn pane_segment(&self, _segment: PaneSegmentId, _window: &mut Window, _cx: &mut App) {}
    /// A pane menu item was chosen (`RG-21`).
    fn pane_item(&self, _item: PaneItemId, _window: &mut Window, _cx: &mut App) {}
    /// The find adapter: `(current, total)` after a query or move; `Close`
    /// clears the marks and returns focus to the document.
    fn find(
        &self,
        _event: FindEvent,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Option<(usize, usize)> {
        None
    }
    /// Optional standalone HTML File Mode tools capability (`RG-20`).
    fn as_html_tools(&self) -> Option<&dyn HtmlWindowTools> {
        None
    }
    /// Optional companion source history delegation capability (`RG-20`).
    fn as_companion_history(&self) -> Option<&dyn CompanionHistory> {
        None
    }
    /// Test / dev-capture inspection probe (`RG-20`).
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        None
    }
}
