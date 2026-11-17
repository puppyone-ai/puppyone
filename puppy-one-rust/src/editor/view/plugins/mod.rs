//! Generic view plugins (`TA-20`, `TA-60`): capabilities such as in-document
//! Find (`plugins::find::FindPlugin`) and format add-ons (such as Markdown's
//! `BlockDragAddon`) mount onto `EditorView` through [`ViewPlugin`] instead of
//! hardcoding format or search state into the view core.
pub mod conflicts;
pub mod find;
pub use conflicts::ConflictBannerPlugin;
pub use find::FindPlugin;

use super::{editor::EditorView, layout::DocLayout};
use crate::editor::text::state::{Applied, EditorState, Transaction};
use gpui::{AnyElement, App, Bounds, Context, Div, MouseMoveEvent, MouseUpEvent, Pixels, Window};
use std::any::Any;

/// Outcome of a plugin pointer move hook.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginPointerOutcome {
    /// Pass the event through to normal view pointer handling.
    Ignored,
    /// Consumed by the plugin (e.g. dragging a block handle).
    Consumed,
}

/// Narrow view handle passed to plugin pointer hooks so plugins can read layout
/// geometry and request edge auto-scrolling without mutating core editor state
/// arbitrarily.
pub struct PluginPointerCx<'a> {
    pub state: &'a EditorState,
    pub layout: Option<&'a DocLayout>,
    pub scroll_y: f32,
    pub max_scroll: f32,
    pub read_only: bool,
    pub scroll_delta: f32,
    pub notify: bool,
}

impl PluginPointerCx<'_> {
    pub fn scroll_by(&mut self, dy: f32) {
        self.scroll_delta += dy;
        if dy != 0. {
            self.notify = true;
        }
    }

    pub fn request_notify(&mut self) {
        self.notify = true;
    }
}

/// Outcome of a plugin mouse-up hook.
pub enum PluginDropOutcome {
    Consumed(Option<Transaction>),
}

/// View-level plugin facet (`TA-20`, `TA-60`).
pub trait ViewPlugin: Any {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;

    fn key_context(&self) -> Option<&'static str> {
        None
    }

    fn register_keymap(&self, _cx: &mut App) {}

    fn bind_actions(&self, root: Div, _cx: &mut Context<EditorView>) -> Div {
        root
    }

    fn on_applied(&mut self, _applied: &Applied, _state: &EditorState) {}

    fn on_selection_changed(
        &mut self,
        _state: &EditorState,
        _focused: bool,
        _pointer_selecting: bool,
    ) {
    }

    /// Invoked when keyboard focus leaves the editor; returns `true` when
    /// visual state changed and `cx.notify()` is needed.
    fn on_blur(&mut self, _state: &EditorState) -> bool {
        false
    }

    /// Invoked on `Cancel` (`Escape`) before editing intents; returns `true`
    /// when consumed by the plugin.
    fn on_escape(&mut self, _state: &EditorState) -> bool {
        false
    }

    fn on_mouse_move(
        &mut self,
        _event: &MouseMoveEvent,
        _ctx: &mut PluginPointerCx,
    ) -> PluginPointerOutcome {
        PluginPointerOutcome::Ignored
    }

    fn on_mouse_up(
        &mut self,
        _event: &MouseUpEvent,
        _ctx: &mut PluginPointerCx,
    ) -> Option<PluginDropOutcome> {
        None
    }

    /// Paint highlights underneath text leaves (e.g. find match highlights).
    fn paint_underlay(
        &self,
        _dark: bool,
        _layout: &DocLayout,
        _bounds: Bounds<Pixels>,
        _window: &mut Window,
    ) {
    }

    /// Stacked banner elements rendered above the document scrollport (e.g.
    /// Git conflict marker banner, `CE-21`).
    fn header(&self, _view: &EditorView, _cx: &mut Context<EditorView>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// Floating GPUI elements rendered above the document scrollport.
    fn overlay(&self, _view: &EditorView, _cx: &mut Context<EditorView>) -> Vec<AnyElement> {
        Vec::new()
    }
}
