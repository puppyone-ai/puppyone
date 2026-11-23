//! Composition-layer implementation of [`shared::preview::InlinePreview`]
//! (`composition/preview/`, `MA-05`, `MA-07`, `R13`).
//!
//! Bridges `shared::preview` to `features::html::render::Surface` so sibling
//! features (such as MDX `<Tabs>`) never import `features::html` directly.
use crate::editor::{
    markdown::{
        features::html::{
            render::{
                Surface, measured_height as html_measured_height,
                record_measured_height as html_record_measured_height,
            },
            structure::markdown_nodes,
        },
        shared::preview::InlinePreview,
        style::MarkdownTheme,
    },
    registry::DocumentAssets,
    view::render::RenderCx,
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
        block_id: usize,
        theme: &MarkdownTheme,
        assets: Option<&DocumentAssets>,
        render: &mut RenderCx,
    ) -> AnyElement {
        let nodes = markdown_nodes(source);
        let view = render.view.clone();
        Surface::new(theme, document, assets, view, block_id, render).render(&nodes, width)
    }

    fn measured_height(&self, key: u64) -> Option<f32> {
        html_measured_height(key)
    }

    fn record_measured_height(&self, key: u64, height: f32) -> bool {
        html_record_measured_height(key, height)
    }
}
