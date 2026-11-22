//! Composition-layer implementation of [`shared::preview::InlinePreview`]
//! (`composition/preview/`, `MA-05`, `MA-07`, `R13`).
//!
//! Bridges `shared::preview` to `features::html::render::Surface` and
//! `platform::sessions::measure` so sibling features (such as MDX `<Tabs>`)
//! never import `features::html` directly.
use crate::editor::{
    markdown::{
        features::html::{render::Surface, structure::markdown_nodes},
        platform::sessions::measure,
        shared::preview::InlinePreview,
        style::MarkdownTheme,
    },
    registry::DocumentAssets,
    view::{
        render::RenderCx,
        widget::{BlockId, WidgetStateStore},
    },
};
use gpui::AnyElement;
use std::path::Path;

pub struct PreviewRenderer;

pub static PREVIEW: PreviewRenderer = PreviewRenderer;

impl InlinePreview for PreviewRenderer {
    fn render_markdown(
        &self,
        source: &str,
        width: f32,
        document: &Path,
        block_id: BlockId,
        block_offset: usize,
        theme: &MarkdownTheme,
        assets: Option<&DocumentAssets>,
        render: &mut RenderCx,
    ) -> AnyElement {
        let nodes = markdown_nodes(source);
        let view = render.view.clone();
        Surface::new(
            theme,
            document,
            assets,
            view,
            block_id,
            block_offset,
            render,
        )
        .render(&nodes, width)
    }

    fn measured_height(
        &self,
        store: &mut WidgetStateStore,
        block_id: BlockId,
        key: u64,
    ) -> Option<f32> {
        measure::get(store, block_id, key)
    }

    fn record_measured_height(
        &self,
        store: &mut WidgetStateStore,
        block_id: BlockId,
        key: u64,
        height: f32,
    ) -> bool {
        measure::record(store, block_id, key, height)
    }
}
