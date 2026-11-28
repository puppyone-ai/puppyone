//! `electron/main/agent/runtime/agent-file-change-blocks.mjs`.
use crate::agent::contract::js::Obj;
use crate::text;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

static HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:diff --git |Index: |index |--- |\+\+\+ )").expect("header pattern")
});

/// Translate a textual patch into ordered display blocks. This never applies
/// a patch: context separates edits and is not presented as removed/added
/// text. `None` for a binary change or an unfamiliar format.
pub fn file_change_blocks(diff: &str) -> Option<Vec<Value>> {
    let mut blocks = Vec::new();
    let mut removed: Vec<&str> = Vec::new();
    let mut added: Vec<&str> = Vec::new();
    let mut in_hunk = false;
    let flush = |blocks: &mut Vec<Value>, removed: &mut Vec<&str>, added: &mut Vec<&str>| {
        if !removed.is_empty() || !added.is_empty() {
            blocks.push(
                Obj::new()
                    .opt("removed", (!removed.is_empty()).then(|| removed.join("\n")))
                    .opt("added", (!added.is_empty()).then(|| added.join("\n")))
                    .build(),
            );
        }
        removed.clear();
        added.clear();
    };
    for line in diff.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)) {
        if line.starts_with("@@") {
            flush(&mut blocks, &mut removed, &mut added);
            in_hunk = true;
            continue;
        }
        if HEADER.is_match(line) && !in_hunk {
            continue;
        }
        if line.starts_with("diff --git ") {
            flush(&mut blocks, &mut removed, &mut added);
            in_hunk = false;
            continue;
        }
        if line == "\\ No newline at end of file" {
            continue;
        }
        if let Some(rest) = line.strip_prefix('-') {
            removed.push(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix('+') {
            added.push(rest);
            continue;
        }
        if line.starts_with(' ') || line.is_empty() {
            flush(&mut blocks, &mut removed, &mut added);
            continue;
        }
        // Binary changes or unfamiliar formats remain readable as neutral output.
        return None;
    }
    flush(&mut blocks, &mut removed, &mut added);
    Some(blocks)
}

pub struct BoundBlocks {
    pub blocks: Vec<Value>,
    pub used: usize,
    pub truncated: bool,
}

/// `boundFileChangeBlocks(blocks, budget, maxBlocks)`.
pub fn bound_file_change_blocks(blocks: &[Value], budget: usize, max_blocks: usize) -> BoundBlocks {
    let mut result = Vec::new();
    let mut used = 0;
    let mut truncated = blocks.len() > max_blocks;
    for block in blocks.iter().take(max_blocks) {
        let mut next = Obj::new();
        let mut any = false;
        for key in ["removed", "added"] {
            let Some(text) = block.get(key).and_then(Value::as_str) else {
                continue;
            };
            let available = budget.saturating_sub(used);
            let length = text::len16(text);
            if length > available {
                truncated = true;
            }
            if available > 0 || length == 0 {
                next.insert(key, text::head16(text, available));
                any = true;
            }
            used += length.min(available);
        }
        if any {
            result.push(next.build());
        }
    }
    BoundBlocks {
        blocks: result,
        used,
        truncated,
    }
}
