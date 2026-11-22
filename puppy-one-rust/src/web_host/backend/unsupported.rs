//! Fallback backend for platforms without an embedded WebView (Linux native-first).
use crate::platform::webview::Content;

pub(super) const SUPPORTED: bool = false;

pub(super) struct BackendHost;

impl BackendHost {
    pub(super) fn build(
        _window: &impl raw_window_handle::HasWindowHandle,
        _content: Content,
        _dark: bool,
    ) -> Result<Self, String> {
        Err(crate::localization::t("native.web.embeddedUnavailable").to_owned())
    }

    pub(super) fn place(&self, _bounds: (f32, f32, f32, f32)) {}
    pub(super) fn place_clipped(
        &self,
        _bounds: (f32, f32, f32, f32),
        _visible: (f32, f32, f32, f32),
        _radius: f32,
    ) {
    }
    pub(super) fn showing_rect(&self, fallback: (f32, f32, f32, f32)) -> (f32, f32, f32, f32) {
        fallback
    }
    pub(super) fn set_visible(&self, _show: bool) {}
    pub(super) fn apply_cutouts(&self, holes: &[[f32; 5]], _size: (f32, f32)) -> bool {
        holes.is_empty()
    }
    pub(super) fn yield_focus_to_window(&self) {}
    pub(super) fn reload(&self) {}
    pub(super) fn evaluate(&self, _script: &str) {}
    pub(super) fn resize_hidden(&self, _width: f32, _height: f32) {}
    pub(super) fn has_native_capture(&self) -> bool {
        false
    }
    pub(super) fn snapshot(
        &self,
        _rect: (f32, f32, f32, f32),
        _width: f32,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        done(None);
    }
    pub(super) fn capture_png(
        &self,
        _crop: Option<(f32, f32, f32, f32)>,
        _viewport: Option<(f32, f32)>,
        done: Box<dyn FnOnce(Option<Vec<u8>>)>,
    ) {
        done(None);
    }
}
