//! Presentational HTML policy (`platform/policy/presentation.rs`, TS
//! `markdownHtmlSanitizerPolicy.ts` `isSafeStyleValue` and the attribute
//! rules of `sanitizeHtml.ts`): which `style` values and legacy presentation
//! attributes (`align`, `width`, `valign`, `type`, `media`) an HTML surface
//! keeps. A value outside the policy is omitted; the element stays.

/// The colour names a value may use.
const COLOR_NAMES: &[&str] = &[
    "currentcolor",
    "transparent",
    "black",
    "blue",
    "brown",
    "cyan",
    "gray",
    "green",
    "grey",
    "lime",
    "magenta",
    "maroon",
    "navy",
    "olive",
    "orange",
    "pink",
    "purple",
    "red",
    "teal",
    "white",
    "yellow",
];

/// Longest `<source media>` / `sizes` condition kept.
const SOURCE_CONDITION_MAX_LENGTH: usize = 256;

fn one_of(value: &str, options: &[&str]) -> bool {
    options.iter().any(|o| value.eq_ignore_ascii_case(o))
}

fn is_hex_color(value: &str) -> bool {
    value
        .strip_prefix('#')
        .is_some_and(|h| (3..=8).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// `rgb()`/`rgba()`/`hsl()`/`hsla()` with plain numeric arguments.
fn is_color_function(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let Some(open) = lower.find('(') else {
        return false;
    };
    if !matches!(&lower[..open], "rgb" | "rgba" | "hsl" | "hsla") || !lower.ends_with(')') {
        return false;
    }
    let args: Vec<&str> = lower[open + 1..lower.len() - 1]
        .split(',')
        .map(str::trim)
        .collect();
    (3..=4).contains(&args.len())
        && args.iter().all(|a| {
            let a = a
                .trim_end_matches('%')
                .trim_end_matches("deg")
                .trim_end_matches("rad")
                .trim_end_matches("turn");
            !a.is_empty() && a.parse::<f32>().is_ok_and(|v| v.is_finite() && v >= 0.)
        })
}

/// `var(--name)` or `var(--name, <hex or named colour>)`.
fn is_css_variable(value: &str) -> bool {
    let Some(inner) = value.strip_prefix("var(").and_then(|v| v.strip_suffix(')')) else {
        return false;
    };
    let (name, fallback) = match inner.split_once(',') {
        Some((n, f)) => (n.trim(), Some(f.trim())),
        None => (inner.trim(), None),
    };
    let valid_name = name.strip_prefix("--").is_some_and(|n| {
        !n.is_empty()
            && n.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    });
    valid_name
        && fallback.is_none_or(|f| !f.is_empty() && (is_hex_color(f) || one_of(f, COLOR_NAMES)))
}

/// `isSafeColorValue`.
pub fn is_safe_color_value(value: &str, allow_variable: bool) -> bool {
    is_hex_color(value)
        || is_color_function(value)
        || (allow_variable && is_css_variable(value))
        || one_of(value, COLOR_NAMES)
}

/// The colour a safe `var(--x, colour)` falls back to (the host's variables
/// are not the document's), or the value itself.
pub fn color_fallback(value: &str) -> Option<&str> {
    match value.trim().strip_prefix("var(") {
        Some(inner) => inner
            .strip_suffix(')')?
            .split_once(',')
            .map(|(_, f)| f.trim()),
        None => Some(value.trim()),
    }
}

/// A length within the policy's bounds: `0`, `auto`, or a non-negative
/// amount of `px` (≤ 1024), `%`, `vh`, `vw` (≤ 100) or `em`, `rem`, `ch`,
/// `lh` (≤ 64).
fn is_safe_length(value: &str) -> bool {
    if value == "0" || value.eq_ignore_ascii_case("auto") {
        return true;
    }
    let lower = value.to_ascii_lowercase();
    let unit_at = lower
        .find(|c: char| c.is_ascii_alphabetic() || c == '%')
        .unwrap_or(lower.len());
    let (amount, unit) = lower.split_at(unit_at);
    let Ok(amount) = amount.parse::<f32>() else {
        return false;
    };
    let max = match unit {
        "px" => 1024.,
        "%" | "vh" | "vw" => 100.,
        "em" | "rem" | "ch" | "lh" => 64.,
        _ => return false,
    };
    amount.is_finite() && amount >= 0. && amount <= max
}

/// `isSafeStyleValue`: whether an HTML surface keeps `property: value`.
pub fn is_safe_style_value(property: &str, value: &str) -> bool {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    if value.is_empty()
        || value.contains([';', '<', '>', '{', '}'])
        || lower.replace(' ', "").contains("url(")
        || lower.replace(' ', "").contains("expression(")
        || lower.contains("@import")
    {
        return false;
    }
    let parts = || value.split_whitespace();
    match property {
        "color" => is_safe_color_value(value, true),
        p if p.ends_with("-color") => is_safe_color_value(value, true),
        "background" => is_safe_color_value(value, false),
        "font-weight" => {
            one_of(value, &["normal", "bold", "bolder", "lighter"])
                || (value.len() == 3
                    && value.ends_with("00")
                    && (b'1'..=b'9').contains(&value.as_bytes()[0]))
        }
        "font-style" => one_of(value, &["normal", "italic", "oblique"]),
        "text-decoration" | "text-decoration-line" => one_of(
            value,
            &[
                "none",
                "underline",
                "line-through",
                "underline line-through",
                "line-through underline",
            ],
        ),
        "display" => one_of(
            value,
            &[
                "block",
                "flex",
                "grid",
                "inline",
                "inline-block",
                "inline-flex",
                "inline-grid",
            ],
        ),
        "flex-wrap" => one_of(value, &["nowrap", "wrap", "wrap-reverse"]),
        "overflow" => one_of(value, &["auto", "hidden", "scroll", "clip"]),
        "cursor" => one_of(value, &["default", "pointer", "text"]),
        "text-align" => one_of(value, &["left", "center", "right", "start", "end"]),
        "vertical-align" => one_of(
            value,
            &[
                "baseline",
                "sub",
                "super",
                "top",
                "middle",
                "bottom",
                "text-top",
                "text-bottom",
            ],
        ),
        "letter-spacing" => is_safe_length(value) || value.eq_ignore_ascii_case("normal"),
        "border-style" => parts().all(|p| one_of(p, &["none", "solid", "dashed", "dotted"])),
        "border-width" | "border-radius" => parts().all(is_safe_length),
        "border" | "border-top" | "border-right" | "border-bottom" | "border-left" => {
            parts().all(|p| {
                is_safe_length(p)
                    || is_safe_color_value(p, false)
                    || one_of(p, &["none", "solid", "dashed", "dotted"])
            })
        }
        "font-size" | "line-height" => {
            is_safe_length(value)
                || one_of(
                    value,
                    &[
                        "normal", "small", "medium", "large", "x-large", "xx-large", "smaller",
                        "larger",
                    ],
                )
        }
        "gap" | "height" | "margin" | "max-width" | "min-width" | "padding" | "width" => {
            parts().all(is_safe_length)
        }
        p if p.starts_with("border-") && p.ends_with("-style") => {
            parts().all(|p| one_of(p, &["none", "solid", "dashed", "dotted"]))
        }
        p if p.starts_with("border-") && p.ends_with("-width") => parts().all(is_safe_length),
        p if p.starts_with("margin-") || p.starts_with("padding-") => parts().all(is_safe_length),
        _ => false,
    }
}

/// `HTML_DIMENSION_PATTERN`: `1`–`9999`, optionally `px` or `%`.
fn is_dimension(value: &str) -> bool {
    let digits = value
        .strip_suffix('%')
        .or_else(|| value.strip_suffix("px"))
        .unwrap_or(value);
    (1..=4).contains(&digits.len())
        && digits.bytes().all(|b| b.is_ascii_digit())
        && !digits.starts_with('0')
}

/// A `<source media>` or `sizes` condition: it selects among candidates and
/// never loads anything.
fn is_source_condition(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    !value.is_empty()
        && value.len() <= SOURCE_CONDITION_MAX_LENGTH
        && !value.contains(['<', '>', '{', '}', ';'])
        && !lower.replace(' ', "").contains("url(")
}

/// The value an HTML surface keeps for `tag`'s presentation attribute
/// `name` (lowercased where the attribute is a keyword), `None` when the
/// policy omits it. Attributes this policy does not govern keep their value.
pub fn presentation_attribute(tag: &str, name: &str, value: &str) -> Option<String> {
    let value = value.trim();
    let keep = |ok: bool, lower: bool| {
        ok.then(|| {
            if lower {
                value.to_ascii_lowercase()
            } else {
                value.to_owned()
            }
        })
    };
    match (tag, name) {
        ("img", "align") => keep(
            one_of(
                value,
                &["left", "right", "center", "top", "middle", "bottom"],
            ),
            true,
        ),
        ("table", "align") => keep(one_of(value, &["left", "right", "center"]), true),
        ("img" | "table" | "td" | "th", "width" | "height") => keep(is_dimension(value), false),
        ("td" | "th", "valign") => keep(
            one_of(value, &["top", "middle", "bottom", "baseline"]),
            true,
        ),
        ("ol", "start") => {
            let digits = value.strip_prefix('-').unwrap_or(value);
            keep(
                (1..=6).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()),
                false,
            )
        }
        ("ol", "type") => keep(matches!(value, "1" | "a" | "A" | "i" | "I"), false),
        ("source", "media" | "sizes") => keep(is_source_condition(value), false),
        _ => Some(value.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `markdownConvergence.test.ts` #9: CSS variables and unbounded geometry
    /// cannot bypass the presentation policy.
    #[test]
    fn css_variables_and_unbounded_geometry_cannot_bypass_the_policy() {
        assert!(is_safe_style_value("color", "var(--text-accent, red)"));
        assert!(is_safe_style_value(
            "border-color",
            "var(--border-color, red)"
        ));
        assert!(!is_safe_style_value("border", "var(--host-border)"));
        assert!(!is_safe_style_value(
            "border-width",
            "var(--host-border-width)"
        ));
        assert!(!is_safe_style_value("display", "var(--hide-content)"));
        assert!(!is_safe_style_value(
            "background",
            "var(--remote-background)"
        ));
        assert!(!is_safe_style_value("width", "999999px"));
        assert!(is_safe_style_value("width", "100%"));
        assert!(!is_safe_style_value("margin-left", "-100px"));
        assert!(!is_safe_style_value("overflow", "visible"));
        assert_eq!(color_fallback("var(--text-accent, red)"), Some("red"));
        assert_eq!(color_fallback("var(--text-accent)"), None);
        assert_eq!(color_fallback("#fff"), Some("#fff"));
    }
}
