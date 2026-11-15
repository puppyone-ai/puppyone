//! What an open viewer gives the document host (`DocumentSurfaceHost`): the
//! element it paints and the editing, find and pane-menu hooks the host
//! drives. The host never names a concrete viewer; a viewer implements only
//! the hooks its capability needs (read-only previews implement `element`).
use crate::{
    editor::{
        viewers::html_tools::{HtmlToolAction, HtmlToolEvent, HtmlToolMode, HtmlToolSnapshot},
        workbench::{
            find::FindEvent,
            pane::{Item, Segmented, Switch},
        },
    },
    formats::FileFormat,
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

/// What the host hands a viewer to open (`PresetViewerRenderContext`).
pub struct SurfaceRequest<'a> {
    /// The document session id.
    pub id: &'a str,
    /// Workspace-relative path.
    pub name: &'a str,
    pub input: SurfaceInput<'a>,
    pub format: &'static FileFormat,
    /// The concrete registered extension, for viewers that pick a parser.
    pub resolved_extension: Option<&'a str>,
    pub dark: bool,
    pub scale: Scale,
    /// The document's workspace (`workspaceRoot`, `contextMapEnvironment`);
    /// `None` for a lone file.
    pub workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
    /// Standalone file window (`FileModeApp`): viewers use `edit-and-source-panel`
    /// Header controls instead of the workbench segmented switch.
    pub file_mode: bool,
}

/// The viewer's input, as its manifest `source` asks.
#[derive(Clone, Copy, Debug)]
pub enum SurfaceInput<'a> {
    /// `content` / `content-and-resource`: the document text.
    Text(&'a str),
    /// `resource`: the file, read by the viewer itself.
    Resource(&'a crate::workspace::PreviewResource),
    /// `none`: nothing but the document's identity.
    None,
}

/// What a surface reports to its host.
#[derive(Clone, Debug, PartialEq)]
pub enum SurfaceEvent {
    /// The document text changed (the host derives the dirty state).
    Changed,
    /// The surface's own view state or pane contribution changed.
    Redraw,
    /// Match counts changed after editing while the pane find bar is open.
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
    /// An input-method composition is open (snapshots wait for it).
    fn composing(&self, _cx: &App) -> bool {
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
    fn set_history_owner(&self, _history: SurfaceHistory, _cx: &mut App) {}
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
    /// the top `top` points (a file window's title bar). The resting start
    /// padding grows by it, so nothing sits under the chrome until the
    /// content scrolls on beneath it.
    fn set_chrome_inset(&self, _top: f32, _cx: &mut App) {}
    /// How far the document's own scroller is from its top, and whether
    /// its top edge is a pinned header row, which never fades.
    fn scroll_state(&self, _cx: &App) -> (f32, bool) {
        (0., false)
    }
    /// A menu or shell command (`source`, `bold`, `italic`, `undo`, `redo`).
    fn command(&self, _name: &str, _window: &mut Window, _cx: &mut App) {}
    /// Where keyboard focus goes when the document is focused.
    fn focus_handle(&self, _cx: &App) -> Option<FocusHandle> {
        None
    }
    fn pane(&self, _cx: &App) -> PaneEntries {
        PaneEntries::default()
    }
    /// A segment of the pane menu's segmented control was chosen.
    fn pane_segment(&self, _id: &'static str, _window: &mut Window, _cx: &mut App) {}
    /// A pane menu item was chosen.
    fn pane_item(&self, _id: &'static str, _window: &mut Window, _cx: &mut App) {}
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
    /// Tests and captures reach the text editor behind a text surface.
    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn editor_view(&self) -> Option<gpui::Entity<crate::editor::view::EditorView>> {
        None
    }
    #[cfg(test)]
    fn code_editor(&self) -> Option<gpui::Entity<crate::editor::viewers::code::CodeView>> {
        None
    }
    /// Standalone HTML File Mode tool snapshot (`None` for non-HTML viewers).
    fn html_tool_state(&self) -> Option<HtmlToolSnapshot> {
        None
    }
    /// Switches the active in-page HTML tool overlay in standalone File Mode.
    fn set_html_tool(&self, _mode: HtmlToolMode, _window: &mut Window, _cx: &mut App) {}
    /// Runs an imperative HTML File Mode tool action (reload/reset, full-page capture, clear).
    fn trigger_html_action(&self, _action: HtmlToolAction, _window: &mut Window, _cx: &mut App) {}
    /// A message from the HTML Edit page, as its WebView would post it.
    #[cfg(test)]
    fn html_visual_deliver(&self, _body: &str) -> bool {
        false
    }
    /// A message from the HTML Interact page, and the notice it left.
    #[cfg(any(test, feature = "test-support"))]
    fn html_page_deliver(&self, _body: &str, _cx: &mut App) -> Option<SharedString> {
        None
    }
    #[cfg(feature = "test-support")]
    fn csv_editor(&self) -> Option<gpui::Entity<crate::editor::csv::CsvEditor>> {
        None
    }
}
