//! Shared fenced-block helpers (`getCodeFenceMarker`, `parseMarkdownCodeFenceInfo`):
//! fence-marker scanning, atomic delimiter ranges, and fence info/language parsing.
use std::ops::Range;

/// `getCodeFenceMarker`: returns `(fence_byte, run_len)` for a line starting
/// with up to 3 spaces followed by at least 3 `` ` `` or `~` characters.
pub fn fence_marker(line: &str) -> Option<(u8, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line.as_bytes()[indent..];
    let c = *rest.first()?;
    let run = rest.iter().take_while(|b| **b == c).count();
    (matches!(c, b'`' | b'~') && run >= 3).then_some((c, run))
}

/// CommonMark opening fence (`run >= 3`, backtick info string may not contain
/// backticks).
pub fn fence_open(line: &str) -> Option<(u8, usize)> {
    let indent = line.len() - line.trim_start_matches([' ', '\t']).len();
    if indent > 3 {
        return None;
    }
    let rest = &line.as_bytes()[indent..];
    let c = *rest.first()?;
    let run = rest.iter().take_while(|b| **b == c).count();
    if !matches!(c, b'`' | b'~') || run < 3 {
        return None;
    }
    if c == b'`' && rest[run..].contains(&b'`') {
        return None;
    }
    Some((c, run))
}

/// CommonMark closing fence (`run >= open_run`, followed only by whitespace).
pub fn fence_closes(line: &str, open_char: u8, open_run: usize) -> bool {
    let t = line.trim();
    let n = t.bytes().take_while(|&b| b == open_char).count();
    n >= open_run && n == t.len()
}

/// Atomic delimiter ranges `(opening_fence, closing_fence)` around `code`
/// within `range`, so the caret cannot rest on hidden fence lines while a
/// fenced block widget is rendered.
pub fn fence_delimiter_ranges(
    range: &Range<usize>,
    code: &Range<usize>,
) -> (Range<usize>, Range<usize>) {
    (
        range.start..code.start.max(range.start),
        code.end..range.end.max(code.end),
    )
}

/// The file and lines a fenced block quotes (`MarkdownCodeSourceReference`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SourceReference {
    pub path: String,
    pub start_line: u64,
    pub end_line: u64,
}

/// What a fence's info string says (`parseMarkdownCodeFenceInfo`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FenceInfo {
    pub language: String,
    pub source: Option<SourceReference>,
}

/// `Number.MAX_SAFE_INTEGER`: line numbers past it are not numbers.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

fn line_number(digits: &str) -> Option<u64> {
    digits.parse().ok().filter(|n| *n <= MAX_SAFE_INTEGER)
}

/// `createCodeSourceReference`.
fn source_reference(path: &str, start_line: u64, end_line: u64) -> Option<SourceReference> {
    let path = path.trim();
    (!path.is_empty() && !path.contains(['\r', '\n']) && start_line >= 1 && end_line >= start_line)
        .then(|| SourceReference {
            path: path.to_owned(),
            start_line,
            end_line,
        })
}

/// `parseMarkdownCodeFenceInfo`: the language of a fence, inferred from the
/// file it quotes when only a file is named (`83:99:package.json`,
/// `file="scripts/release.py" lines="4"`).
pub fn parse_fence_info(value: &str) -> FenceInfo {
    let info = value.trim();
    if info.is_empty() {
        return FenceInfo {
            language: String::new(),
            source: None,
        };
    }
    // `/^(\d+):(\d+):(.+)$/`
    let legacy = info.split_once(':').and_then(|(start, rest)| {
        let (end, path) = rest.split_once(':')?;
        let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
        (digits(start) && digits(end) && !path.is_empty())
            .then_some(())
            .and_then(|()| source_reference(path, line_number(start)?, line_number(end)?))
    });
    if let Some(source) = legacy {
        return FenceInfo {
            language: language_from_path(&source.path),
            source: Some(source),
        };
    }
    let first = info.split_whitespace().next().unwrap_or("");
    let path = fence_attribute(info, &["file", "source", "path"]);
    let lines = fence_attribute(info, &["lines"]).and_then(|v| line_range(&v));
    let source = path
        .zip(lines)
        .and_then(|(path, (start, end))| source_reference(&path, start, end));
    let explicit = if first.contains('=') { "" } else { first };
    let language = if !explicit.is_empty() {
        explicit.to_owned()
    } else {
        source
            .as_ref()
            .map(|s| language_from_path(&s.path))
            .unwrap_or_default()
    };
    FenceInfo { language, source }
}

/// `readFenceInfoAttribute`: the first `name=value` among `names`
/// (`/(?:^|\s)([a-z][\w-]*)=("…"|'…'|[^\s]+)/gi`), its value decoded.
fn fence_attribute(info: &str, names: &[&str]) -> Option<String> {
    let bytes = info.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let starts = i == 0 || bytes[i - 1].is_ascii_whitespace();
        let Some((name, value, end)) = starts.then(|| attribute_at(info, i)).flatten() else {
            i += 1;
            continue;
        };
        if names.contains(&name.to_ascii_lowercase().as_str()) {
            return Some(decode_attribute(value));
        }
        i = end;
    }
    None
}

/// One `name=value` at `at`: (name, raw value, end).
fn attribute_at(info: &str, at: usize) -> Option<(&str, &str, usize)> {
    let bytes = info.as_bytes();
    if !bytes.get(at)?.is_ascii_alphabetic() {
        return None;
    }
    let name_end = at
        + bytes[at..]
            .iter()
            .take_while(|b| b.is_ascii_alphanumeric() || **b == b'_' || **b == b'-')
            .count();
    if bytes.get(name_end) != Some(&b'=') {
        return None;
    }
    let from = name_end + 1;
    let quoted = match bytes.get(from) {
        Some(&q @ (b'"' | b'\'')) => {
            let mut j = from + 1;
            let mut close = None;
            while j < bytes.len() {
                match bytes[j] {
                    b'\\' => j += 2,
                    b if b == q => {
                        close = Some(j);
                        break;
                    }
                    _ => j += 1,
                }
            }
            close.map(|c| c + 1)
        }
        _ => None,
    };
    let end = quoted.unwrap_or_else(|| {
        from + bytes[from..]
            .iter()
            .take_while(|b| !b.is_ascii_whitespace())
            .count()
    });
    (end > from).then(|| (&info[at..name_end], &info[from..end], end))
}

/// `decodeFenceInfoAttribute`.
fn decode_attribute(value: &str) -> String {
    if value.starts_with('"') {
        serde_json::from_str::<String>(value).unwrap_or_default()
    } else if value.starts_with('\'') && value.len() >= 2 {
        value[1..value.len() - 1]
            .replace("\\'", "'")
            .replace("\\\\", "\\")
    } else {
        value.to_owned()
    }
}

/// `parseCodeLineRange`: `12`, `12-18`, `L12:L18` or `12..18`.
fn line_range(value: &str) -> Option<(u64, u64)> {
    let strip_l = |s: &str| s.strip_prefix(['L', 'l']).unwrap_or(s).to_owned();
    let value = value.trim();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let (start, end) = match ["..", "-", ":"]
        .iter()
        .find_map(|sep| value.split_once(sep))
    {
        Some((a, b)) => (strip_l(a.trim_end()), strip_l(b.trim_start())),
        None => (strip_l(value), strip_l(value)),
    };
    if !digits(&start) || !digits(&end) {
        return None;
    }
    let (start, end) = (line_number(&start)?, line_number(&end)?);
    (start >= 1 && end >= start).then_some((start, end))
}

/// `inferCodeLanguageFromPath`.
pub fn language_from_path(path: &str) -> String {
    let name = path
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_lowercase();
    if name == "dockerfile" || name == "makefile" {
        return name;
    }
    let Some((_, extension)) = name.rsplit_once('.').filter(|(_, e)| !e.is_empty()) else {
        return String::new();
    };
    let known = match extension {
        "bash" | "sh" | "zsh" => "bash",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cjs" | "js" | "mjs" => "javascript",
        "cs" => "csharp",
        "cts" | "mts" | "ts" => "typescript",
        "ex" | "exs" => "elixir",
        "fs" | "fsx" => "fsharp",
        "htm" | "html" => "html",
        "kt" | "kts" => "kotlin",
        "md" => "markdown",
        "mmd" => "mermaid",
        "pl" => "perl",
        "proto" => "protobuf",
        "py" => "python",
        "rb" => "ruby",
        "rs" => "rust",
        "tex" => "latex",
        "txt" => "text",
        "yaml" | "yml" => "yaml",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_owned();
    }
    let plain = extension.len() <= 16
        && extension
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+#-".contains(&b));
    if plain {
        extension.to_owned()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn fence_markers_follow_product_thresholds() {
        assert_eq!(fence_marker("   ```rust\n"), Some((b'`', 3)));
        assert_eq!(fence_marker("~~~~\n"), Some((b'~', 4)));
        assert_eq!(fence_marker("    ```\n"), None);
        assert_eq!(fence_marker("``\n"), None);
        assert_eq!(
            fence_delimiter_ranges(&(10..50), &(18..46)),
            (10..18, 46..50)
        );
    }

    /// `markdownCodeBlockMetadata.test.ts`: legacy `start:end:path` and
    /// structured (quoted) metadata name the quoted file and lines, the
    /// language follows the first token or else the file; a language-only
    /// fence quotes nothing; common extensions map to their languages.
    #[test]
    fn fence_info_names_the_quoted_file_and_infers_its_language() {
        let source = |path: &str, start_line, end_line| {
            Some(SourceReference {
                path: path.into(),
                start_line,
                end_line,
            })
        };
        let info = |language: &str, source| FenceInfo {
            language: language.into(),
            source,
        };
        assert_eq!(
            parse_fence_info("83:99:package.json"),
            info("json", source("package.json", 83, 99))
        );
        assert_eq!(
            parse_fence_info(r#"typescript file="src/components/My View.tsx" lines="12-18""#),
            info("typescript", source("src/components/My View.tsx", 12, 18))
        );
        assert_eq!(
            parse_fence_info(r#"file="scripts/release.py" lines="4""#),
            info("python", source("scripts/release.py", 4, 4))
        );
        assert_eq!(
            parse_fence_info("ts path='src/odd`name.ts' lines=L7..L9"),
            info("ts", source("src/odd`name.ts", 7, 9))
        );
        assert_eq!(parse_fence_info("tsx"), info("tsx", None));
        assert_eq!(parse_fence_info("99:83:x.rs"), info("99:83:x.rs", None));
        assert_eq!(language_from_path("src/main.mts"), "typescript");
        assert_eq!(language_from_path("Dockerfile"), "dockerfile");
        assert_eq!(language_from_path("notes.weird_ext"), "");
    }
}
