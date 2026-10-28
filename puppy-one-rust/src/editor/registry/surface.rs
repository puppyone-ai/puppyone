//! What an open viewer gives the document host (`DocumentSurfaceHost`): the
//! element it paints and the editing, find and pane-menu hooks the host
//! drives. The host never names a concrete viewer; a viewer implements only
//! the hooks its capability needs (read-only previews implement `element`).
use crate::{
    editor::workbench::{
        find::FindEvent,
        pane::{Item, Segmented},
    },
    formats::FileFormat,
    typography::Scale,
};
use gpui::{AnyElement, App, FocusHandle, Subscription, Window};
use std::rc::Rc;

/// What the host hands a viewer to open (`PresetViewerRenderContext`).
pub struct SurfaceRequest<'a> {
    /// The document session id.
    pub id: &'a str,
    /// Workspace-relative path.
    pub name: &'a str,
    pub input: SurfaceInput<'a>,
    pub format: &'static FileFormat,
    /// The concrete registered extension, for viewers that pick a parser.
    #[allow(dead_code)]
    pub resolved_extension: Option<&'a str>,
    pub dark: bool,
    pub scale: Scale,
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
    /// Open workspace paths the document referenced.
    OpenPaths(Vec<String>),
}
pub type SurfaceEvents = Rc<dyn Fn(SurfaceEvent, &mut App)>;

/// The pane menu entries a viewer contributes
/// (`EditorPaneMenuContribution`), and whether it has a find adapter.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PaneEntries {
    pub segmented: Option<Segmented>,
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
    fn replace_text(&self, _text: &str, _cx: &mut App) {}
    fn rebind_resource(&self, _resource: &crate::workspace::PreviewResource, _cx: &mut App) {}
    fn undo(&self, _redo: bool, _window: &mut Window, _cx: &mut App) {}
    /// Input is blocked (modal UI, a save barrier) and the app appearance.
    fn apply(&self, _read_only: bool, _dark: bool, _scale: Scale, _cx: &mut App) {}
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
    /// Tests reach the text editor behind a text surface.
    #[cfg(test)]
    fn editor_view(&self) -> Option<gpui::Entity<crate::editor::view::EditorView>> {
        None
    }
    #[cfg(test)]
    fn csv_editor(&self) -> Option<gpui::Entity<crate::editor::csv::CsvEditor>> {
        None
    }
}
