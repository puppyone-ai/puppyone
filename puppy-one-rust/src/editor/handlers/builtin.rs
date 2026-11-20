//! Built-in preset viewer handler opening (`builtin:<id>`).

use crate::editor::registry::{self, Presentation, PresetViewer, SurfaceRequest, ViewerSurface};
use gpui::{App, Window};

/// Opens a built-in preset viewer by its canonical manifest id (`markdown`,
/// `text`, `image-preview`, `document-placeholder`, …).
pub fn open(
    viewer_id: &str,
    request: &SurfaceRequest,
    window: &mut Window,
    cx: &mut App,
) -> Result<(&'static PresetViewer, Box<dyn ViewerSurface>), String> {
    let viewer = registry::registry()
        .by_id(viewer_id)
        .ok_or_else(|| format!("unknown built-in viewer `{viewer_id}`"))?;
    let surface = match viewer.presentation {
        Presentation::Native(open_fn) => open_fn(request, window, cx),
    };
    Ok((viewer, surface))
}
