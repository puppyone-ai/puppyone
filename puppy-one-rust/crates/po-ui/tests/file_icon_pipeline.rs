use gpui_kit::{AssetSource, SvgRenderer, SvgSize, size};
use po_contracts::{file_kind, formats};
use std::sync::Arc;

/// Exercise the actual asset-source and GPUI SVG decoder, rather than accepting
/// a nonempty template string as evidence that a user can see the icon.
#[test]
fn every_semantic_icon_decodes_and_rasterizes_at_row_and_preview_sizes() {
    let assets = Arc::new(po_ui::assets::Assets);
    let renderer = SvgRenderer::new(assets.clone());
    for theme in file_kind::themes() {
        for kind in formats::SEMANTIC_KINDS {
            for logical in [14., 18., 24., 56.] {
                let physical = (logical * 2.) as u32;
                let icon = file_kind::resolve(
                    theme,
                    file_kind::RenderContext {
                        name: "unknown.unregistered",
                        node_type: Some(kind),
                        mime: None,
                        size: logical,
                    },
                );
                assert_eq!(icon.kind, *kind);
                let colors = vec![[12, 96, 192, 255]; icon.glyph().bindings.len()];
                let path = icon.asset_path(physical, &colors);
                let bytes = assets.load(&path).unwrap().unwrap();
                let parsed = renderer
                    .parse_svg(&bytes)
                    .unwrap_or_else(|e| panic!("{theme}/{kind}/{logical} cannot be decoded: {e}"));
                let expected = size(physical.into(), physical.into());
                let image = renderer
                    .render_parsed(&parsed, SvgSize::ExactSize(expected))
                    .unwrap();
                assert_eq!(image.frame_count(), 1);
                assert_eq!(image.size(0), expected);
                assert!(
                    image
                        .as_bytes(0)
                        .unwrap()
                        .chunks_exact(4)
                        .any(|p| p[3] != 0),
                    "{theme}/{kind}/{logical} is transparent"
                );
            }
        }
    }
}
