//! The product font catalog and its locale fallbacks; no window dependency.
//!
//! Ports `src/features/typography/fontCatalog.ts` (catalog, role resolution)
//! and
//! `src/styles/typography/locales.css` (script fallbacks per `lang`). The
//! GPUI projection — which of these families are installed, and the cascade
//! list built from the rest — lives in `ui::fonts`.
use serde::{Deserialize, Serialize};

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
