//! File-icon theme registry. Formats own classification; each installed theme
//! must render every semantic kind. The renderer supplies size and semantic ink.
//! No GPUI, palette, extension switch or unknown-kind renderer fallback here.
use crate::formats;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use std::{collections::HashMap, sync::OnceLock};

#[derive(Deserialize)]
pub struct InkBinding {
    pub token: String,
    alpha: f64,
}
#[derive(Deserialize)]
struct Stroke {
    mode: String,
    value: f64,
}
impl Stroke {
    fn at(&self, size: f64, viewbox: f64) -> f64 {
        let denom = size.clamp(1., 18.);
        let round = |v: f64| (v * 1000.).round() / 1000.;
        match self.mode.as_str() {
            "constant" => self.value,
            "line" => round(self.value / denom),
            "multiplied" => round(viewbox / denom) * self.value,
            _ => panic!("Uncompiled file-icon stroke policy"),
        }
    }
}
#[derive(Deserialize)]
pub struct Glyph {
    svg: String,
    viewbox: f64,
    strokes: Vec<Stroke>,
    pub bindings: Vec<InkBinding>,
}
#[derive(Deserialize)]
pub struct ThemeDefinition {
    pub id: String,
    glyphs: HashMap<String, Glyph>,
}
impl ThemeDefinition {
    /// The ink tokens its glyphs bind (resolved against the active palette).
    pub fn ink_tokens(&self) -> impl Iterator<Item = &str> {
        self.glyphs
            .values()
            .flat_map(|glyph| &glyph.bindings)
            .map(|binding| binding.token.as_str())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema: u32,
    kinds: Vec<String>,
    order: Vec<String>,
    default_theme: String,
    retired: HashMap<String, String>,
    themes: HashMap<String, ThemeDefinition>,
}
fn catalog() -> &'static Catalog {
    static DATA: OnceLock<Catalog> = OnceLock::new();
    DATA.get_or_init(|| {
        let data: Catalog = serde_json::from_str(include_str!("../assets/file-icons.json"))
            .expect("generated file-icon registry");
        assert_eq!(data.schema, 2);
        assert_eq!(
            data.kinds,
            formats::SEMANTIC_KINDS,
            "file semantics must have one owner"
        );
        assert_eq!(data.order.len(), data.themes.len());
        for id in &data.order {
            let theme = &data.themes[id];
            assert_eq!(theme.id, *id);
            assert_eq!(theme.glyphs.len(), data.kinds.len());
            for kind in &data.kinds {
                assert!(
                    theme.glyphs.contains_key(kind),
                    "Missing known kind {id}/{kind}"
                );
            }
        }
        assert!(data.themes.contains_key(&data.default_theme));
        for id in data.retired.values() {
            assert!(data.themes.contains_key(id));
        }
        data
    })
}
pub fn themes() -> impl Iterator<Item = &'static str> {
    catalog().order.iter().map(String::as_str)
}
pub fn default_theme() -> &'static str {
    &catalog().default_theme
}
pub fn parse_theme(id: Option<&str>) -> Option<&'static str> {
    let id = id?;
    catalog()
        .themes
        .get(id)
        .map(|t| t.id.as_str())
        .or_else(|| catalog().retired.get(id).map(String::as_str))
}
pub fn theme(id: &str) -> &'static ThemeDefinition {
    &catalog().themes[parse_theme(Some(id)).unwrap_or(default_theme())]
}
/// Context supplied by a surface; themes never classify filenames themselves.
pub struct RenderContext<'a> {
    pub name: &'a str,
    pub node_type: Option<&'a str>,
    pub mime: Option<&'a str>,
    pub size: f32,
}
pub struct ResolvedIcon {
    theme: &'static ThemeDefinition,
    pub kind: String,
    size: f32,
    label: String,
}
pub fn resolve(theme_id: &str, context: RenderContext<'_>) -> ResolvedIcon {
    let kind = formats::semantic_kind(context.name, context.node_type, context.mime);
    let theme = theme(theme_id);
    assert!(
        theme.glyphs.contains_key(&kind),
        "Missing known icon kind {kind}"
    );
    let label = if theme.glyphs[&kind].svg.contains("QQQQ") {
        label(context.name)
    } else {
        String::new()
    };
    ResolvedIcon {
        theme,
        kind,
        size: context.size,
        label,
    }
}
impl ResolvedIcon {
    pub fn glyph(&self) -> &'static Glyph {
        &self.theme.glyphs[&self.kind]
    }
    /// Immutable cache identity includes physical resolution, logical size and
    /// resolved ink. Theme changes and differently coloured rows cannot reuse
    /// each other's bitmap. File paths themselves are not cache keys.
    pub fn asset_path(&self, physical: u32, colors: &[[u8; 4]]) -> String {
        assert_eq!(colors.len(), self.glyph().bindings.len());
        let colors = colors
            .iter()
            .map(|c| format!("{:08x}", u32::from_be_bytes(*c)))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "file-icons/{}/{}/{}/{}/{}/{}",
            self.theme.id,
            self.kind,
            self.size,
            physical,
            colors,
            URL_SAFE_NO_PAD.encode(&self.label)
        )
    }
}
/// Resolve an already classified, fully coloured request, without reading UI
/// globals from the asynchronous image loader.
pub fn glyph_svg(path: &str) -> Option<Vec<u8>> {
    let mut parts = path.strip_prefix("file-icons/")?.splitn(6, '/');
    let (theme, kind) = (parts.next()?, parts.next()?);
    let logical = parts.next()?.parse::<f64>().ok()?;
    let physical = parts.next()?.parse::<u32>().ok()?;
    if !logical.is_finite() || !(1. ..=512.).contains(&logical) || !(1..=4096).contains(&physical) {
        return None;
    }
    let colors = parts.next()?;
    let colors: Vec<_> = if colors.is_empty() {
        vec![]
    } else {
        colors
            .split(',')
            .map(|v| u32::from_str_radix(v, 16).map(u32::to_be_bytes))
            .collect::<Result<_, _>>()
            .ok()?
    };
    let label = String::from_utf8(URL_SAFE_NO_PAD.decode(parts.next()?).ok()?).ok()?;
    let glyph = catalog().themes.get(theme)?.glyphs.get(kind)?;
    if colors.len() != glyph.bindings.len() {
        return None;
    }
    let mut svg = glyph.svg.replace("{size}", &physical.to_string());
    for (i, stroke) in glyph.strokes.iter().enumerate() {
        svg = svg.replace(
            &format!("{{stroke{i}}}"),
            &stroke.at(logical, glyph.viewbox).to_string(),
        );
    }
    for (i, (binding, mut color)) in glyph.bindings.iter().zip(colors).enumerate() {
        color[3] = (f64::from(color[3]) * binding.alpha)
            .round()
            .clamp(0., 255.) as u8;
        svg = svg.replace(
            &format!("{{ink{i}}}"),
            &format!("#{:08x}", u32::from_be_bytes(color)),
        );
    }
    Some(
        svg.replace(
            "QQQQ",
            &label
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;"),
        )
        .into_bytes(),
    )
}
pub fn label(name: &str) -> String {
    formats::matched_extension(name)
        .map(|e| e.to_uppercase().chars().take(4).collect::<String>())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "FILE".into())
}
/// Explorer naming is separate from the glyph registry.
pub fn display_name(name: &str, folder: bool) -> (String, Option<String>) {
    if folder {
        return (name.into(), None);
    }
    match formats::matched_extension(name) {
        Some(ext) if name.len() > ext.len() + 1 => {
            let primary = &name[..name.len() - ext.len() - 1];
            if primary.is_empty() {
                (name.into(), None)
            } else {
                (primary.into(), Some(ext))
            }
        }
        _ => (name.into(), None),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_themes_and_saved_theme_migrations_have_distinct_contracts() {
        assert_eq!(themes().collect::<Vec<_>>(), ["default"]);
        assert!(std::ptr::eq(theme("unknown"), theme("default")));
        assert_eq!(theme("default").id, "default");
        assert_eq!(parse_theme(Some("default")), Some("default"));
        for retired in ["vscode", "lines", "semantic", "material", "minimal"] {
            assert!(!themes().any(|id| id == retired));
            assert_eq!(parse_theme(Some(retired)), Some("default"));
        }
        for invalid in [
            None,
            Some("toString"),
            Some("constructor"),
            Some("unknown-theme"),
            Some(""),
        ] {
            assert_eq!(parse_theme(invalid), None);
        }
    }

    #[test]
    fn markdown_and_text_share_the_document_glyph_and_inherit_label_ink() {
        let rendered = |name| {
            let icon = resolve(
                "default",
                RenderContext {
                    name,
                    node_type: Some("file"),
                    mime: None,
                    size: 18.,
                },
            );
            let key = icon.asset_path(18, &vec![[12, 96, 192, 255]; icon.glyph().bindings.len()]);
            (icon, String::from_utf8(glyph_svg(&key).unwrap()).unwrap())
        };
        let (markdown, svg) = rendered("notes.md");
        assert_eq!(svg, rendered("notes.txt").1);
        for name in ["notes.md", "notes.txt", "spec.pdf"] {
            assert!(
                rendered(name)
                    .1
                    .contains("data-file-icon-shape=\"document\"")
            );
        }
        assert_eq!(markdown.glyph().bindings.len(), 1);
        assert_eq!(markdown.glyph().bindings[0].token, "currentColor");
        assert!(svg.contains("stroke=\"#0c60c0ff\""));
        assert!(svg.contains("d=\"M5.85 9.25h5.2M5.85 11.75h3.65\""));
        assert!(!svg.contains("opacity"));
        assert!(
            markdown
                .glyph()
                .strokes
                .iter()
                .all(|s| s.at(18., markdown.glyph().viewbox) == 1.)
        );
    }

    #[test]
    fn rendered_glyphs_preserve_product_shapes_and_database_slot_geometry() {
        for theme in themes() {
            let rendered = |name, size| {
                let icon = resolve(
                    theme,
                    RenderContext {
                        name,
                        node_type: None,
                        mime: None,
                        size,
                    },
                );
                let path = icon.asset_path(
                    size as u32,
                    &vec![[12, 96, 192, 255]; icon.glyph().bindings.len()],
                );
                String::from_utf8(glyph_svg(&path).unwrap()).unwrap()
            };
            for name in [
                "data.db",
                "data.db3",
                "data.sqlite",
                "data.sqlite3",
                "data.duckdb",
                "data.ddb",
            ] {
                for size in [14., 18., 24.] {
                    let svg = rendered(name, size);
                    assert!(svg.contains("data-file-icon-shape=\"database-cylinder\""));
                    assert!(svg.contains("<ellipse"));
                    assert_eq!(svg.matches("<svg").count(), 1);
                    assert!(!svg.contains("0 0 44 54"));
                    assert!(!svg.contains("drop-shadow"));
                    assert!(svg.contains("viewBox=\"-3 -3 30 30\""));
                    assert!(svg.contains(&format!("width=\"{size}\"")));
                    assert!(svg.contains(&format!("height=\"{size}\"")));
                    let icon = resolve(
                        theme,
                        RenderContext {
                            name,
                            node_type: None,
                            mime: None,
                            size,
                        },
                    );
                    assert!(
                        icon.glyph()
                            .bindings
                            .iter()
                            .any(|b| b.token == "file-accent-code")
                    );
                }
            }
            for (name, attributes) in [
                (
                    "Knowledge.contextmap",
                    &[
                        "data-file-icon-product=\"context-map\"",
                        "data-file-icon-shape=\"treasure-map\"",
                        "data-file-icon-complexity=\"minimal\"",
                        "data-file-icon-route=\"treasure-trail\"",
                    ][..],
                ),
                ("movie.mp4", &["data-file-icon-shape=\"video-player\""][..]),
                (
                    "table.csv",
                    &[
                        "data-file-icon-shape=\"table-grid\"",
                        "data-file-icon-grid=\"2x2\"",
                    ][..],
                ),
                (
                    "proposal.docx",
                    &[
                        "data-file-icon-office=\"word\"",
                        "data-file-icon-shape=\"word-document\"",
                    ][..],
                ),
                (
                    "model.xlsx",
                    &[
                        "data-file-icon-office=\"excel\"",
                        "data-file-icon-shape=\"excel-spreadsheet\"",
                    ][..],
                ),
                (
                    "deck.pptx",
                    &[
                        "data-file-icon-office=\"presentation\"",
                        "data-file-icon-shape=\"presentation-slide\"",
                    ][..],
                ),
            ] {
                let svg = rendered(name, 18.);
                for attribute in attributes {
                    assert!(svg.contains(attribute), "{theme}/{name} lost {attribute}");
                }
            }
        }
    }

    #[test]
    fn malformed_image_requests_cannot_escape_the_installed_glyph_catalog() {
        let resolved = resolve(
            "default",
            RenderContext {
                name: "model.xlsx",
                node_type: None,
                mime: None,
                size: 18.,
            },
        );
        let valid = resolved.asset_path(
            36,
            &vec![[12, 96, 192, 255]; resolved.glyph().bindings.len()],
        );
        assert!(glyph_svg(&valid).is_some());
        for (part, invalid) in [
            (1, "../default"),
            (1, "missing"),
            (2, "missing"),
            (3, "NaN"),
            (3, "inf"),
            (3, "0"),
            (3, "513"),
            (4, "0"),
            (4, "4097"),
            (5, "zzzzzzzz"),
            (5, ""),
            (6, "%"),
        ] {
            let mut parts: Vec<_> = valid.split('/').collect();
            parts[part] = invalid;
            assert!(
                glyph_svg(&parts.join("/")).is_none(),
                "invalid {part}: {invalid}"
            );
        }
    }
    /// Every format the registry knows draws in every theme: a new kind
    /// (v0.4.4's `whiteboard`) arrives with its glyph or fails here, not at
    /// the first tree that lists such a file.
    #[test]
    fn every_known_format_has_a_glyph_in_every_theme() {
        for format in formats::all() {
            for theme in catalog().themes.values() {
                assert!(
                    theme.glyphs.contains_key(format.semantic_kind()),
                    "{} has no {} glyph",
                    theme.id,
                    format.semantic_kind()
                );
            }
        }
    }
    #[test]
    fn classification_and_display_follow_the_product_registry() {
        let oracle: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/ui/file-icons-oracle.json")).unwrap();
        for c in oracle["classification"].as_array().unwrap() {
            assert_eq!(
                formats::semantic_kind(
                    c["name"].as_str().unwrap(),
                    c["type"].as_str(),
                    c["mime"].as_str()
                ),
                c["kind"].as_str().unwrap(),
                "{c}"
            );
        }
        for c in oracle["cases"].as_array().unwrap() {
            let glyph = &theme(c["theme"].as_str().unwrap()).glyphs[c["kind"].as_str().unwrap()];
            let expected = c["strokes"].as_array().unwrap();
            assert_eq!(glyph.strokes.len(), expected.len());
            for (stroke, value) in glyph.strokes.iter().zip(expected) {
                assert!(
                    (stroke.at(c["size"].as_f64().unwrap(), glyph.viewbox)
                        - value.as_f64().unwrap())
                    .abs()
                        < 1e-9,
                    "{c}"
                );
            }
        }
        assert_eq!(
            display_name("README.md", false),
            ("README".into(), Some("md".into()))
        );
        assert_eq!(
            display_name(".gitignore", false),
            (".gitignore".into(), None)
        );
        assert_eq!(themes().collect::<Vec<_>>(), ["default"]);
        for id in ["vscode", "lines", "semantic", "material", "minimal"] {
            assert_eq!(parse_theme(Some(id)), Some("default"));
        }
        assert_eq!(parse_theme(Some("unknown")), None);
    }
    #[test]
    fn every_kind_has_late_bound_ink_and_valid_geometry_at_each_size() {
        for id in themes() {
            for kind in formats::SEMANTIC_KINDS {
                for size in [14., 15., 18., 24.] {
                    let resolved = resolve(
                        id,
                        RenderContext {
                            name: "x.qqqq",
                            node_type: Some(kind),
                            mime: None,
                            size,
                        },
                    );
                    let colors = vec![[123, 145, 167, 255]; resolved.glyph().bindings.len()];
                    let key = resolved.asset_path((size * 2.) as u32, &colors);
                    let svg = String::from_utf8(glyph_svg(&key).unwrap()).unwrap();
                    assert!(
                        !svg.contains("{ink")
                            && !svg.contains("{stroke")
                            && !svg.contains("var(")
                            && !svg.contains("<text ")
                    );
                    assert!(svg.contains(&format!("width=\"{}\"", size * 2.)));
                    let other = resolved
                        .asset_path((size * 2.) as u32, &vec![[12, 34, 56, 255]; colors.len()]);
                    assert_ne!(key, other, "ink must invalidate the image cache");
                }
            }
        }
    }
}
