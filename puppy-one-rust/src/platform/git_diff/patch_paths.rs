//! Decode Git's quoted patch paths without interpreting filename characters
//! as separators. NUL status records elsewhere do not need this decoding.
fn quoted(value: &str) -> Option<(String, usize)> {
    let bytes = value.as_bytes();
    if bytes.first() != Some(&b'"') {
        return None;
    }
    let mut out = Vec::new();
    let mut index = 1;
    while let Some(&byte) = bytes.get(index) {
        index += 1;
        match byte {
            b'"' => return String::from_utf8(out).ok().map(|text| (text, index)),
            b'\\' => {
                let escaped = *bytes.get(index)?;
                index += 1;
                out.push(match escaped {
                    b'a' => 7,
                    b'b' => 8,
                    b't' => b'\t',
                    b'n' => b'\n',
                    b'v' => 11,
                    b'f' => 12,
                    b'r' => b'\r',
                    b'\\' => b'\\',
                    b'"' => b'"',
                    b'0'..=b'3' => {
                        let second = *bytes.get(index)?;
                        let third = *bytes.get(index + 1)?;
                        if !(b'0'..=b'7').contains(&second) || !(b'0'..=b'7').contains(&third) {
                            return None;
                        }
                        index += 2;
                        (escaped - b'0') * 64 + (second - b'0') * 8 + (third - b'0')
                    }
                    _ => return None,
                });
            }
            _ => out.push(byte),
        }
    }
    None
}
pub(super) fn unquote(value: &str) -> String {
    quoted(value)
        .filter(|(_, end)| *end == value.len())
        .map_or_else(|| value.into(), |(path, _)| path)
}
pub(super) fn marker(value: &str, prefix: &str) -> Option<String> {
    // Git appends a tab to unquoted filenames containing spaces. Literal
    // tabs in filenames are quoted and encoded as backslash-t.
    let value = value.split('\t').next()?;
    if value == "/dev/null" {
        return None;
    }
    let path = unquote(value);
    path.strip_prefix(prefix).map(str::to_owned)
}
pub(super) fn header(value: &str) -> (String, String) {
    let pair = if let Some((old, end)) = quoted(value) {
        (old, unquote(value[end..].trim_start_matches(' ')))
    } else if let Some((old, new)) = value.split_once(" \"b/") {
        (old.into(), unquote(&format!("\"b/{new}")))
    } else {
        // Binary files have no ---/+++ markers. For an unchanged path, pick
        // the split where both sides agree even if the name contains " b/".
        let split = value
            .match_indices(" b/")
            .map(|(i, _)| i)
            .find(|&i| value[..i].strip_prefix("a/") == Some(&value[i + 3..]))
            .or_else(|| value.find(" b/"));
        match split {
            Some(i) => (value[..i].into(), value[i + 1..].into()),
            None => (String::new(), value.into()),
        }
    };
    (
        pair.0.strip_prefix("a/").unwrap_or(&pair.0).into(),
        pair.1.strip_prefix("b/").unwrap_or(&pair.1).into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn git_c_quoted_paths_decode_utf8_octal_and_control_characters_without_loss() {
        assert_eq!(
            unquote(r#""a/\303\251\t\n\r\a\b\v\f\\\".txt""#),
            "a/é\t\n\r\x07\x08\x0b\x0c\\\".txt"
        );
        for invalid in [
            r#""unterminated"#,
            r#""bad\8""#,
            r#""bad\400""#,
            r#""bad\7""#,
            r#""bad\377""#,
        ] {
            assert_eq!(unquote(invalid), invalid);
        }
        for (value, expected) in [
            ("a/a b/name b/a b/name", ("a b/name", "a b/name")),
            (r#""a/old\nname" b/new name"#, ("old\nname", "new name")),
            (r#"a/old name "b/new\tname""#, ("old name", "new\tname")),
        ] {
            let (before, after) = header(value);
            assert_eq!((before.as_str(), after.as_str()), expected);
        }
    }
}
