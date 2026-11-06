//! `domain/agent-tool-evidence.ts`: bounded rendering models for tool output
//! and structured input. The source stays available for an explicit copy,
//! but the view never receives an unbounded text run. Lengths and offsets
//! count UTF-16 code units, as the product's do.
use crate::agent::contract::js;
use serde_json::{Map, Value};

/// `AgentToolEvidenceLimits`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentToolEvidenceLimits {
    pub max_chars: usize,
    pub max_lines: usize,
    pub max_line_chars: usize,
    pub head_lines: usize,
    pub tail_lines: usize,
}

/// `agentToolEvidenceLimits`.
pub const AGENT_TOOL_EVIDENCE_LIMITS: AgentToolEvidenceLimits = AgentToolEvidenceLimits {
    max_chars: 24 * 1024,
    max_lines: 400,
    max_line_chars: 4 * 1024,
    head_lines: 300,
    tail_lines: 80,
};

/// `AgentToolEvidencePreview`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentToolEvidencePreview {
    pub head: String,
    pub tail: String,
    pub source_length: usize,
    pub total_lines: usize,
    pub omitted_chars: usize,
    pub omitted_lines: usize,
    pub truncated: bool,
}

/// `AgentToolResultLines`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentToolResultLines {
    pub lines: Vec<String>,
    pub total_lines: usize,
    pub omitted_lines: usize,
}

const INPUT_TEXT_BUDGET: usize = 8 * 1024;
const INPUT_NODE_BUDGET: usize = 512;
const INPUT_COLLECTION_BUDGET: usize = 40;
const INPUT_DEPTH_BUDGET: usize = 8;

/// A JS string: UTF-16 code units.
struct Units(Vec<u16>);

impl Units {
    fn new(source: &str) -> Self {
        Self(source.encode_utf16().collect())
    }
    fn len(&self) -> usize {
        self.0.len()
    }
    fn slice(&self, start: usize, end: usize) -> &[u16] {
        &self.0[start.min(self.len())..end.min(self.len())]
    }
}

fn text(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// `forEachLine(source, visit)`: `\n` separated, a trailing `\r` excluded.
fn for_each_line(source: &Units, mut visit: impl FnMut(usize, usize) -> bool) {
    if source.len() == 0 {
        return;
    }
    let mut start = 0;
    while start <= source.len() {
        let newline = source.0[start..]
            .iter()
            .position(|unit| *unit == 10)
            .map(|offset| start + offset);
        let raw_end = newline.unwrap_or(source.len());
        let end = if raw_end > start && source.0[raw_end - 1] == 13 {
            raw_end - 1
        } else {
            raw_end
        };
        if !visit(start, end) {
            return;
        }
        let Some(newline) = newline else {
            break;
        };
        start = newline + 1;
    }
}

/// `clipLine(value, maxChars)`.
fn clip_line(value: &[u16], max_chars: usize) -> Vec<u16> {
    if value.len() <= max_chars {
        return value.to_vec();
    }
    let ellipsis: Vec<u16> = "…".encode_utf16().collect();
    if max_chars <= 1 {
        return ellipsis[..max_chars.min(ellipsis.len())].to_vec();
    }
    let mut clipped = value[..max_chars - 1].to_vec();
    clipped.extend(ellipsis);
    clipped
}

fn join(values: &[Vec<u16>]) -> String {
    let mut joined: Vec<u16> = Vec::new();
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            joined.push(10);
        }
        joined.extend_from_slice(value);
    }
    text(&joined)
}

/// `createAgentToolEvidencePreview(source, limits)`.
pub fn create_agent_tool_evidence_preview(
    source: &str,
    limits: AgentToolEvidenceLimits,
) -> AgentToolEvidencePreview {
    if source.is_empty() {
        return AgentToolEvidencePreview::default();
    }
    let units = Units::new(source);
    let (lines, longest_line) = scan_text(&units);
    let truncated = units.len() > limits.max_chars
        || lines > limits.max_lines
        || longest_line > limits.max_line_chars;
    if !truncated {
        return AgentToolEvidencePreview {
            head: source.to_string(),
            tail: String::new(),
            source_length: units.len(),
            total_lines: lines,
            omitted_chars: 0,
            omitted_lines: 0,
            truncated: false,
        };
    }
    let head_budget = ((limits.max_chars as f64 * 0.75).floor() as usize).max(1);
    let tail_budget = limits.max_chars.saturating_sub(head_budget);
    let head = collect_head(
        &units,
        limits.head_lines,
        limits.max_line_chars,
        head_budget,
    );
    let remaining_lines = lines.saturating_sub(head.lines);
    let tail = if remaining_lines > 0 {
        collect_tail(
            &units,
            limits.tail_lines.min(remaining_lines),
            limits.max_line_chars,
            tail_budget,
        )
    } else {
        Collected::default()
    };
    let captured_chars = units.len().min(head.raw_chars + tail.raw_chars);
    let captured_lines = lines.min(head.lines + tail.lines);
    AgentToolEvidencePreview {
        head: head.text,
        tail: tail.text,
        source_length: units.len(),
        total_lines: lines,
        omitted_chars: units.len().saturating_sub(captured_chars),
        omitted_lines: lines.saturating_sub(captured_lines),
        truncated: true,
    }
}

/// `collectAgentToolResultLines(source, maxLines, maxLineChars)`: only the
/// rows the search/list view can mount.
pub fn collect_agent_tool_result_lines(
    source: &str,
    max_lines: usize,
    max_line_chars: usize,
) -> AgentToolResultLines {
    let units = Units::new(source);
    let mut lines = Vec::new();
    let mut total_lines = 0;
    for_each_line(&units, |start, end| {
        let value = units.slice(start, end);
        if js::trim(&text(value)).is_empty() {
            return true;
        }
        total_lines += 1;
        if lines.len() < max_lines {
            lines.push(text(&clip_line(value, max_line_chars)));
        }
        true
    });
    let omitted_lines = total_lines - lines.len();
    AgentToolResultLines {
        lines,
        total_lines,
        omitted_lines,
    }
}

/// `stringifyAgentToolInput(value)`: structured tool input serialized after
/// aggregate node, text and depth budgets.
pub fn stringify_agent_tool_input(value: &Value) -> Option<String> {
    let mut state = InputBudget {
        remaining_chars: INPUT_TEXT_BUDGET,
        remaining_nodes: INPUT_NODE_BUDGET,
    };
    let bounded = bound_input_value(value, &mut state, 0);
    let object = bounded.as_object()?;
    if object.is_empty() {
        return None;
    }
    let serialized = serde_json::to_string_pretty(&bounded).ok()?;
    Some(js::head16(&serialized, 32 * 1024).to_string())
}

fn scan_text(source: &Units) -> (usize, usize) {
    let mut lines = 0;
    let mut longest = 0;
    for_each_line(source, |start, end| {
        lines += 1;
        longest = longest.max(end - start);
        true
    });
    (lines, longest)
}

#[derive(Default)]
struct Collected {
    text: String,
    raw_chars: usize,
    lines: usize,
}

fn collect_head(
    source: &Units,
    max_lines: usize,
    max_line_chars: usize,
    max_chars: usize,
) -> Collected {
    let mut values: Vec<Vec<u16>> = Vec::new();
    let mut used = 0;
    let mut raw_chars = 0;
    let mut lines = 0;
    for_each_line(source, |start, end| {
        if lines >= max_lines || used >= max_chars {
            return false;
        }
        let separator = usize::from(!values.is_empty());
        let available = max_chars.saturating_sub(used + separator);
        if available == 0 {
            return false;
        }
        let raw_length = end - start;
        let clipped = clip_line(source.slice(start, end), max_line_chars.min(available));
        used += separator + clipped.len();
        raw_chars += raw_length.min(clipped.len());
        values.push(clipped);
        lines += 1;
        true
    });
    Collected {
        text: join(&values),
        raw_chars,
        lines,
    }
}

fn collect_tail(
    source: &Units,
    max_lines: usize,
    max_line_chars: usize,
    max_chars: usize,
) -> Collected {
    let mut values: std::collections::VecDeque<(Vec<u16>, usize)> =
        std::collections::VecDeque::new();
    let mut used: isize = 0;
    for_each_line(source, |start, end| {
        let raw_length = end - start;
        let clipped = clip_line(source.slice(start, end), max_line_chars.min(max_chars));
        let raw = raw_length.min(clipped.len());
        used += clipped.len() as isize;
        values.push_back((clipped, raw));
        if values.len() > 1 {
            used += 1;
        }
        while values.len() > max_lines || used > max_chars as isize {
            let Some((removed, _)) = values.pop_front() else {
                break;
            };
            used -= removed.len() as isize + if values.is_empty() { 0 } else { 1 };
        }
        true
    });
    let texts: Vec<Vec<u16>> = values.iter().map(|(text, _)| text.clone()).collect();
    Collected {
        text: join(&texts),
        raw_chars: values.iter().map(|(_, raw)| raw).sum(),
        lines: values.len(),
    }
}

struct InputBudget {
    remaining_chars: usize,
    remaining_nodes: usize,
}

fn bound_input_value(value: &Value, state: &mut InputBudget, depth: usize) -> Value {
    if state.remaining_nodes == 0 || state.remaining_chars == 0 || depth > INPUT_DEPTH_BUDGET {
        return Value::from("[truncated]");
    }
    state.remaining_nodes -= 1;
    match value {
        Value::String(string) => {
            let length16 = js::len16(string);
            let length = length16.min(state.remaining_chars).min(4 * 1024);
            state.remaining_chars -= length;
            if length16 > length {
                Value::from(format!("{}…", js::head16(string, length.saturating_sub(1))))
            } else {
                value.clone()
            }
        }
        Value::Array(entries) => Value::Array(
            entries
                .iter()
                .take(INPUT_COLLECTION_BUDGET)
                .map(|entry| bound_input_value(entry, state, depth + 1))
                .collect(),
        ),
        Value::Object(entries) => {
            let mut next = Map::new();
            for (key, entry) in entries.iter().take(INPUT_COLLECTION_BUDGET) {
                if state.remaining_nodes == 0 || state.remaining_chars == 0 {
                    next.insert("…".into(), Value::from("[truncated]"));
                    break;
                }
                next.insert(
                    js::head16(key, 512).to_string(),
                    bound_input_value(entry, state, depth + 1),
                );
            }
            Value::Object(next)
        }
        _ => value.clone(),
    }
}
