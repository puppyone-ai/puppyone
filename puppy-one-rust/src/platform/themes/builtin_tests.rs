//! `builtinSubThemePackages.test.mjs`: the built-in Sub Themes the app
//! ships (`assets/themes/builtin`, copied byte for byte by
//! `tools/import-theme-contract.mjs`) keep to the public token contract.
use super::{css, palette};
use core::prelude::v1::test;
use std::collections::HashMap;

/// Every built-in package, by its directory name.
const PACKAGES: [(&str, &str); 6] = [
    (
        "default-github",
        include_str!("../../../assets/themes/builtin/default-github.css"),
    ),
    (
        "default-graphite",
        include_str!("../../../assets/themes/builtin/default-graphite.css"),
    ),
    (
        "default-neutral",
        include_str!("../../../assets/themes/builtin/default-neutral.css"),
    ),
    (
        "default-newspaper",
        include_str!("../../../assets/themes/builtin/default-newspaper.css"),
    ),
    (
        "default-warm",
        include_str!("../../../assets/themes/builtin/default-warm.css"),
    ),
    (
        "windows-xp-luna-blue",
        include_str!("../../../assets/themes/builtin/windows-xp-luna-blue.css"),
    ),
];

fn source(name: &str) -> &'static str {
    PACKAGES.iter().find(|(n, _)| *n == name).unwrap().1
}
/// A top-level at-rule's declarations, or a selector's inside it.
fn declarations(
    text: &str,
    at_rule: &str,
    params: &str,
    selector: Option<&str>,
) -> Vec<(String, String)> {
    let root = css::parse(text, "theme.css").unwrap();
    let nodes = root
        .iter()
        .find_map(|node| match node {
            css::Node::AtRule(rule) if rule.name == at_rule && rule.params.trim() == params => {
                rule.nodes.clone()
            }
            _ => None,
        })
        .unwrap_or_default();
    let nodes = match selector {
        None => nodes,
        Some(selector) => nodes
            .into_iter()
            .find_map(|node| match node {
                css::Node::Rule(rule) if rule.selector == selector => Some(rule.nodes),
                _ => None,
            })
            .unwrap_or_default(),
    };
    nodes
        .into_iter()
        .filter_map(|node| match node {
            css::Node::Decl(d) => Some((d.prop, d.value)),
            _ => None,
        })
        .collect()
}
fn metadata(text: &str) -> HashMap<String, String> {
    declarations(text, "puppyone-theme", "", None)
        .into_iter()
        .collect()
}
/// WCAG contrast of two `#rrggbb` colours.
fn contrast(a: &str, b: &str) -> f64 {
    let luminance = |hex: &str| {
        let channel = |at: usize| {
            let c = u8::from_str_radix(&hex[at..at + 2], 16).unwrap() as f64 / 255.;
            if c <= 0.04045 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
    };
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}
/// Every `#rrggbb` literal declared for a property starting with `prefix`,
/// in source order (light before dark).
fn hex_values(text: &str, prefix: &str) -> Vec<String> {
    text.match_indices(prefix)
        .filter_map(|(at, _)| {
            let rest = &text[at + prefix.len()..];
            let name = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
                .unwrap_or(rest.len());
            let value = rest[name..].strip_prefix(':')?.trim_start();
            let hex = value.get(..7)?;
            (hex.starts_with('#') && hex[1..].chars().all(|c| c.is_ascii_hexdigit()))
                .then(|| hex.to_ascii_lowercase())
        })
        .collect()
}
/// A theme's own Dark declarations.
fn dark(name: &str) -> HashMap<String, String> {
    palette::application_blocks(source(name))
        .1
        .into_iter()
        .collect()
}

#[test]
fn every_package_is_one_self_describing_theme_in_its_place() {
    let shipped = std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/themes/builtin"
    ));
    let mut files: Vec<String> = std::fs::read_dir(shipped)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    files.sort();
    let expected: Vec<String> = PACKAGES.iter().map(|(n, _)| format!("{n}.css")).collect();
    assert_eq!(files, expected);
    let mut order = Vec::new();
    for (name, text) in PACKAGES {
        // Public tokens only: no host projections or private editor selectors.
        assert!(text.contains("@puppyone-theme"), "{name}");
        for private in [
            "--po-host-",
            ".cm-",
            ".markdown-codemirror-editor",
            ".csv-table-editor",
        ] {
            assert!(!text.contains(private), "{name}: {private}");
        }
        let meta = metadata(text);
        let id = &meta["id"];
        assert_eq!(id.replace('.', "-"), name);
        order.push((meta["builtin-order"].parse::<u32>().unwrap(), id.clone()));
        // Only custom properties, never editor internals, in every target.
        for target in ["application", "markdown", "csv"] {
            let root = css::parse(text, "theme.css").unwrap();
            let block = root.iter().find_map(|node| match node {
                css::Node::AtRule(rule)
                    if rule.name == "puppyone" && rule.params.trim() == target =>
                {
                    rule.nodes.clone()
                }
                _ => None,
            });
            for node in block.into_iter().flatten() {
                if let css::Node::Rule(rule) = node {
                    assert!(
                        !rule.selector.contains(".cm-")
                            && !rule.selector.contains(".csv-table-editor"),
                        "{name} {target}: {}",
                        rule.selector
                    );
                    for decl in rule.nodes {
                        if let css::Node::Decl(d) = decl {
                            assert!(d.prop.starts_with("--"), "{name} {target}: {}", d.prop);
                        }
                    }
                }
            }
        }
        // Each Default theme paints its first frame in both modes.
        if meta["compatible-root-themes"] == "default" {
            let (light, dark) = palette::application_blocks(text);
            let mut both = light.clone();
            both.extend(dark);
            for (declared, is_dark) in [(light, false), (both, true)] {
                let canvas = &palette::project(&declared, is_dark)["canvas"];
                assert!(
                    canvas.len() == 7 && canvas.starts_with('#'),
                    "{name}: {canvas}"
                );
            }
        }
    }
    order.sort();
    let ids: Vec<&str> = order.iter().map(|(_, id)| id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "default.neutral",
            "default.warm",
            "default.graphite",
            "default.github",
            "default.newspaper",
            "windows-xp.luna-blue"
        ]
    );
}

#[test]
fn every_package_declares_every_markdown_role() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../assets/themes/markdown-contract.json"
    ))
    .unwrap();
    let mut tokens: Vec<&str> = contract["tokens"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    tokens.sort();
    for (name, text) in PACKAGES {
        let roles: HashMap<String, String> =
            declarations(text, "puppyone", "markdown", Some(":root"))
                .into_iter()
                .collect();
        let mut declared: Vec<&str> = roles.keys().map(String::as_str).collect();
        declared.sort();
        assert_eq!(declared, tokens, "{name}");
        assert_eq!(
            roles["--po-md-inline-code-background"], "transparent",
            "{name}"
        );
        assert_eq!(
            roles["--po-md-code-block-font-size-medium"], "var(--po-md-table-font-size-medium)",
            "{name}"
        );
        assert_eq!(
            roles["--po-md-code-block-color"], "var(--po-md-blockquote-color)",
            "{name}"
        );
    }
}

#[test]
fn neutral_dark_chrome_is_unified_and_apart_from_the_editor() {
    let tokens = dark("default-neutral");
    for (token, value) in [
        ("--po-surface-canvas", "#161616"),
        ("--po-surface-chrome", "#202020"),
        ("--po-surface-panel", "#1a1a1a"),
        ("--po-surface-panel-raised", "#222222"),
        ("--po-surface-overlay", "#2a2a2a"),
        ("--po-surface-inset", "#0d0d0d"),
        ("--po-surface-editor", "#161616"),
        ("--po-header", "var(--po-surface-chrome)"),
        ("--po-sidebar", "var(--po-surface-chrome)"),
        ("--po-text", "#fafafa"),
    ] {
        assert_eq!(tokens[token], value, "{token}");
    }
    assert_ne!(tokens["--po-surface-chrome"], tokens["--po-surface-editor"]);
}

#[test]
fn warm_light_shell_surfaces_do_not_leak_into_dark() {
    let tokens = dark("default-warm");
    let mix = "color-mix(in srgb, var(--po-surface-chrome) 40%, var(--po-surface-editor))";
    let normal = |v: &str| v.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(normal(&tokens["--po-header"]), mix);
    assert_eq!(normal(&tokens["--po-sidebar"]), mix);
}

#[test]
fn graphite_dark_text_and_syntax_stay_readable() {
    let tokens = dark("default-graphite");
    for (token, value) in [
        ("--po-text", "#fafafa"),
        ("--po-text-muted", "#a1a1aa"),
        ("--po-text-subtle", "#71717a"),
        ("--po-json-key", "#cbd5e1"),
        ("--po-json-string", "#7dd3fc"),
    ] {
        assert_eq!(tokens[token], value, "{token}");
    }
    let (light, dark) = palette::application_blocks(source("default-graphite"));
    let mut both = light;
    both.extend(dark);
    let projected = palette::project(&both, true);
    let canvas = &projected["canvas"];
    assert!(contrast(&projected["text"], canvas) >= 7.);
    assert!(contrast(&projected["text-muted"], canvas) >= 4.5);
}

/// `interfaceStyleSources`: Neutral is the attribute-free fallback whose
/// opaque canvas literals give the first paint, and Warm is a package of its
/// own rather than a preset inside the shared tokens.
#[test]
fn neutral_is_the_fallback_and_warm_a_package_of_its_own() {
    let light = |name: &str| -> HashMap<String, String> {
        palette::application_blocks(source(name))
            .0
            .into_iter()
            .collect()
    };
    let neutral = light("default-neutral");
    for (token, value) in [
        ("--po-surface-panel", "#fafafa"),
        ("--po-canvas", "#fafafa"),
        ("--po-header", "#ebebeb"),
        ("--po-sidebar", "#ebebeb"),
    ] {
        assert_eq!(neutral[token], value, "{token}");
    }
    assert_eq!(dark("default-neutral")["--po-surface-canvas"], "#161616");
    let warm = light("default-warm");
    for (token, value) in [
        ("--po-surface-panel", "#fbfaf7"),
        ("--po-header", "#f1eee8"),
        ("--po-sidebar", "#f1eee8"),
    ] {
        assert_eq!(warm[token], value, "{token}");
    }
    assert_eq!(metadata(source("default-warm"))["id"], "default.warm");
}

/// `themeSurfaceArchitecture`: the Markdown-focused built-ins carry a complete
/// syntax palette in both modes, Neutral's is achromatic, every syntax colour
/// keeps 4.5:1 over its code block, and no package brings its own fonts.
#[test]
fn markdown_syntax_palettes_are_complete_readable_and_bring_no_fonts() {
    let roles = [
        "keyword", "string", "comment", "constant", "special", "type", "function", "property",
        "operator", "meta",
    ];
    for name in ["default-github", "default-newspaper"] {
        let text = source(name);
        for role in roles {
            let declared = format!("--po-md-syntax-{role}:");
            assert_eq!(text.matches(declared.as_str()).count(), 2, "{name}: {role}");
        }
        assert!(!text.contains("@font-face"), "{name}");
    }
    let neutral = hex_values(source("default-neutral"), "--po-md-syntax-");
    assert_eq!(neutral.len(), 20);
    for color in &neutral {
        assert!(
            color[1..3] == color[3..5] && color[3..5] == color[5..7],
            "{color}"
        );
    }
    for name in ["default-neutral", "default-github", "default-newspaper"] {
        let text = source(name);
        let backgrounds = hex_values(text, "--po-md-code-block-background");
        let syntax = hex_values(text, "--po-md-syntax-");
        assert_eq!((backgrounds.len(), syntax.len()), (2, 20), "{name}");
        for (mode, background) in backgrounds.iter().enumerate() {
            for color in &syntax[mode * 10..mode * 10 + 10] {
                assert!(
                    contrast(background, color) >= 4.5,
                    "{name}: {color} on {background}"
                );
            }
        }
    }
}
