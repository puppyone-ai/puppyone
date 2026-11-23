//! SVG passive-rasterization & filesystem-isolation acceptance suite
//! (T1 / private security issue `puppy-issues#17`; replaces
//! `native-svg-raster-is-passive` for `markdownHtmlRun.test.ts` #76–#83 and
//! `markdownConvergence.test.ts` #4–#6).
//!
//! Every negative ("blocked") assertion pairs with a positive control proving
//! the same drawing visibly renders (including checking red pixels for red PNG
//! controls) when embedded via `data:` or local `<defs>` references, preventing
//! vacuous transparent-pass regressions.
use super::setup_with_focus;
use crate::{
    editor::{
        markdown::{
            SetAssets,
            features::mermaid,
            platform::assets::{AssetState, decode_svg_bitmap},
            shared::media::MediaSource,
        },
        registry::DocumentAssets,
        view::extension::config_transaction,
        viewers::image::decode_resource_for_tests,
    },
    platform::svg::rasterize_svg,
    render_service::{self, Rendered},
    typography::Scale,
    workspace::Workspace,
};
use base64::Engine as _;
use gpui::{RenderImage, TestAppContext};
use image::{Frame as ImageFrame, RgbaImage};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

fn solid_red_png_bytes() -> Vec<u8> {
    let mut buf = Vec::new();
    RgbaImage::from_pixel(8, 8, image::Rgba([255, 0, 0, 255]))
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

fn data_png_uri(png: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

fn opaque_pixel_count(bgra: &[u8]) -> usize {
    bgra.chunks_exact(4).filter(|px| px[3] > 0).count()
}

/// Counts opaque red pixels in straight-alpha BGRA order (`B<20, G<20, R>200, A>200`).
fn red_opaque_pixel_count(bgra: &[u8]) -> usize {
    bgra.chunks_exact(4)
        .filter(|px| px[0] < 20 && px[1] < 20 && px[2] > 200 && px[3] > 200)
        .count()
}

fn render_image_opaque_count(img: &RenderImage) -> usize {
    img.as_bytes(0).map(opaque_pixel_count).unwrap_or_default()
}

fn render_image_red_count(img: &RenderImage) -> usize {
    img.as_bytes(0)
        .map(red_opaque_pixel_count)
        .unwrap_or_default()
}

/// `puppy-issues#17` #1: `<image href="/abs/outside.png">` pointing to a real
/// red PNG outside the workspace renders transparent; positive control proves
/// the same PNG embedded via `data:image/png;base64,...` renders red.
#[test]
fn svg_blocks_absolute_local_image_href_while_allowing_embedded_data_png() {
    let outside = tempfile::tempdir().unwrap();
    let png_bytes = solid_red_png_bytes();
    let outside_png = outside.path().join("private.png");
    std::fs::write(&outside_png, &png_bytes).unwrap();

    // Positive control: embedded data: PNG renders opaque red pixels.
    let control_svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{}" width="8" height="8"/></svg>"#,
        data_png_uri(&png_bytes)
    );
    let (control_img, ..) =
        decode_svg_bitmap(control_svg.as_bytes()).expect("control data: SVG must rasterize");
    assert!(
        render_image_red_count(&control_img) > 0,
        "positive control data: PNG must render visible red pixels"
    );

    // Attack: absolute local path outside workspace MUST NOT be read (all pixels transparent).
    let attack_svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{}" width="8" height="8"/></svg>"#,
        outside_png.display()
    );
    let (attack_img, ..) =
        decode_svg_bitmap(attack_svg.as_bytes()).expect("SVG container still parses cleanly");
    assert_eq!(
        render_image_opaque_count(&attack_img),
        0,
        "SVG <image href=\"/abs/path\"> must never read local files from disk"
    );
}

/// `puppy-issues#17` #2: `<image href="relative.png">` (with a real `.png` in
/// the process current working directory) and `../` traversal must never be read.
#[test]
fn svg_blocks_relative_image_href_against_cwd_and_parent_traversal() {
    let png_bytes = solid_red_png_bytes();
    let cwd = std::env::current_dir().unwrap();
    let temp = tempfile::Builder::new()
        .suffix(".png")
        .tempfile_in(&cwd)
        .unwrap();
    std::fs::write(temp.path(), &png_bytes).unwrap();
    let rel_name = temp
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();

    // Positive control: inline data: PNG renders red pixels.
    let control = rasterize_svg(
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{}" width="8" height="8"/></svg>"#,
            data_png_uri(&png_bytes)
        )
        .as_bytes(),
        2.0,
    )
    .unwrap();
    assert!(red_opaque_pixel_count(&control.bgra) > 0);

    for href in [rel_name.as_str(), &format!("./{rel_name}"), "../Cargo.toml"] {
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{href}" width="8" height="8"/></svg>"#
        );
        let raster = rasterize_svg(svg.as_bytes(), 2.0).unwrap();
        assert_eq!(
            opaque_pixel_count(&raster.bgra),
            0,
            "SVG relative href {href:?} must never read from CWD or traverse parent"
        );
    }
}

/// `puppy-issues#17` #3: legacy `xlink:href` must enforce the same local-file
/// block as `href`, while `xlink:href="data:image/png;base64,..."` renders red.
#[test]
fn svg_blocks_xlink_href_local_image_while_allowing_xlink_data_png() {
    let outside = tempfile::tempdir().unwrap();
    let png_bytes = solid_red_png_bytes();
    let outside_png = outside.path().join("secret.png");
    std::fs::write(&outside_png, &png_bytes).unwrap();

    let control_svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="8" height="8"><image xlink:href="{}" width="8" height="8"/></svg>"#,
        data_png_uri(&png_bytes)
    );
    assert!(
        red_opaque_pixel_count(&rasterize_svg(control_svg.as_bytes(), 2.0).unwrap().bgra) > 0,
        "positive control xlink:href data: PNG must render red"
    );

    let attack_svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="8" height="8"><image xlink:href="{}" width="8" height="8"/></svg>"#,
        outside_png.display()
    );
    assert_eq!(
        opaque_pixel_count(&rasterize_svg(attack_svg.as_bytes(), 2.0).unwrap().bgra),
        0,
        "xlink:href must never read local files"
    );
}

/// `puppy-issues#17` #4: nested SVG referencing a local PNG (both via external
/// `.svg` file href AND via embedded `data:image/svg+xml`) must block reads at
/// both levels; control proves nested `data:image/svg+xml` with a passive shape renders.
#[test]
fn svg_blocks_nested_svg_file_and_nested_data_svg_local_image_reads() {
    let outside = tempfile::tempdir().unwrap();
    let png_bytes = solid_red_png_bytes();
    let outside_png = outside.path().join("deep_secret.png");
    std::fs::write(&outside_png, &png_bytes).unwrap();

    let inner_img_only = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{}" width="8" height="8"/></svg>"#,
        outside_png.display()
    );
    // External `.svg` on disk contains both a visible shape and a nested local PNG
    // so unrestricted `usvg::Options::default()` fails this test by reading `inner.svg`.
    let inner_file_svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff0000"/><image href="{}" width="8" height="8"/></svg>"##,
        outside_png.display()
    );
    let inner_file = outside.path().join("inner.svg");
    std::fs::write(&inner_file, &inner_file_svg).unwrap();

    // Positive control: nested `data:image/svg+xml` containing a passive rect renders visibly.
    let safe_inner = r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>"#;
    let safe_data_uri = format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(safe_inner.as_bytes())
    );
    let safe_outer = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{safe_data_uri}" width="8" height="8"/></svg>"#
    );
    assert!(
        opaque_pixel_count(&rasterize_svg(safe_outer.as_bytes(), 2.0).unwrap().bgra) > 0,
        "positive control nested data:image/svg+xml with passive rect must render"
    );

    // Level-1 block: outer SVG referencing external inner.svg file.
    let outer_file_ref = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{}" width="8" height="8"/></svg>"#,
        inner_file.display()
    );
    assert_eq!(
        opaque_pixel_count(&rasterize_svg(outer_file_ref.as_bytes(), 2.0).unwrap().bgra),
        0,
        "outer SVG must not read nested local .svg file"
    );

    // Level-2 block: outer SVG embeds inner SVG via data:image/svg+xml, which tries to read outside_png.
    let attack_data_uri = format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(inner_img_only.as_bytes())
    );
    let outer_data_ref = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="{attack_data_uri}" width="8" height="8"/></svg>"#
    );
    assert_eq!(
        opaque_pixel_count(&rasterize_svg(outer_data_ref.as_bytes(), 2.0).unwrap().bgra),
        0,
        "nested data:image/svg+xml must inherit restricted resolver and block local image reads"
    );
}

/// `puppy-issues#17` #5: `<feImage href="...">` and CSS `url(...)` external
/// references must never read local files; control proves `<feImage>` with
/// `data:` PNG produces red filtered output.
#[test]
fn svg_blocks_fe_image_and_css_url_external_references() {
    let outside = tempfile::tempdir().unwrap();
    let png_bytes = solid_red_png_bytes();
    let outside_png = outside.path().join("filter_secret.png");
    std::fs::write(&outside_png, &png_bytes).unwrap();

    // Positive control: `<feImage>` with an embedded data: PNG produces red filtered output.
    let control_fe = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">
            <defs><filter id="f"><feImage href="{}" width="8" height="8"/></filter></defs>
            <rect width="8" height="8" filter="url(#f)"/>
        </svg>"#,
        data_png_uri(&png_bytes)
    );
    assert!(
        red_opaque_pixel_count(&rasterize_svg(control_fe.as_bytes(), 2.0).unwrap().bgra) > 0,
        "positive control <feImage> with data: PNG must render red pixels"
    );

    // Attack: `<feImage href="/outside.png">` must remain transparent.
    let attack_fe = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">
            <defs><filter id="f"><feImage href="{}" width="8" height="8"/></filter></defs>
            <rect width="8" height="8" filter="url(#f)"/>
        </svg>"#,
        outside_png.display()
    );
    assert_eq!(
        opaque_pixel_count(&rasterize_svg(attack_fe.as_bytes(), 2.0).unwrap().bgra),
        0,
        "<feImage href> must never read local files"
    );

    // Attack: CSS `url(...)` pointing to external file must NOT load `outside_png` (solid red);
    // SVG spec falls back to default black fill — byte-for-byte identical to omitting `style`.
    let plain_rect = r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>"#;
    let expected_rect = rasterize_svg(plain_rect.as_bytes(), 2.0).unwrap();
    let css_attack = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">
            <rect width="8" height="8" style="fill: url(file://{});"/>
        </svg>"#,
        outside_png.display()
    );
    let css_raster = rasterize_svg(css_attack.as_bytes(), 2.0).unwrap();
    assert_eq!(
        css_raster.bgra, expected_rect.bgra,
        "CSS url(file://...) paint reference must be ignored (identical to removing style)"
    );
    assert_eq!(
        red_opaque_pixel_count(&css_raster.bgra),
        0,
        "CSS url(file://...) must never leak red pixels from external PNG"
    );
}

/// `puppy-issues#17` #6 + `markdownHtmlRun.test.ts` #76 ("keeps a passive
/// drawing and scopes its local paint references"), #80 ("removes a linked use
/// from a drawing"), and `markdownConvergence.test.ts` #4 ("turns Mermaid anchor
/// navigation into brokered intents while preserving local paint references"):
/// external `<use href="other.svg#id">` is ignored, while local `<use href="#id">`
/// and `<defs><linearGradient id="g">` render visibly.
#[test]
fn svg_blocks_external_use_href_while_preserving_local_use_paint_references() {
    let outside = tempfile::tempdir().unwrap();
    let other_svg = outside.path().join("other.svg");
    std::fs::write(
        &other_svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg"><rect id="ext" width="10" height="10" fill="#ff0000"/></svg>"##,
    )
    .unwrap();

    // Positive control: local `<defs>` gradient + local `<use href="#shape">` render visibly.
    let local_svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">
        <defs>
            <linearGradient id="g"><stop offset="0" stop-color="#0088ff"/></linearGradient>
            <rect id="shape" width="10" height="10" fill="url(#g)"/>
        </defs>
        <use href="#shape" x="1" y="1"/>
    </svg>"##;
    let local_raster = rasterize_svg(local_svg.as_bytes(), 2.0).unwrap();
    assert!(
        opaque_pixel_count(&local_raster.bgra) > 0,
        "local <use href=\"#shape\"> and url(#g) gradient must render visibly"
    );

    // External `<use href="other.svg#ext">` and remote `<use href="https://example.com/a.svg#x">` must NOT load.
    for ext_href in [
        format!("{}#ext", other_svg.display()),
        "https://example.com/a.svg#x".into(),
    ] {
        let ext_use = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><use href="{ext_href}"/></svg>"#
        );
        let raster = rasterize_svg(ext_use.as_bytes(), 2.0).unwrap();
        assert_eq!(
            opaque_pixel_count(&raster.bgra),
            0,
            "external <use href={ext_href:?}> must be ignored"
        );
    }
}

/// `puppy-issues#17` #7 + `markdownHtmlRun.test.ts` #77 (`script`), #78
/// (`foreignObject`), #79 (`animate`), #81 (`onload`), #82
/// (`fill="url(https://...)"`), #83 (`style="fill:url(...)"` / `@import`):
/// passive rasterization matches the stripped clean drawing byte-for-byte with
/// zero external reads.
#[test]
fn svg_ignores_script_foreign_object_animation_event_handlers_remote_paint_and_style_import() {
    let baseline = r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5" fill="#22aa44"/>
    </svg>"##;
    let expected = rasterize_svg(baseline.as_bytes(), 2.0).unwrap();
    assert!(
        opaque_pixel_count(&expected.bgra) > 0,
        "positive control baseline circle must draw visible pixels"
    );

    let active_variants = [
        (
            "script",
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><script>alert(1)</script><circle cx="8" cy="8" r="5" fill="#22aa44"/></svg>"##,
        ),
        (
            "foreignObject",
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><foreignObject width="16" height="16"><div>x</div></foreignObject><circle cx="8" cy="8" r="5" fill="#22aa44"/></svg>"##,
        ),
        (
            "animate",
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><animate attributeName="href" to="javascript:alert(1)"/><circle cx="8" cy="8" r="5" fill="#22aa44"/></svg>"##,
        ),
        (
            "onload",
            r##"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#22aa44"/></svg>"##,
        ),
        (
            "style @import",
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><style>@import url("https://example.com/evil.css");</style><circle cx="8" cy="8" r="5" fill="#22aa44"/></svg>"##,
        ),
    ];

    for (label, source) in active_variants {
        let actual = rasterize_svg(source.as_bytes(), 2.0).unwrap();
        assert_eq!(
            actual.bgra, expected.bgra,
            "{label} must have zero visual or active side effects vs baseline"
        );
    }

    // Remote paint attribute and linked style url(https://...) render identically to removing them.
    let bare_circle = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5"/></svg>"#;
    let bare_raster = rasterize_svg(bare_circle.as_bytes(), 2.0).unwrap();
    let remote_attr = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" fill="url(https://example.com/a)"/></svg>"#;
    let remote_style = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" style="fill:url(https://example.com/a)"/></svg>"#;
    assert_eq!(
        rasterize_svg(remote_attr.as_bytes(), 2.0).unwrap().bgra,
        bare_raster.bgra,
        "remote paint attribute must render identically to removing fill"
    );
    assert_eq!(
        rasterize_svg(remote_style.as_bytes(), 2.0).unwrap().bgra,
        bare_raster.bgra,
        "remote style url() must render identically to removing style"
    );
}

/// `puppy-issues#17` #8: opening an `.svg` file in the Image Viewer
/// (`editor::viewers::image`) decodes through the restricted SVG rasterizer and
/// never reads external local PNGs, while embedded `data:` PNG renders red.
#[test]
fn image_viewer_svg_decode_blocks_local_file_reads_while_rendering_safe_svg() {
    let outside = tempfile::tempdir().unwrap();
    let png_bytes = solid_red_png_bytes();
    let outside_png = outside.path().join("outside_viewer.png");
    std::fs::write(&outside_png, &png_bytes).unwrap();

    let ws_dir = tempfile::tempdir().unwrap();
    let control_svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="{}" width="16" height="16"/></svg>"#,
        data_png_uri(&png_bytes)
    );
    let attack_svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="{}" width="16" height="16"/></svg>"#,
        outside_png.display()
    );
    std::fs::write(ws_dir.path().join("control.svg"), &control_svg).unwrap();
    std::fs::write(ws_dir.path().join("attack.svg"), &attack_svg).unwrap();

    let ws = Workspace::open(ws_dir.path()).unwrap();
    let control_res = ws.resource(Path::new("control.svg")).unwrap();
    let attack_res = ws.resource(Path::new("attack.svg")).unwrap();

    let control_decoded = decode_resource_for_tests(&control_res, "control.svg", 256).unwrap();
    assert_eq!(
        (
            control_decoded.natural_width,
            control_decoded.natural_height
        ),
        (16, 16)
    );
    assert!(
        red_opaque_pixel_count(&control_decoded.frames[0].bgra) > 0,
        "positive control data: SVG in Image Viewer must render red pixels"
    );

    let attack_decoded = decode_resource_for_tests(&attack_res, "attack.svg", 256).unwrap();
    assert_eq!(
        opaque_pixel_count(&attack_decoded.frames[0].bgra),
        0,
        "Image Viewer must never read local files referenced from an .svg"
    );
}

/// `puppy-issues#17` #9: rendering a Markdown document containing inline `<svg>`,
/// a workspace-referenced SVG (`![](safe.svg)`), a normal workspace PNG
/// (`![](ok.png)`), and a traversal link (`![](../leak.png)`) invokes
/// `DocumentAssets.read` ONLY for the policy-approved workspace paths
/// (`safe.svg` and `ok.png`): `ok.png` renders red (positive control), while
/// `safe.svg` renders transparent without pulling in the external PNG.
#[gpui::test]
fn markdown_document_svg_only_reads_policy_approved_workspace_assets_via_document_assets(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let outside = tempfile::tempdir().unwrap();
    let png_bytes = solid_red_png_bytes();
    let outside_png = outside.path().join("leak.png");
    std::fs::write(&outside_png, &png_bytes).unwrap();

    let ws_dir = tempfile::tempdir().unwrap();
    let ws_svg_bytes = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><image href="{}" width="12" height="12"/></svg>"#,
        outside_png.display()
    )
    .into_bytes();
    std::fs::write(ws_dir.path().join("safe.svg"), &ws_svg_bytes).unwrap();
    std::fs::write(ws_dir.path().join("ok.png"), &png_bytes).unwrap();

    let reads: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let reads_cb = reads.clone();
    let ws_root = ws_dir.path().to_path_buf();
    let assets = DocumentAssets {
        workspace: url::Url::from_directory_path(&ws_root).unwrap().to_string(),
        document: "note.md".into(),
        read: Arc::new(move |rel: &Path| {
            reads_cb.lock().unwrap().push(rel.to_path_buf());
            std::fs::read(ws_root.join(rel)).ok()
        }),
    };

    let markdown = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\"><image href=\"{}\" width=\"12\" height=\"12\"/></svg>\n\n![ws](safe.svg)\n\n![ok](ok.png)\n\n![escape](../leak.png)\n\nend",
        outside_png.display()
    );
    let (view, visual) = setup_with_focus(cx, &markdown, false);
    view.update_in(visual, |v, _, cx| {
        v.dispatch(config_transaction(SetAssets(Some(assets.clone()))), cx);
    });
    for _ in 0..8 {
        visual.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        visual.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(15));
    }

    // Confirm ONLY policy-approved workspace paths (`safe.svg` and `ok.png`) reached `DocumentAssets.read`.
    let recorded = reads.lock().unwrap().clone();
    assert!(
        recorded.iter().any(|p| p == Path::new("safe.svg")),
        "expected policy-approved workspace asset safe.svg to be read, got {recorded:?}"
    );
    assert!(
        recorded.iter().any(|p| p == Path::new("ok.png")),
        "expected positive-control workspace image ok.png to be read, got {recorded:?}"
    );
    assert!(
        recorded
            .iter()
            .all(|p| p == Path::new("safe.svg") || p == Path::new("ok.png")),
        "DocumentAssets.read must NEVER be called for traversal or SVG-internal paths: {recorded:?}"
    );

    // Positive control: `ok.png` settles Ready with opaque red pixels.
    let ok_state = visual.update(|_, cx| {
        crate::editor::markdown::platform::assets::get(
            &MediaSource::Workspace(PathBuf::from("ok.png")),
            Some(&assets),
            cx,
        )
    });
    match ok_state {
        AssetState::Ready { image, .. } => {
            assert!(
                render_image_red_count(&image) > 0,
                "positive control workspace ok.png must render visible red pixels"
            );
        }
        other => panic!(
            "expected workspace ok.png to settle Ready, got {}",
            match other {
                AssetState::Loading => "Loading",
                AssetState::Failed(_) => "Failed",
                AssetState::Ready { .. } => unreachable!(),
            }
        ),
    }

    // Security assertion: cached decoded bitmap of `safe.svg` did NOT pull in `outside_png`.
    let svg_state = visual.update(|_, cx| {
        crate::editor::markdown::platform::assets::get(
            &MediaSource::Workspace(PathBuf::from("safe.svg")),
            Some(&assets),
            cx,
        )
    });
    match svg_state {
        AssetState::Ready { image, .. } => {
            assert_eq!(
                render_image_opaque_count(&image),
                0,
                "workspace SVG must not render external local image referenced inside it"
            );
        }
        other => panic!(
            "expected workspace safe.svg to settle Ready, got {}",
            match other {
                AssetState::Loading => "Loading",
                AssetState::Failed(_) => "Failed",
                AssetState::Ready { .. } => unreachable!(),
            }
        ),
    }
}

/// `markdownConvergence.test.ts` #5 ("mounts dense Mermaid diagrams at a readable
/// intrinsic scale") and #6 ("keeps unmeasurable Mermaid fragments on the safe
/// fit-width fallback").
#[gpui::test]
fn mermaid_dense_diagrams_use_readable_intrinsic_scale_and_unmeasurable_uses_fit_fallback(
    cx: &mut TestAppContext,
) {
    let make_rendered = |w: f32, h: f32| {
        let rgba = RgbaImage::from_pixel(4, 4, image::Rgba([30, 40, 60, 255]));
        Rendered {
            image: Arc::new(RenderImage::new(vec![ImageFrame::new(rgba)])),
            width: w,
            height: h,
            baseline: 0.,
        }
    };

    // #5: Dense 1640x620 diagram mounts at readable 70% minimum intrinsic scale (never shrunk to unreadable ~40%).
    let dense_src = "graph LR; A-->B-->C-->D-->E";
    let dense_rendered = make_rendered(1640., 620.);
    for scale in [1.0, 0.75] {
        let req = mermaid::widget::request_for_tests(dense_src, true, Scale::Medium, scale);
        render_service::seed_ready_for_tests(&req, dense_rendered.clone());
    }
    let (_, visual_dense) = setup_with_focus(cx, &format!("```mermaid\n{dense_src}\n```"), false);
    visual_dense.run_until_parked();
    visual_dense.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    assert!(
        visual_dense.debug_bounds("md-mermaid-zoom:70%").is_some(),
        "dense 1640px Mermaid diagram must mount at readable 70% intrinsic scale"
    );

    // #6: Unmeasurable (0x0 intrinsic) diagram stays on safe 100% fit-width fallback without panicking or NaN.
    let unmeasurable_src = "graph TD; Unmeasurable-->Fallback";
    let unmeasurable_rendered = make_rendered(0., 0.);
    let req_zero = mermaid::widget::request_for_tests(unmeasurable_src, true, Scale::Medium, 1.0);
    render_service::seed_ready_for_tests(&req_zero, unmeasurable_rendered);
    let (_, visual_zero) =
        setup_with_focus(cx, &format!("```mermaid\n{unmeasurable_src}\n```"), false);
    visual_zero.run_until_parked();
    visual_zero.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    assert!(
        visual_zero.debug_bounds("md-mermaid-zoom:100%").is_some(),
        "unmeasurable Mermaid diagram must fall back cleanly to 100% fit-width scale"
    );
}
