//! The product font catalog and its locale fallbacks; no window dependency.
//!
//! Ports `src/features/typography/fontCatalog.ts` (catalog, role resolution,
//! stored preference parsing with every legacy version) and
//! `src/styles/typography/locales.css` (script fallbacks per `lang`). The
//! GPUI projection — which of these families are installed, and the cascade
//! list built from the rest — lives in `ui::fonts`.
use super::Scale;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `TYPOGRAPHY_PREFERENCE_VERSION`.
pub const PREFERENCE_VERSION: u64 = 11;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    Ui,
    Content,
    Code,
    Terminal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Category {
    Sans,
    Serif,
    Monospace,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Bundled,
    System,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// The trusted primary family list; locale and Emoji fallbacks are
    /// product-owned (`stack`).
    pub family: &'static [&'static str],
    pub category: Category,
    pub source: Source,
    pub roles: &'static [Role],
}
impl Entry {
    pub fn serves(&self, role: Role) -> bool {
        self.roles.contains(&role)
    }
}

/// `BUILTIN_FONT_IDS`.
pub mod ids {
    pub const GEIST_SANS: &str = "builtin:geist-sans";
    pub const GEIST_MONO: &str = "builtin:geist-mono";
    pub const SYSTEM_SANS: &str = "builtin:system-sans";
    pub const SYSTEM_SERIF: &str = "builtin:system-serif";
    pub const TERMINAL_SYSTEM_MONO: &str = "builtin:terminal-system-mono";
}

/// `BUILTIN_FONT_CATALOG`, in catalog order.
pub const CATALOG: [Entry; 5] = [
    Entry {
        id: ids::GEIST_SANS,
        label: "Geist",
        description: "PuppyOne's balanced default reading font.",
        family: &["Geist Sans"],
        category: Category::Sans,
        source: Source::Bundled,
        roles: &[Role::Ui, Role::Content],
    },
    Entry {
        id: ids::SYSTEM_SANS,
        label: "System",
        description: "Use the native sans-serif font from this device.",
        family: &[
            "ui-sans-serif",
            "system-ui",
            "-apple-system",
            "BlinkMacSystemFont",
            "Segoe UI",
        ],
        category: Category::Sans,
        source: Source::System,
        roles: &[Role::Ui, Role::Content],
    },
    Entry {
        id: ids::SYSTEM_SERIF,
        label: "Serif",
        description: "A quiet system serif stack for long-form reading.",
        family: &[
            "ui-serif",
            "New York",
            "Iowan Old Style",
            "Palatino Linotype",
            "Palatino",
            "Georgia",
        ],
        category: Category::Serif,
        source: Source::System,
        roles: &[Role::Content],
    },
    Entry {
        id: ids::GEIST_MONO,
        label: "Geist Mono",
        description: "PuppyOne's metric-stable code font.",
        family: &["Geist Mono"],
        category: Category::Monospace,
        source: Source::Bundled,
        roles: &[Role::Code],
    },
    Entry {
        id: ids::TERMINAL_SYSTEM_MONO,
        label: "Terminal Mono",
        description: "The metric-stable native terminal stack.",
        family: &[
            "SF Mono",
            "SFMono-Regular",
            "Menlo",
            "Monaco",
            "Consolas",
            "Liberation Mono",
        ],
        category: Category::Monospace,
        source: Source::System,
        roles: &[Role::Terminal],
    },
];

/// `PRODUCT_FONT_ID_BY_ROLE`.
fn product_font(role: Role) -> &'static str {
    match role {
        Role::Ui | Role::Content => ids::GEIST_SANS,
        Role::Code => ids::GEIST_MONO,
        Role::Terminal => ids::TERMINAL_SYSTEM_MONO,
    }
}

/// `ContentFontPreference`: the editor content follows the Sub Theme unless
/// the user picked a catalog font.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum ContentFont {
    #[default]
    FollowTheme,
    Explicit {
        #[serde(rename = "fontId")]
        font_id: String,
    },
}

/// The font half of `TypographyPreferences` (the scale is `text_scale`).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(default)]
pub struct Selection {
    pub content_font: ContentFont,
    pub code_font_id: String,
    pub terminal_font_id: String,
}
impl Selection {
    /// `normalizeFontId` on a stored selection: a syntactically invalid id
    /// is the role's default; a valid unknown id is kept (resolution falls
    /// back, so an imported font that returns is honoured again).
    pub fn normalized(&self) -> Self {
        let id = |value: &str, default: &str| {
            let value = value.trim();
            if valid_font_id(value) {
                value.to_owned()
            } else {
                default.to_owned()
            }
        };
        let defaults = Self::default();
        Self {
            content_font: match &self.content_font {
                ContentFont::Explicit { font_id } if valid_font_id(font_id.trim()) => {
                    ContentFont::Explicit {
                        font_id: font_id.trim().to_owned(),
                    }
                }
                _ => ContentFont::FollowTheme,
            },
            code_font_id: id(&self.code_font_id, &defaults.code_font_id),
            terminal_font_id: id(&self.terminal_font_id, &defaults.terminal_font_id),
        }
    }
}
impl Default for Selection {
    fn default() -> Self {
        Self {
            content_font: ContentFont::FollowTheme,
            code_font_id: ids::GEIST_MONO.into(),
            terminal_font_id: ids::TERMINAL_SYSTEM_MONO.into(),
        }
    }
}

/// Where the editor content font came from (`ResolvedContentFontDecision`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentSource {
    Theme,
    User,
    Fallback,
}

/// `ResolvedTypography` without the scale.
#[derive(Debug, PartialEq, Eq)]
pub struct Resolved {
    pub ui: &'static Entry,
    pub content: &'static Entry,
    pub editor_content_override: Option<&'static Entry>,
    pub editor_content_source: ContentSource,
    pub code: &'static Entry,
    pub terminal: &'static Entry,
}

/// `resolveTypography` against the built-in catalog.
pub fn resolve(selection: &Selection) -> Resolved {
    let (editor_content_override, editor_content_source) = match &selection.content_font {
        ContentFont::FollowTheme => (None, ContentSource::Theme),
        ContentFont::Explicit { font_id } => match find(font_id, Role::Content) {
            Some(entry) => (Some(entry), ContentSource::User),
            None => (
                Some(for_role(product_font(Role::Content), Role::Content)),
                ContentSource::Fallback,
            ),
        },
    };
    Resolved {
        ui: for_role(product_font(Role::Ui), Role::Ui),
        content: for_role(product_font(Role::Content), Role::Content),
        editor_content_override,
        editor_content_source,
        code: for_role(&selection.code_font_id, Role::Code),
        terminal: for_role(&selection.terminal_font_id, Role::Terminal),
    }
}

/// `getFontCatalogEntries`.
pub fn entries(role: Role) -> impl Iterator<Item = &'static Entry> {
    CATALOG.iter().filter(move |e| e.serves(role))
}

fn find(id: &str, role: Role) -> Option<&'static Entry> {
    CATALOG.iter().find(|e| e.id == id && e.serves(role))
}

/// `resolveFontForRole`: the request, else the product font, else the first
/// compatible entry.
fn for_role(requested: &str, role: Role) -> &'static Entry {
    find(requested, role)
        .or_else(|| find(product_font(role), role))
        .or_else(|| entries(role).next())
        .expect("the built-in catalog serves every role")
}

/// `FONT_ID_PATTERN`: `/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`.
pub fn valid_font_id(id: &str) -> bool {
    let Some((scheme, name)) = id.split_once(':') else {
        return false;
    };
    let mut s = scheme.chars();
    let mut n = name.chars();
    s.next().is_some_and(|c| c.is_ascii_lowercase())
        && scheme.len() <= 32
        && s.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && n.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.len() <= 128
        && n.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// `parseTypographyPreferences`: the stored `puppyone.desktop.typography`
/// value, with every legacy shape migrated. Anything unreadable is the
/// default.
pub fn parse_preferences(value: Option<&str>) -> (Selection, Scale) {
    let Some(parsed) = value
        .and_then(|v| serde_json::from_str::<Value>(v).ok())
        .filter(Value::is_object)
    else {
        return (Selection::default(), Scale::Medium);
    };
    let selection = Selection {
        content_font: parse_content_font(&parsed),
        code_font_id: normalize_font_id(parsed.get("codeFontId"), Role::Code),
        terminal_font_id: normalize_font_id(parsed.get("terminalFontId"), Role::Terminal),
    };
    (selection, parse_scale(&parsed))
}

fn version(parsed: &Value) -> Option<f64> {
    parsed.get("version").and_then(Value::as_f64)
}
fn version_in(parsed: &Value, versions: &[u64]) -> bool {
    version(parsed).is_some_and(|v| versions.iter().any(|&w| v == w as f64))
}

fn parse_content_font(parsed: &Value) -> ContentFont {
    if version_in(parsed, &[PREFERENCE_VERSION, 10, 9, 8, 7, 6, 5, 4]) {
        let Some(content) = parsed.get("contentFont").filter(|v| v.is_object()) else {
            return ContentFont::FollowTheme;
        };
        return match content.get("mode").and_then(Value::as_str) {
            Some("follow-theme") => ContentFont::FollowTheme,
            Some("explicit") => {
                let font_id = content
                    .get("fontId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim();
                if valid_font_id(font_id) {
                    ContentFont::Explicit {
                        font_id: font_id.into(),
                    }
                } else {
                    ContentFont::FollowTheme
                }
            }
            _ => ContentFont::FollowTheme,
        };
    }
    let legacy = parsed
        .get("contentFontId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if legacy.is_empty() || legacy == "theme" {
        return ContentFont::FollowTheme;
    }
    let font_id = normalize_font_id(Some(&Value::from(legacy)), Role::Content);
    let early = parsed.get("version").is_none() || version_in(parsed, &[1, 2]);
    if early && font_id == ids::GEIST_SANS {
        return ContentFont::FollowTheme;
    }
    ContentFont::Explicit { font_id }
}

/// `DEFAULT_FONT_ID_BY_ROLE`.
fn default_font(role: Role) -> &'static str {
    match role {
        Role::Ui | Role::Content => ids::GEIST_SANS,
        Role::Code => ids::GEIST_MONO,
        Role::Terminal => ids::TERMINAL_SYSTEM_MONO,
    }
}

/// `normalizeFontId`: a syntactically valid id is kept even when the catalog
/// does not know it (resolution falls back later, so an imported font that
/// returns is honoured again).
fn normalize_font_id(value: Option<&Value>, role: Role) -> String {
    match value.and_then(Value::as_str).map(str::trim) {
        Some(id) if valid_font_id(id) => id.into(),
        _ => default_font(role).into(),
    }
}

fn parse_scale(parsed: &Value) -> Scale {
    let normalize = |v: Option<&Value>| match v.and_then(Value::as_str) {
        Some("small") => Scale::Small,
        Some("large") => Scale::Large,
        _ => Scale::Medium,
    };
    if version_in(parsed, &[PREFERENCE_VERSION]) {
        return normalize(parsed.get("scale"));
    }
    // Versions 6–10 stored independent surface scales; the editor was the
    // primary reading-size choice, so it is the migration source.
    if version_in(parsed, &[10, 9, 8, 7, 6])
        && let Some(scales) = parsed.get("scales").filter(|v| v.is_object())
    {
        return normalize(scales.get("editor"));
    }
    let content = parsed
        .get("sizes")
        .filter(|v| v.is_object())
        .and_then(|sizes| sizes.get("content"))
        .filter(|v| v.is_object());
    let Some(size) = content
        .filter(|c| c.get("mode").and_then(Value::as_str) == Some("explicit"))
        .and_then(|c| c.get("sizePx"))
        .and_then(Value::as_f64)
    else {
        return Scale::Medium;
    };
    // `inferLegacyScale`: the nearest preset, the smaller one on a tie.
    [
        (14., Scale::Small),
        (15., Scale::Medium),
        (16., Scale::Large),
    ]
    .into_iter()
    .fold((f64::INFINITY, Scale::Medium), |best, (preset, scale)| {
        let distance = (preset - size).abs();
        if distance < best.0 {
            (distance, scale)
        } else {
            best
        }
    })
    .1
}

/// `--po-font-emoji`.
pub const EMOJI: [&str; 3] = ["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"];

/// CSS `:lang(range)`: the tag itself or any subtag extension of it.
fn lang_matches(locale: &str, range: &str) -> bool {
    let (locale, range) = (locale.to_ascii_lowercase(), range.to_ascii_lowercase());
    locale == range || locale.starts_with(&format!("{range}-"))
}

/// `--po-font-locale-{sans,serif,mono}` for the content language.
pub fn locale_stack(locale: &str, category: Category) -> &'static [&'static str] {
    type Faces = &'static [&'static str];
    let pick = |sans: Faces, serif: Faces, mono: Faces| match category {
        Category::Sans => sans,
        Category::Serif => serif,
        Category::Monospace => mono,
    };
    if lang_matches(locale, "zh-Hans") {
        return pick(
            &[
                "PingFang SC",
                "Hiragino Sans GB",
                "Microsoft YaHei",
                "Noto Sans CJK SC",
            ],
            &["Songti SC", "STSong", "Noto Serif CJK SC"],
            &["PingFang SC", "Microsoft YaHei", "Noto Sans Mono CJK SC"],
        );
    }
    if lang_matches(locale, "zh-Hant") {
        return pick(
            &["PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC"],
            &["Songti TC", "Noto Serif CJK TC"],
            &["PingFang TC", "Microsoft JhengHei", "Noto Sans Mono CJK TC"],
        );
    }
    if lang_matches(locale, "ja") {
        return pick(
            &["Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans CJK JP"],
            &["Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP"],
            &["Hiragino Sans", "Yu Gothic", "Noto Sans Mono CJK JP"],
        );
    }
    if lang_matches(locale, "ko") {
        return pick(
            &["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR"],
            &["AppleMyungjo", "Batang", "Noto Serif CJK KR"],
            &[
                "Apple SD Gothic Neo",
                "Malgun Gothic",
                "Noto Sans Mono CJK KR",
            ],
        );
    }
    pick(
        &[
            "ui-sans-serif",
            "system-ui",
            "-apple-system",
            "BlinkMacSystemFont",
            "Segoe UI",
        ],
        &[
            "ui-serif",
            "New York",
            "Iowan Old Style",
            "Palatino",
            "Georgia",
        ],
        &[
            "ui-monospace",
            "SFMono-Regular",
            "SF Mono",
            "Menlo",
            "Monaco",
            "Consolas",
            "Liberation Mono",
        ],
    )
}

/// `createCatalogFontFamily` / `--po-font-<role>`: the entry's family, then
/// the locale's script fallbacks, then Emoji. The CSS generic at the end is
/// the platform cascade, which GPUI appends itself.
pub fn stack(entry: &Entry, locale: &str) -> Vec<&'static str> {
    entry
        .family
        .iter()
        .chain(locale_stack(locale, entry.category))
        .chain(EMOJI.iter())
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_product_defaults_are_geist_for_code_and_the_system_stack_for_terminals() {
        let r = resolve(&Selection::default());
        assert_eq!(r.ui.id, ids::GEIST_SANS);
        assert_eq!(r.content.id, ids::GEIST_SANS);
        assert_eq!(r.code.family, ["Geist Mono"]);
        assert_eq!(
            r.terminal.family[..3],
            ["SF Mono", "SFMono-Regular", "Menlo"]
        );
        assert_eq!(r.editor_content_override, None);
        assert_eq!(r.editor_content_source, ContentSource::Theme);
        assert_eq!(entries(Role::Content).count(), 3);
        assert_eq!(entries(Role::Terminal).count(), 1);
    }

    #[test]
    fn unknown_or_wrong_role_fonts_fall_back_to_the_product_font_for_that_role() {
        let selection = Selection {
            content_font: ContentFont::Explicit {
                font_id: "imported:gone".into(),
            },
            // A content font cannot serve code.
            code_font_id: ids::SYSTEM_SERIF.into(),
            terminal_font_id: "imported:gone".into(),
        };
        let r = resolve(&selection);
        assert_eq!(r.code.id, ids::GEIST_MONO);
        assert_eq!(r.terminal.id, ids::TERMINAL_SYSTEM_MONO);
        assert_eq!(r.editor_content_override.unwrap().id, ids::GEIST_SANS);
        assert_eq!(r.editor_content_source, ContentSource::Fallback);
        let serif = resolve(&Selection {
            content_font: ContentFont::Explicit {
                font_id: ids::SYSTEM_SERIF.into(),
            },
            ..Selection::default()
        });
        assert_eq!(serif.editor_content_override.unwrap().id, ids::SYSTEM_SERIF);
        assert_eq!(serif.editor_content_source, ContentSource::User);
    }

    #[test]
    fn font_ids_follow_the_catalog_pattern() {
        for id in ["builtin:geist-sans", "imported:My_Font.v2", "a:b"] {
            assert!(valid_font_id(id), "{id}");
        }
        let long_scheme = format!("{}:x", "a".repeat(33));
        let long_name = format!("a:{}", "b".repeat(129));
        for id in [
            "",
            "builtin",
            "Builtin:x",
            "1a:x",
            "a:-x",
            "a:x y",
            "a:x;",
            long_scheme.as_str(),
            long_name.as_str(),
        ] {
            assert!(!valid_font_id(id), "{id}");
        }
    }

    #[test]
    fn stored_preferences_migrate_every_legacy_shape() {
        let parse = |v: &str| parse_preferences(Some(v));
        assert_eq!(
            parse_preferences(None),
            (Selection::default(), Scale::Medium)
        );
        assert_eq!(parse("not json"), (Selection::default(), Scale::Medium));
        assert_eq!(parse("[1]"), (Selection::default(), Scale::Medium));
        // Current shape.
        let (s, scale) = parse(
            r#"{"version":11,"contentFont":{"mode":"explicit","fontId":" builtin:system-serif "},
                "codeFontId":"imported:Fira","terminalFontId":"bad id","scale":"large"}"#,
        );
        assert_eq!(
            s.content_font,
            ContentFont::Explicit {
                font_id: ids::SYSTEM_SERIF.into()
            }
        );
        assert_eq!(s.code_font_id, "imported:Fira");
        assert_eq!(s.terminal_font_id, ids::TERMINAL_SYSTEM_MONO);
        assert_eq!(scale, Scale::Large);
        // An invalid explicit id follows the theme.
        let (s, _) = parse(r#"{"version":9,"contentFont":{"mode":"explicit","fontId":"x"}}"#);
        assert_eq!(s.content_font, ContentFont::FollowTheme);
        // Versions 6–10: the editor scale is the migration source.
        let (_, scale) =
            parse(r#"{"version":8,"scales":{"editor":"small","ui":"large"},"contentFont":{}}"#);
        assert_eq!(scale, Scale::Small);
        // Versions 1–3: `contentFontId`, Geist meant "the theme" before v3.
        let (s, _) = parse(r#"{"version":2,"contentFontId":"builtin:geist-sans"}"#);
        assert_eq!(s.content_font, ContentFont::FollowTheme);
        let (s, _) = parse(r#"{"version":3,"contentFontId":"builtin:geist-sans"}"#);
        assert_eq!(
            s.content_font,
            ContentFont::Explicit {
                font_id: ids::GEIST_SANS.into()
            }
        );
        let (s, _) = parse(r#"{"contentFontId":"theme"}"#);
        assert_eq!(s.content_font, ContentFont::FollowTheme);
        // Legacy explicit pixel sizes map to the nearest preset.
        for (px, expected) in [
            (12., Scale::Small),
            (14.5, Scale::Small),
            (15.4, Scale::Medium),
            (15.5, Scale::Medium),
            (19., Scale::Large),
        ] {
            let json = format!(
                r#"{{"version":3,"sizes":{{"content":{{"mode":"explicit","sizePx":{px}}}}}}}"#
            );
            assert_eq!(parse(&json).1, expected, "{px}");
        }
        let (_, scale) = parse(r#"{"version":3,"sizes":{"content":{"mode":"auto","sizePx":16}}}"#);
        assert_eq!(scale, Scale::Medium);
    }

    #[test]
    fn stored_selections_normalize_like_the_product() {
        let stored = Selection {
            content_font: ContentFont::Explicit {
                font_id: "not an id".into(),
            },
            code_font_id: " imported:Fira ".into(),
            terminal_font_id: "".into(),
        };
        assert_eq!(
            stored.normalized(),
            Selection {
                content_font: ContentFont::FollowTheme,
                code_font_id: "imported:Fira".into(),
                terminal_font_id: ids::TERMINAL_SYSTEM_MONO.into(),
            }
        );
    }

    #[test]
    fn the_selection_round_trips_in_the_product_shape() {
        let selection = Selection {
            content_font: ContentFont::Explicit {
                font_id: ids::SYSTEM_SANS.into(),
            },
            ..Selection::default()
        };
        let json = serde_json::to_value(&selection).unwrap();
        assert_eq!(
            json["content_font"],
            serde_json::json!({"mode": "explicit", "fontId": "builtin:system-sans"})
        );
        assert_eq!(
            serde_json::from_value::<Selection>(json).unwrap(),
            selection
        );
        assert_eq!(
            serde_json::from_str::<Selection>("{}").unwrap(),
            Selection::default()
        );
    }

    #[test]
    fn script_fallbacks_follow_the_content_language() {
        assert_eq!(locale_stack("zh-Hans", Category::Sans)[0], "PingFang SC");
        assert_eq!(
            locale_stack("zh-hans-CN", Category::Monospace)[0],
            "PingFang SC"
        );
        assert_eq!(locale_stack("zh-Hant", Category::Serif)[0], "Songti TC");
        assert_eq!(locale_stack("ja", Category::Sans)[0], "Hiragino Sans");
        assert_eq!(
            locale_stack("ja-JP", Category::Monospace)[0],
            "Hiragino Sans"
        );
        assert_eq!(locale_stack("ko", Category::Serif)[0], "AppleMyungjo");
        // `zh-CN` is not `:lang(zh-Hans)`; `jav` is not `ja`.
        assert_eq!(locale_stack("zh-CN", Category::Sans)[0], "ui-sans-serif");
        assert_eq!(locale_stack("jav", Category::Sans)[0], "ui-sans-serif");
        let code = stack(resolve(&Selection::default()).code, "ja");
        assert_eq!(
            code,
            [
                "Geist Mono",
                "Hiragino Sans",
                "Yu Gothic",
                "Noto Sans Mono CJK JP",
                "Apple Color Emoji",
                "Segoe UI Emoji",
                "Noto Color Emoji"
            ]
        );
    }
}
