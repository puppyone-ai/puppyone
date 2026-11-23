//! Isolated Markdown / HTML fragment preview port (`shared/preview`, `MA-07`,
//! `MA-12`, `R6`, `R13`).
//!
//! Implemented in `composition::preview` so features such as MDX `<Tabs>` can
//! render nested Markdown panels without importing `features::html::render`
//! directly.
use crate::editor::{
    markdown::style::MarkdownTheme, registry::DocumentAssets, view::render::RenderCx,
};
use gpui::AnyElement;
use std::path::Path;

/// Renders an isolated Markdown fragment into a GPUI element and caches its
/// measured height.
pub trait InlinePreview: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    fn render_markdown(
        &self,
        source: &str,
        width: f32,
        document: &Path,
        block_id: usize,
        theme: &MarkdownTheme,
        assets: Option<&DocumentAssets>,
        render: &mut RenderCx,
    ) -> AnyElement;

    fn measured_height(&self, key: u64) -> Option<f32>;

    fn record_measured_height(&self, key: u64, height: f32) -> bool;
}
