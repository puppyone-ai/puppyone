//! `normalizeContent`: what a viewer shows in place of the raw text. The
//! working copy keeps the raw text until the person edits; only then is the
//! shown (normalized) text what gets saved (`EditorDocumentHost`).

/// The viewer's normalization of `text`, when it changes anything.
pub fn normalize(viewer: &str, text: &str) -> Option<String> {
    match viewer {
        "json" => format_json(text).filter(|shown| shown != text),
        _ => None,
    }
}

/// `formatJson`: `JSON.stringify(JSON.parse(text), null, 2)` for valid JSON;
/// blank or invalid text (JSON Lines included) stays as it is. Tokens are
/// kept as written (key order, number spelling and string escapes), so only
/// the layout changes.
pub fn format_json(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    serde_json::from_str::<serde::de::IgnoredAny>(text).ok()?;
    let mut out = String::with_capacity(text.len() * 2);
    let mut depth = 0usize;
    let newline = |out: &mut String, depth: usize| {
        out.push('\n');
        out.extend(std::iter::repeat_n("  ", depth));
    };
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                out.push('"');
                while let Some(c) = chars.next() {
                    out.push(c);
                    match c {
                        '\\' => out.extend(chars.next()),
                        '"' => break,
                        _ => {}
                    }
                }
            }
            '{' | '[' => {
                let close = if c == '{' { '}' } else { ']' };
                while chars.peek().is_some_and(|c| c.is_whitespace()) {
                    chars.next();
                }
                if chars.peek() == Some(&close) {
                    chars.next();
                    out.push(c);
                    out.push(close);
                } else {
                    out.push(c);
                    depth += 1;
                    newline(&mut out, depth);
                }
            }
            '}' | ']' => {
                depth = depth.saturating_sub(1);
                newline(&mut out, depth);
                out.push(c);
            }
            ',' => {
                out.push(',');
                newline(&mut out, depth);
            }
            ':' => out.push_str(": "),
            c if c.is_whitespace() => {}
            c => out.push(c),
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn json_is_shown_as_the_product_formats_it() {
        assert_eq!(
            format_json(r#"{"b":1,"a":[1, {"x" : "a,b:{}"}],"e":{},"f":[ ]}"#).unwrap(),
            "{\n  \"b\": 1,\n  \"a\": [\n    1,\n    {\n      \"x\": \"a,b:{}\"\n    }\n  ],\n  \"e\": {},\n  \"f\": []\n}"
        );
        assert_eq!(format_json(r#""a\"b""#).unwrap(), r#""a\"b""#);
        assert_eq!(format_json("42").unwrap(), "42");
        // Blank, invalid and JSON Lines text stays.
        assert_eq!(format_json("  "), None);
        assert_eq!(format_json("{\"a\":"), None);
        assert_eq!(format_json("{}\n{}"), None);
        // Already formatted text needs nothing; other viewers normalize nothing.
        let formatted = format_json(r#"{"a":1}"#).unwrap();
        assert_eq!(normalize("json", &formatted), None);
        assert_eq!(normalize("text", r#"{"a":1}"#), None);
    }
}
