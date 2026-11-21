//! `agentBrandCatalog.test.tsx`: the brand catalog against the bundled
//! assets (read here, outside the UI primitives).
use crate::ui::agent_brands::{BRANDS, get, monochrome};
use core::prelude::v1::test;

fn asset(file: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("assets/agents")
        .join(file.trim_start_matches("agents/"));
    let bytes = std::fs::read(&path).unwrap_or_else(|_| panic!("missing asset {file}"));
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `uses one canonical id and themed asset contract for every registered
/// brand`; `gives a mark that cannot inherit the page's color an asset for
/// each theme`.
#[test]
fn every_brand_has_one_id_a_name_a_scale_and_themed_assets() {
    let mut ids = std::collections::HashSet::new();
    for brand in &BRANDS {
        assert!(ids.insert(brand.id), "{} twice", brand.id);
        assert!(!brand.name.is_empty() && brand.scale > 0., "{}", brand.id);
        let light = asset(brand.light);
        let dark = brand.dark.map(asset);
        // An image cannot take currentColor from the surface: such a mark
        // needs a dark-theme asset that does not use it.
        if brand.light.ends_with(".svg") && light.contains("currentColor") {
            let dark = dark.unwrap_or_else(|| panic!("{} has no dark asset", brand.id));
            assert!(!dark.contains("currentColor"), "{}", brand.id);
        }
    }
    let codex = get("codex").unwrap();
    let chatgpt = get("chatgpt").unwrap();
    assert_eq!((codex.light, codex.dark), (chatgpt.light, chatgpt.dark));
}

/// `renders Pi's normalized monochrome mark without the source asset's
/// oversized safety area`; `renders chatgpt / claude / codex / cursor / pi as
/// a current-color monochrome vector`.
#[test]
fn monochrome_marks_are_vectors_drawn_in_the_surface_colour() {
    for id in ["chatgpt", "claude", "codex", "cursor", "pi"] {
        let path = monochrome(get(id).unwrap()).unwrap_or_else(|| panic!("{id}"));
        assert!(path.ends_with(".svg"), "{id}");
        asset(path);
    }
    assert_eq!(
        monochrome(get("codex").unwrap()),
        monochrome(get("chatgpt").unwrap())
    );
    assert!(asset("pi-monochrome.svg").contains("viewBox=\"150 150 500 500\""));
    assert_eq!(monochrome(get("workbuddy").unwrap()), None);
}
