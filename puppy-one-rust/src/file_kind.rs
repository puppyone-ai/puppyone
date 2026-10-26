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
    fn every_theme_binding_uses_the_active_palette_and_inherited_ink() {
        for (pack, _) in crate::theme::pack_choices() {
            for dark in [false, true] {
                let palette = crate::theme::pack_theme(pack, dark);
                for id in themes() {
                    for glyph in theme(id).glyphs.values() {
                        for binding in &glyph.bindings {
                            let ink = palette.file_ink(&binding.token, palette.muted);
                            assert!(ink.r.is_finite() && ink.g.is_finite() && ink.b.is_finite());
                            if binding.token == "currentColor" {
                                assert_eq!(ink, palette.muted);
                            }
                        }
                    }
                }
            }
        }
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
