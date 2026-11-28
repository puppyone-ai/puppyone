//! In-document fragment normalization and lookup
//! (product `core/links/markdownFragmentTargets.ts`).
use crate::editor::navigation;

/// Normalize a Markdown heading or HTML fragment identifier (strip optional
/// leading `#`, percent-decode, trim, lowercase).
pub fn fragment(value: &str) -> String {
    navigation::percent_decode(value.trim().strip_prefix('#').unwrap_or(value.trim()))
        .trim()
        .to_lowercase()
}

/// A fragment decoded once, exactly (`decodeMarkdownFragment`): `None` when
/// a `%` escape is malformed or the bytes are not UTF-8.
pub fn decode_exact(value: &str) -> Option<String> {
    let raw = value.trim();
    let raw = raw.strip_prefix('#').unwrap_or(raw);
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = raw.get(i + 1..i + 3)?;
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}
