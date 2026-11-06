//! `domain/agent-stream-presentation.ts`: Renderer-only smoothing of live
//! assistant text, and the stable/tail split that keeps incomplete Markdown
//! from remounting the live line.
use crate::agent::contract::js;
use regex::Regex;
use std::sync::LazyLock;
use unicode_segmentation::UnicodeSegmentation;

const TARGET_CATCH_UP_FRAMES: usize = 6;

/// `nextAgentStreamText(displayed, authoritative)`: the adaptive step bounds
/// visual lag even when a provider delivers a burst.
pub fn next_agent_stream_text(displayed: &str, authoritative: &str) -> String {
    let Some(pending) = authoritative.strip_prefix(displayed) else {
        return authoritative.to_string();
    };
    if pending.is_empty() {
        return displayed.to_string();
    }
    let graphemes: Vec<&str> = pending.graphemes(true).collect();
    let count = graphemes.len().div_ceil(TARGET_CATCH_UP_FRAMES).max(1);
    format!("{displayed}{}", graphemes[..count].concat())
}

/// `splitStreamingMarkdown(text)`: `{ stable, tail }`. A validated GFM table
/// is the one exception to keeping incomplete blocks in the tail: once its
/// header contract is complete, newline-terminated body rows become stable.
pub fn split_streaming_markdown(text: &str) -> (String, String) {
    let normalized = normalize_newlines(text);
    let mut open_fence: Option<OpenMarkdownFence> = None;
    let mut safe_boundary = 0usize;
    let mut cursor = 0usize;
    let mut table_header_columns: Option<usize> = None;
    let mut in_table = false;
    for line in normalized.split_inclusive('\n') {
        let line_start = cursor;
        cursor += line.len();
        let terminated = line.ends_with('\n');
        let content = if terminated {
            &line[..line.len() - 1]
        } else {
            line
        };
        let next_fence = advance_open_markdown_fence(open_fence.clone(), content);
        if next_fence != open_fence {
            open_fence = next_fence;
            table_header_columns = None;
            in_table = false;
            if open_fence.is_none() {
                safe_boundary = cursor;
            }
            continue;
        }
        if open_fence.is_some() {
            continue;
        }
        if in_table {
            if js::trim(content).is_empty() {
                safe_boundary = cursor;
                in_table = false;
                table_header_columns = None;
                continue;
            }
            // GFM pads pipe-less body rows with empty cells, so a structural
            // pipe is not required here. Stop only when CommonMark starts a
            // competing flow block.
            if terminated && !interrupts_gfm_table(content) {
                safe_boundary = cursor;
                continue;
            }
            in_table = false;
            table_header_columns = None;
        }
        if js::trim(content).is_empty() {
            safe_boundary = cursor;
            table_header_columns = None;
            continue;
        }
        if let Some(columns) = table_header_columns {
            if terminated && is_gfm_table_delimiter(content, columns) {
                safe_boundary = cursor;
                in_table = true;
            }
            table_header_columns = None;
            continue;
        }
        // The candidate must begin at the current stable boundary. This
        // prevents a pipe in an unfinished prose paragraph from promoting it.
        if terminated && line_start == safe_boundary {
            table_header_columns = gfm_table_header_column_count(content);
        }
    }
    (
        normalized[..safe_boundary].to_string(),
        normalized[safe_boundary..].to_string(),
    )
}

fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn gfm_table_header_column_count(line: &str) -> Option<usize> {
    split_gfm_table_cells(line)
        .filter(|cells| !cells.is_empty())
        .map(|cells| cells.len())
}

fn is_gfm_table_delimiter(line: &str, header_columns: usize) -> bool {
    static CELL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^:?-+:?$").expect("cell"));
    split_gfm_table_cells(line).is_some_and(|cells| {
        cells.len() == header_columns && cells.iter().all(|cell| CELL.is_match(js::trim(cell)))
    })
}

const GFM_TABLE_HTML_BLOCK_TAGS: &str = "address|article|aside|base|basefont|blockquote|body|caption|center|col|\
colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|\
head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|\
section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";

/// Flow blocks end a GFM table instead of becoming padded body rows.
fn interrupts_gfm_table(line: &str) -> bool {
    static INDENTED: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(?: {4}|\t)").expect("indented"));
    static HEADING: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^\s{0,3}#{1,6}(?:[ \t]+|$)").expect("heading"));
    static QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s{0,3}>").expect("quote"));
    static LIST: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^\s{0,3}(?:[-+*](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))").expect("list")
    });
    static RULE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^\s{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$").expect("rule")
    });
    static HTML: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(&format!(
            r"(?i)^\s{{0,3}}(?:<!--|<\?|<![A-Z]|<!\[CDATA\[|</?(?:{GFM_TABLE_HTML_BLOCK_TAGS})(?:\s|/?>|$))"
        ))
        .expect("html")
    });
    INDENTED.is_match(line)
        || HEADING.is_match(line)
        || QUOTE.is_match(line)
        || LIST.is_match(line)
        || RULE.is_match(line)
        || HTML.is_match(line)
}

/// Splits only structural pipes, leaving escaped pipes and inline code
/// intact.
fn split_gfm_table_cells(line: &str) -> Option<Vec<String>> {
    let source: Vec<char> = js::trim(line).chars().collect();
    let mut cells: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut separators = 0;
    let mut code_ticks = 0;
    let mut last_was_separator = false;
    let mut index = 0;
    while index < source.len() {
        let character = source[index];
        if character == '\\' && index + 1 < source.len() {
            cell.push(character);
            cell.push(source[index + 1]);
            last_was_separator = false;
            index += 2;
            continue;
        }
        if character == '`' {
            let mut run = 1;
            while source.get(index + run) == Some(&'`') {
                run += 1;
            }
            cell.push_str(&"`".repeat(run));
            if code_ticks == 0 {
                code_ticks = run;
            } else if code_ticks == run {
                code_ticks = 0;
            }
            last_was_separator = false;
            index += run;
            continue;
        }
        if character == '|' && code_ticks == 0 {
            cells.push(std::mem::take(&mut cell));
            separators += 1;
            last_was_separator = true;
            index += 1;
            continue;
        }
        cell.push(character);
        last_was_separator = false;
        index += 1;
    }
    if separators == 0 {
        return None;
    }
    cells.push(cell);
    if source.first() == Some(&'|') {
        cells.remove(0);
    }
    if last_was_separator {
        cells.pop();
    }
    Some(cells)
}

/// `OpenMarkdownFence`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenMarkdownFence {
    pub marker: char,
    pub length: usize,
    pub info: String,
}

/// `findOpenMarkdownFence(source)`: the CommonMark fence scanner shared by
/// streaming and bounded head/tail windows.
pub fn find_open_markdown_fence(source: &str) -> Option<OpenMarkdownFence> {
    normalize_newlines(source)
        .split('\n')
        .fold(None, advance_open_markdown_fence)
}

/// `advanceOpenMarkdownFence(openFence, line)`.
pub fn advance_open_markdown_fence(
    open_fence: Option<OpenMarkdownFence>,
    line: &str,
) -> Option<OpenMarkdownFence> {
    static FENCE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^\s{0,3}(`{3,}|~{3,})(.*)$").expect("fence"));
    let Some(captures) = FENCE.captures(line) else {
        return open_fence;
    };
    let run = &captures[1];
    let marker = run.chars().next().unwrap_or('`');
    let remainder = &captures[2];
    let Some(open) = open_fence else {
        if marker == '`' && remainder.contains('`') {
            return None;
        }
        return Some(OpenMarkdownFence {
            marker,
            length: run.len(),
            info: js::trim(remainder).to_string(),
        });
    };
    if open.marker != marker || run.len() < open.length || !js::trim(remainder).is_empty() {
        return Some(open);
    }
    None
}
