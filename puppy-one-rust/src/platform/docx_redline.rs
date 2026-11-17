//! The Word redline of a revision pair (`diff/contributions/docx-redline`):
//! each revision's `word/document.xml` normalized into body blocks
//! (paragraphs, headings, list items, table rows), the blocks aligned on
//! unique anchors and a weighted edit distance, and changed blocks diffed
//! word by word — all within the product's budgets (`budget.ts`). Body text
//! only (`fidelity: "body-text-v1"`); no presentation.
#[cfg(test)]
mod acceptance_tests;
pub(crate) mod cache;
mod control;
use control::Budget;
use std::{collections::HashMap, io::Read, sync::atomic::AtomicBool};

/// `DOCX_REDLINE_BUDGET`.
const MAX_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_START_TAGS: usize = 250_000;
const MAX_XML_DEPTH: usize = 512;
const MAX_BLOCKS: usize = 12_000;
const MAX_TEXT_CHARACTERS: usize = 2_000_000;
const MAX_ALIGNMENT_CELLS: usize = 300_000;
const MAX_WORD_DIFF_CELLS: usize = 160_000;
const MAX_PRESENTED_CHANGES: usize = 1_200;
/// The most entries a package may list.
const MAX_ENTRIES: usize = 10_000;

const WORDPROCESSING: [&str; 2] = [
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
];

/// `DocxBlockKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BlockKind {
    Paragraph,
    Heading,
    ListItem,
    TableRow,
}

/// `DocxNormalizedBlock`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub kind: BlockKind,
    pub text: String,
}

/// `DocxRedlineSegment`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentKind {
    Equal,
    Add,
    Remove,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub kind: SegmentKind,
    pub text: String,
}

/// `DocxRedlineChange`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Deleted,
    Modified,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub kind: ChangeKind,
    pub block: BlockKind,
    pub before: Option<usize>,
    pub after: Option<usize>,
    pub segments: Vec<Segment>,
}

/// `DocxRedlinePresentation.state`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Ready,
    Added,
    Deleted,
    Empty,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub blocks_added: usize,
    pub blocks_deleted: usize,
    pub blocks_modified: usize,
    pub blocks_changed: usize,
    pub words_added: usize,
    pub words_deleted: usize,
}

/// `DocxRedlinePresentation`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Presentation {
    pub state: State,
    pub stats: Stats,
    pub changes: Vec<Change>,
    pub truncated: bool,
}

/// `buildDocxRedlinePresentation`: `None` is a missing side.
pub fn build(before: Option<&[u8]>, after: Option<&[u8]>) -> Result<Presentation, String> {
    build_cancellable(before, after, &AtomicBool::new(false))
}

/// The native worker shares the product's 20-second processing deadline.
pub fn build_cancellable(
    before: Option<&[u8]>,
    after: Option<&[u8]>,
    cancel: &AtomicBool,
) -> Result<Presentation, String> {
    build_with(before, after, &Budget::standard(cancel))
}

fn build_with(
    before: Option<&[u8]>,
    after: Option<&[u8]>,
    budget: &Budget<'_>,
) -> Result<Presentation, String> {
    budget.check()?;
    if before.is_none() && after.is_none() {
        return Err("Both Word revisions are missing.".into());
    }
    // One revision at a time keeps the peak memory to one package.
    let left = before
        .map(|bytes| parse_with(bytes, budget))
        .transpose()?
        .unwrap_or_default();
    let right = after
        .map(|bytes| parse_with(bytes, budget))
        .transpose()?
        .unwrap_or_default();
    let mut changes = align_with(&left, &right, budget)?;
    let stats = summarize(&changes);
    let truncated = changes.len() > MAX_PRESENTED_CHANGES;
    let state = if before.is_none() {
        State::Added
    } else if after.is_none() {
        State::Deleted
    } else if changes.is_empty() {
        State::Empty
    } else {
        State::Ready
    };
    changes.truncate(MAX_PRESENTED_CHANGES);
    budget.check()?;
    Ok(Presentation {
        state,
        stats,
        changes,
        truncated,
    })
}

/// `parseDocxRevision`: the package's body blocks.
pub fn parse(bytes: &[u8]) -> Result<Vec<Block>, String> {
    parse_with(bytes, &Budget::unlimited())
}
fn parse_with(bytes: &[u8], budget: &Budget<'_>) -> Result<Vec<Block>, String> {
    budget.check()?;
    // A Compound File: an encrypted (or legacy) Office document.
    if bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
        return Err("Encrypted or password-protected Word documents cannot be compared.".into());
    }
    let xml = document_xml(bytes, budget)?;
    normalize_with(&xml, budget)
}

fn u16_at(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as usize)
}
fn u32_at(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as u64)
}

/// `word/document.xml` out of the ZIP package, after checking every
/// entry's declared size against the budget
/// (`validateOfficePackageDecompression`).
fn document_xml(bytes: &[u8], budget: &Budget<'_>) -> Result<String, String> {
    budget.check()?;
    let structure = |what: &str| format!("The Word package is not a valid ZIP archive ({what}).");
    // End of central directory: 22 bytes plus a comment of up to 64 KiB.
    let floor = bytes.len().saturating_sub(22 + 0xffff);
    let end = (floor..=bytes.len().saturating_sub(22))
        .rev()
        .find(|&at| bytes[at..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or_else(|| structure("no directory"))?;
    let count = u16_at(bytes, end + 10).ok_or_else(|| structure("directory"))?;
    let offset = u32_at(bytes, end + 16).ok_or_else(|| structure("directory"))? as usize;
    if count == 0xffff || offset == 0xffff_ffff {
        return Err("Word package exceeds the semantic diff budget (ZIP64).".into());
    }
    if count > MAX_ENTRIES {
        return Err("Word package lists too many entries.".into());
    }
    let mut at = offset;
    let mut total = 0;
    let mut document = None;
    for _ in 0..count {
        budget.check()?;
        if !bytes
            .get(at..)
            .is_some_and(|b| b.starts_with(&[0x50, 0x4b, 0x01, 0x02]))
        {
            return Err(structure("entry"));
        }
        let field = |o: usize| u16_at(bytes, at + o).ok_or_else(|| structure("entry"));
        let flags = field(8)?;
        let method = field(10)?;
        let compressed = u32_at(bytes, at + 20).ok_or_else(|| structure("entry"))?;
        let size = u32_at(bytes, at + 24).ok_or_else(|| structure("entry"))?;
        let (name_len, extra_len, comment_len) = (field(28)?, field(30)?, field(32)?);
        let local = u32_at(bytes, at + 42).ok_or_else(|| structure("entry"))? as usize;
        let name = bytes
            .get(at + 46..at + 46 + name_len)
            .ok_or_else(|| structure("entry"))?;
        if size > MAX_ENTRY_BYTES {
            return Err("A Word package entry exceeds the decompression budget.".into());
        }
        total += size;
        if total > MAX_TOTAL_BYTES {
            return Err("The Word package exceeds the decompression budget.".into());
        }
        if name == b"word/document.xml" {
            if flags & 1 != 0 {
                return Err(
                    "Encrypted or password-protected Word documents cannot be compared.".into(),
                );
            }
            document = Some((method, compressed, size, local));
        }
        at += 46 + name_len + extra_len + comment_len;
    }
    let (method, compressed, size, local) = document
        .ok_or_else(|| "The Word package does not contain word/document.xml.".to_owned())?;
    if !bytes
        .get(local..)
        .is_some_and(|b| b.starts_with(&[0x50, 0x4b, 0x03, 0x04]))
    {
        return Err(structure("local header"));
    }
    let start = local
        + 30
        + u16_at(bytes, local + 26).ok_or_else(|| structure("local header"))?
        + u16_at(bytes, local + 28).ok_or_else(|| structure("local header"))?;
    let data = bytes
        .get(start..start + compressed as usize)
        .ok_or_else(|| structure("entry data"))?;
    let mut out = Vec::with_capacity(size as usize);
    match method {
        0 => {
            if compressed != size {
                return Err(structure("stored entry size"));
            }
            out.extend_from_slice(data);
        }
        // Never inflate past the declared size, or past the budget.
        8 => inflate(data, size, budget, &mut out)?,
        _ => return Err(structure("compression method")),
    }
    if out.len() as u64 != size {
        return Err("A Word package entry does not match its declared size.".into());
    }
    budget.check()?;
    String::from_utf8(out).map_err(|_| "Word document XML is not UTF-8.".into())
}

fn inflate(data: &[u8], size: u64, budget: &Budget<'_>, out: &mut Vec<u8>) -> Result<(), String> {
    let mut decoder = flate2::read::DeflateDecoder::new(data).take(size.min(MAX_ENTRY_BYTES) + 1);
    let mut chunk = [0u8; 64 * 1024];
    loop {
        budget.check()?;
        let read = decoder
            .read(&mut chunk)
            .map_err(|_| "The Word package has invalid deflate data.".to_owned())?;
        budget.check()?;
        if read == 0 {
            break;
        }
        out.extend_from_slice(&chunk[..read]);
    }
    Ok(())
}

/// `normalizeDocxDocumentXml`.
pub fn normalize(xml: &str) -> Result<Vec<Block>, String> {
    normalize_with(xml, &Budget::unlimited())
}
fn normalize_with(xml: &str, budget: &Budget<'_>) -> Result<Vec<Block>, String> {
    budget.check()?;
    let options = roxmltree::ParsingOptions {
        allow_dtd: false,
        nodes_limit: u32::try_from(MAX_XML_START_TAGS * 4).unwrap_or(u32::MAX),
        ..Default::default()
    };
    let document = roxmltree::Document::parse_with_options(xml, options).map_err(|e| {
        if matches!(e, roxmltree::Error::DtdDetected) {
            "Word document XML must not contain a document type declaration.".to_owned()
        } else if matches!(e, roxmltree::Error::NodesLimitReached) {
            "Word document XML exceeds the element budget.".to_owned()
        } else {
            format!("Word document XML is malformed: {e}")
        }
    })?;
    budget.check()?;
    struct Paragraph {
        parts: String,
        style: String,
        list: bool,
    }
    let mut blocks = Vec::new();
    let mut paragraph: Option<Paragraph> = None;
    let mut row: Option<Vec<String>> = None;
    let mut cell: Option<Vec<String>> = None;
    let (mut table, mut deleted, mut text_depth, mut depth) = (0usize, 0usize, 0usize, 0usize);
    let (mut start_tags, mut characters) = (0usize, 0usize);
    let push = |blocks: &mut Vec<Block>, kind, text| {
        if blocks.len() >= MAX_BLOCKS {
            return Err("Word document exceeds the semantic block budget.".to_owned());
        }
        blocks.push(Block { kind, text });
        Ok(())
    };
    let word = |node: roxmltree::Node| {
        node.is_element()
            && node
                .tag_name()
                .namespace()
                .is_some_and(|ns| WORDPROCESSING.contains(&ns))
    };
    // Document order, each node opened and then closed (`SaxesParser`).
    enum Edge<'a, 'input> {
        Open(roxmltree::Node<'a, 'input>),
        Close(roxmltree::Node<'a, 'input>),
    }
    let mut pending = vec![Edge::Open(document.root())];
    while let Some(edge) = pending.pop() {
        budget.check()?;
        if let Edge::Open(node) = edge {
            pending.push(Edge::Close(node));
            let children: Vec<_> = node.children().collect();
            pending.extend(children.into_iter().rev().map(Edge::Open));
        }
        match edge {
            Edge::Open(node) if node.is_element() => {
                depth += 1;
                start_tags += 1;
                if depth > MAX_XML_DEPTH {
                    return Err("Word document XML exceeds the nesting-depth budget.".into());
                }
                if start_tags > MAX_XML_START_TAGS {
                    return Err("Word document XML exceeds the element budget.".into());
                }
                if !word(node) {
                    continue;
                }
                match node.tag_name().name() {
                    "tbl" => table += 1,
                    "tr" if table == 1 => row = Some(Vec::new()),
                    "tc" if table == 1 && row.is_some() => cell = Some(Vec::new()),
                    "p" => {
                        paragraph = Some(Paragraph {
                            parts: String::new(),
                            style: String::new(),
                            list: false,
                        })
                    }
                    "del" | "moveFrom" => deleted += 1,
                    "t" => text_depth += 1,
                    "pStyle" => {
                        if let Some(p) = paragraph.as_mut() {
                            p.style = node
                                .attributes()
                                .find(|a| {
                                    a.name() == "val"
                                        && a.namespace()
                                            .is_some_and(|ns| WORDPROCESSING.contains(&ns))
                                })
                                .map(|a| a.value().to_owned())
                                .unwrap_or_default();
                        }
                    }
                    "numPr" => {
                        if let Some(p) = paragraph.as_mut() {
                            p.list = true;
                        }
                    }
                    name @ ("tab" | "br" | "cr") => {
                        if let Some(p) = paragraph.as_mut().filter(|_| deleted == 0) {
                            p.parts.push(if name == "tab" { '\t' } else { '\n' });
                        }
                    }
                    _ => {}
                }
            }
            Edge::Open(node) if node.is_text() => {
                let value = node.text().unwrap_or_default();
                if value.is_empty() || deleted > 0 || text_depth == 0 {
                    continue;
                }
                let Some(p) = paragraph.as_mut() else {
                    continue;
                };
                characters += value.encode_utf16().count();
                if characters > MAX_TEXT_CHARACTERS {
                    return Err("Word text exceeds the semantic diff character budget.".into());
                }
                p.parts.push_str(value);
            }
            Edge::Close(node) if node.is_element() => {
                depth = depth.saturating_sub(1);
                if !word(node) {
                    continue;
                }
                match node.tag_name().name() {
                    "t" => text_depth = text_depth.saturating_sub(1),
                    "p" => {
                        if let Some(p) = paragraph.take() {
                            let text = normalize_text(&p.parts);
                            if table > 0 && cell.is_some() {
                                if !text.is_empty()
                                    && let Some(c) = cell.as_mut()
                                {
                                    c.push(text);
                                }
                            } else if !text.is_empty() {
                                push(&mut blocks, paragraph_kind(&p.style, p.list), text)?;
                            }
                        }
                    }
                    "tc" if table == 1 => {
                        if let (Some(r), Some(c)) = (row.as_mut(), cell.take()) {
                            r.push(normalize_text(&c.join("\n")));
                        }
                    }
                    "tr" if table == 1 => {
                        if let Some(cells) = row.take() {
                            let text = cells.join(" | ").trim().to_owned();
                            if !text.is_empty() {
                                push(&mut blocks, BlockKind::TableRow, text)?;
                            }
                        }
                    }
                    "del" | "moveFrom" => deleted = deleted.saturating_sub(1),
                    "tbl" => table = table.saturating_sub(1),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    Ok(blocks)
}

/// `paragraphKind`: `Heading N` / `Title` styles, then numbering.
fn paragraph_kind(style: &str, list: bool) -> BlockKind {
    let lower = style.to_ascii_lowercase();
    let heading = lower
        .strip_prefix("heading")
        .is_some_and(|rest| rest.trim_start().chars().all(|c| c.is_ascii_digit()));
    if heading || lower == "title" {
        BlockKind::Heading
    } else if list {
        BlockKind::ListItem
    } else {
        BlockKind::Paragraph
    }
}

/// `normalizeBlockText`: line breaks unified, runs of spaces (not tabs)
/// collapsed, spaces around breaks dropped, the ends trimmed.
fn normalize_text(value: &str) -> String {
    let value = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(value.len());
    let mut spaces = false;
    for c in value.chars() {
        if matches!(c, ' ' | '\u{c}' | '\u{b}') {
            spaces = true;
            continue;
        }
        if spaces && c != '\n' && !out.ends_with('\n') {
            out.push(' ');
        }
        spaces = false;
        if c == '\n' {
            while out.ends_with(' ') {
                out.pop();
            }
        }
        out.push(c);
    }
    if spaces && !out.ends_with('\n') {
        out.push(' ');
    }
    out.trim().to_owned()
}

/// `alignDocxBlocks`.
pub fn align(before: &[Block], after: &[Block]) -> Vec<Change> {
    align_with(before, after, &Budget::unlimited())
        .expect("unlimited alignment cannot be interrupted")
}
fn align_with(
    before: &[Block],
    after: &[Block],
    budget: &Budget<'_>,
) -> Result<Vec<Change>, String> {
    budget.check()?;
    if before.is_empty() {
        return Ok(after.iter().enumerate().map(|(i, b)| added(b, i)).collect());
    }
    if after.is_empty() {
        return Ok(before
            .iter()
            .enumerate()
            .map(|(i, b)| deleted(b, i))
            .collect());
    }
    let mut changes = Vec::new();
    let (mut left, mut right) = (0, 0);
    for (b, a) in unique_anchors(before, after, budget)?
        .into_iter()
        .chain([(before.len(), after.len())])
    {
        budget.check()?;
        changes.extend(align_gap(before, after, left, b, right, a, budget)?);
        left = b + 1;
        right = a + 1;
    }
    Ok(changes)
}

/// `summarizeDocxChanges`.
pub fn summarize(changes: &[Change]) -> Stats {
    let mut stats = Stats::default();
    for change in changes {
        match change.kind {
            ChangeKind::Added => stats.blocks_added += 1,
            ChangeKind::Deleted => stats.blocks_deleted += 1,
            ChangeKind::Modified => stats.blocks_modified += 1,
        }
        for segment in &change.segments {
            match segment.kind {
                SegmentKind::Add => stats.words_added += count_words(&segment.text),
                SegmentKind::Remove => stats.words_deleted += count_words(&segment.text),
                SegmentKind::Equal => {}
            }
        }
    }
    stats.blocks_changed = stats.blocks_added + stats.blocks_deleted + stats.blocks_modified;
    stats
}

/// `findUniqueAnchors`: blocks that occur once on each side, kept in their
/// longest increasing run on the after side.
fn unique_anchors(
    before: &[Block],
    after: &[Block],
    budget: &Budget<'_>,
) -> Result<Vec<(usize, usize)>, String> {
    fn locations<'a>(
        blocks: &'a [Block],
        budget: &Budget<'_>,
    ) -> Result<HashMap<(BlockKind, &'a str), Vec<usize>>, String> {
        let mut map: HashMap<(BlockKind, &str), Vec<usize>> = HashMap::new();
        for (i, b) in blocks.iter().enumerate() {
            budget.check()?;
            map.entry((b.kind, b.text.as_str())).or_default().push(i);
        }
        Ok(map)
    }
    let (left, right) = (locations(before, budget)?, locations(after, budget)?);
    let mut candidates: Vec<(usize, usize)> = left
        .iter()
        .filter_map(
            |(key, at)| match (at.as_slice(), right.get(key).map(Vec::as_slice)) {
                ([b], Some([a])) => Some((*b, *a)),
                _ => None,
            },
        )
        .collect();
    candidates.sort_unstable();
    // Longest increasing subsequence on the after index.
    let mut tails: Vec<usize> = Vec::new();
    let mut tail_index: Vec<usize> = Vec::new();
    let mut previous = vec![usize::MAX; candidates.len()];
    for (index, &(_, value)) in candidates.iter().enumerate() {
        budget.check()?;
        let low = tails.partition_point(|&t| t < value);
        if low == tails.len() {
            tails.push(value);
            tail_index.push(index);
        } else {
            tails[low] = value;
            tail_index[low] = index;
        }
        previous[index] = if low > 0 {
            tail_index[low - 1]
        } else {
            usize::MAX
        };
    }
    let mut result = Vec::new();
    let mut cursor = tail_index.last().copied().unwrap_or(usize::MAX);
    while cursor != usize::MAX {
        result.push(candidates[cursor]);
        cursor = previous[cursor];
    }
    result.reverse();
    Ok(result)
}

/// `alignBlockGap`: a weighted edit distance between the blocks of one gap.
fn align_gap(
    before: &[Block],
    after: &[Block],
    before_start: usize,
    before_end: usize,
    after_start: usize,
    after_end: usize,
    budget: &Budget<'_>,
) -> Result<Vec<Change>, String> {
    budget.check()?;
    let left = &before[before_start..before_end];
    let right = &after[after_start..after_end];
    if left.is_empty() {
        return Ok(right
            .iter()
            .enumerate()
            .map(|(i, b)| added(b, after_start + i))
            .collect());
    }
    if right.is_empty() {
        return Ok(left
            .iter()
            .enumerate()
            .map(|(i, b)| deleted(b, before_start + i))
            .collect());
    }
    if left.len() * right.len() > MAX_ALIGNMENT_CELLS {
        return align_large_gap(left, right, before_start, after_start, budget);
    }
    let columns = right.len() + 1;
    let mut directions = vec![0u8; (left.len() + 1) * columns];
    let mut previous: Vec<f64> = (0..columns).map(|c| c as f64).collect();
    for row in 1..=left.len() {
        let mut current = vec![0f64; columns];
        current[0] = row as f64;
        for column in 1..columns {
            budget.check()?;
            let (l, r) = (&left[row - 1], &right[column - 1]);
            let similarity = similarity(l, r);
            let diagonal = if l.kind == r.kind && similarity >= 0.2 {
                previous[column - 1] + (1. - similarity) * 1.25
            } else {
                previous[column - 1] + 2.1
            };
            let delete = previous[column] + 1.;
            let add = current[column - 1] + 1.;
            let offset = row * columns + column;
            if diagonal <= delete && diagonal <= add {
                current[column] = diagonal;
                directions[offset] = 0;
            } else if delete <= add {
                current[column] = delete;
                directions[offset] = 1;
            } else {
                current[column] = add;
                directions[offset] = 2;
            }
        }
        previous = current;
    }
    let mut reversed = Vec::new();
    let (mut row, mut column) = (left.len(), right.len());
    while row > 0 || column > 0 {
        budget.check()?;
        let direction = if row == 0 {
            2
        } else if column == 0 {
            1
        } else {
            directions[row * columns + column]
        };
        match direction {
            0 => {
                let (b, a) = (&left[row - 1], &right[column - 1]);
                if b != a {
                    reversed.push(modified(
                        b,
                        a,
                        before_start + row - 1,
                        after_start + column - 1,
                        budget,
                    )?);
                }
                row -= 1;
                column -= 1;
            }
            1 => {
                reversed.push(deleted(&left[row - 1], before_start + row - 1));
                row -= 1;
            }
            _ => {
                reversed.push(added(&right[column - 1], after_start + column - 1));
                column -= 1;
            }
        }
    }
    reversed.reverse();
    Ok(reversed)
}

/// `alignLargeGap`: pairwise by position when the gap is too large.
fn align_large_gap(
    before: &[Block],
    after: &[Block],
    before_start: usize,
    after_start: usize,
    budget: &Budget<'_>,
) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    let paired = before.len().min(after.len());
    for i in 0..paired {
        budget.check()?;
        let (b, a) = (&before[i], &after[i]);
        if b.kind == a.kind && similarity(b, a) >= 0.35 {
            if b.text != a.text {
                changes.push(modified(b, a, before_start + i, after_start + i, budget)?);
            }
        } else {
            changes.push(deleted(b, before_start + i));
            changes.push(added(a, after_start + i));
        }
    }
    changes.extend(
        before[paired..]
            .iter()
            .enumerate()
            .map(|(i, b)| deleted(b, before_start + paired + i)),
    );
    changes.extend(
        after[paired..]
            .iter()
            .enumerate()
            .map(|(i, a)| added(a, after_start + paired + i)),
    );
    Ok(changes)
}

fn modified(
    before: &Block,
    after: &Block,
    b: usize,
    a: usize,
    budget: &Budget<'_>,
) -> Result<Change, String> {
    budget.check()?;
    Ok(Change {
        kind: ChangeKind::Modified,
        block: after.kind,
        before: Some(b),
        after: Some(a),
        segments: diff_words(&before.text, &after.text, budget)?,
    })
}
fn added(block: &Block, a: usize) -> Change {
    Change {
        kind: ChangeKind::Added,
        block: block.kind,
        before: None,
        after: Some(a),
        segments: vec![Segment {
            kind: SegmentKind::Add,
            text: block.text.clone(),
        }],
    }
}
fn deleted(block: &Block, b: usize) -> Change {
    Change {
        kind: ChangeKind::Deleted,
        block: block.kind,
        before: Some(b),
        after: None,
        segments: vec![Segment {
            kind: SegmentKind::Remove,
            text: block.text.clone(),
        }],
    }
}

/// `diffWords`: a longest-common-subsequence diff of word, space and
/// punctuation runs.
fn diff_words(before: &str, after: &str, budget: &Budget<'_>) -> Result<Vec<Segment>, String> {
    budget.check()?;
    let left = tokenize(before);
    let right = tokenize(after);
    if left.len() * right.len() > MAX_WORD_DIFF_CELLS {
        let mut whole = Vec::new();
        if !before.is_empty() {
            whole.push(Segment {
                kind: SegmentKind::Remove,
                text: before.to_owned(),
            });
        }
        if !after.is_empty() {
            whole.push(Segment {
                kind: SegmentKind::Add,
                text: after.to_owned(),
            });
        }
        return Ok(compact(whole));
    }
    let columns = right.len() + 1;
    let mut lengths = vec![0u32; (left.len() + 1) * columns];
    for row in 1..=left.len() {
        for column in 1..columns {
            budget.check()?;
            let offset = row * columns + column;
            lengths[offset] = if left[row - 1] == right[column - 1] {
                lengths[(row - 1) * columns + column - 1] + 1
            } else {
                lengths[(row - 1) * columns + column].max(lengths[row * columns + column - 1])
            };
        }
    }
    let mut reversed = Vec::new();
    let (mut row, mut column) = (left.len(), right.len());
    while row > 0 || column > 0 {
        budget.check()?;
        if row > 0 && column > 0 && left[row - 1] == right[column - 1] {
            reversed.push(Segment {
                kind: SegmentKind::Equal,
                text: left[row - 1].to_owned(),
            });
            row -= 1;
            column -= 1;
        } else if column > 0
            && (row == 0
                || lengths[row * columns + column - 1] >= lengths[(row - 1) * columns + column])
        {
            reversed.push(Segment {
                kind: SegmentKind::Add,
                text: right[column - 1].to_owned(),
            });
            column -= 1;
        } else {
            reversed.push(Segment {
                kind: SegmentKind::Remove,
                text: left[row - 1].to_owned(),
            });
            row -= 1;
        }
    }
    reversed.reverse();
    budget.check()?;
    Ok(compact(reversed))
}

fn compact(segments: Vec<Segment>) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    for segment in segments {
        match out.last_mut() {
            Some(last) if last.kind == segment.kind => last.text.push_str(&segment.text),
            _ => out.push(segment),
        }
    }
    out
}

/// `[\p{L}\p{N}_]`.
fn word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `tokenizeWords`: runs of whitespace, of word characters, or of anything
/// else.
fn tokenize(value: &str) -> Vec<&str> {
    let class = |c: char| {
        if c.is_whitespace() {
            0
        } else if word_char(c) {
            1
        } else {
            2
        }
    };
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut current = None;
    for (i, c) in value.char_indices() {
        let k = class(c);
        if current.is_some_and(|p| p != k) {
            tokens.push(&value[start..i]);
            start = i;
        }
        current = Some(k);
    }
    if start < value.len() {
        tokens.push(&value[start..]);
    }
    tokens
}

fn words(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(|c: char| !word_char(c))
        .filter(|w| !w.is_empty())
}

fn count_words(value: &str) -> usize {
    words(value).count()
}

/// `blockSimilarity`: the Dice coefficient of the blocks' word sets.
fn similarity(left: &Block, right: &Block) -> f64 {
    if left.kind != right.kind {
        return 0.;
    }
    if left.text == right.text {
        return 1.;
    }
    let set = |text: &str| -> std::collections::HashSet<String> {
        words(&text.to_lowercase()).map(str::to_owned).collect()
    };
    let (l, r) = (set(&left.text), set(&right.text));
    if l.is_empty() || r.is_empty() {
        return 0.;
    }
    let shared = l.intersection(&r).count();
    (2 * shared) as f64 / (l.len() + r.len()) as f64
}

/// A stored (uncompressed) ZIP package of `entries`, for tests.
#[cfg(any(test, feature = "test-support"))]
pub fn stored_package(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let crc = |data: &[u8]| {
        let mut crc = !0u32;
        for &byte in data {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xedb8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    };
    let (mut out, mut directory) = (Vec::new(), Vec::new());
    for (name, data) in entries {
        let offset = out.len() as u32;
        let (size, sum) = (data.len() as u32, crc(data));
        let header = |sig: &[u8], central: bool| {
            let mut h = sig.to_vec();
            if central {
                h.extend(20u16.to_le_bytes());
            }
            h.extend(20u16.to_le_bytes());
            h.extend([0u8; 6]); // flags, method (stored), time
            h.extend([0u8; 2]); // date
            h.extend(sum.to_le_bytes());
            h.extend(size.to_le_bytes());
            h.extend(size.to_le_bytes());
            h.extend((name.len() as u16).to_le_bytes());
            h.extend(0u16.to_le_bytes());
            if central {
                h.extend([0u8; 10]); // comment, disk, attributes
                h.extend(offset.to_le_bytes());
            }
            h.extend(name.as_bytes());
            h
        };
        out.extend(header(&[0x50, 0x4b, 0x03, 0x04], false));
        out.extend_from_slice(data);
        directory.extend(header(&[0x50, 0x4b, 0x01, 0x02], true));
    }
    let start = out.len() as u32;
    out.extend(&directory);
    out.extend([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    out.extend((entries.len() as u16).to_le_bytes());
    out.extend((entries.len() as u16).to_le_bytes());
    out.extend((directory.len() as u32).to_le_bytes());
    out.extend(start.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out
}

/// A Word package whose body is `body` (WordprocessingML), for tests.
#[cfg(any(test, feature = "test-support"))]
pub fn test_docx(body: &str) -> Vec<u8> {
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{}"><w:body>{body}</w:body></w:document>"#,
        WORDPROCESSING[0]
    );
    stored_package(&[
        ("[Content_Types].xml", b"<Types/>"),
        ("word/document.xml", xml.as_bytes()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn p(text: &str) -> String {
        format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>")
    }

    #[test]
    fn body_blocks_follow_wordprocessingml() {
        let body = format!(
            "{}<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Title  here</w:t></w:r></w:p>\
             <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>item</w:t><w:tab/><w:t>two</w:t></w:r></w:p>\
             <w:p><w:del><w:r><w:t>gone</w:t></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>\
             <w:tbl><w:tr><w:tc>{}</w:tc><w:tc>{}{}</w:tc></w:tr></w:tbl>{}",
            p("First"),
            p("A"),
            p("B"),
            p("C"),
            p(" ")
        );
        let blocks = parse(&test_docx(&body)).unwrap();
        let kinds: Vec<_> = blocks.iter().map(|b| (b.kind, b.text.as_str())).collect();
        assert_eq!(
            kinds,
            [
                (BlockKind::Paragraph, "First"),
                (BlockKind::Heading, "Title here"),
                (BlockKind::ListItem, "item\ttwo"),
                (BlockKind::Paragraph, "kept"),
                (BlockKind::TableRow, "A | B\nC"),
            ]
        );
    }

    #[test]
    fn packages_are_checked_before_they_are_read() {
        assert!(parse(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]).is_err());
        assert!(parse(b"not a zip").is_err());
        let empty = stored_package(&[("[Content_Types].xml", b"<Types/>")]);
        assert_eq!(
            parse(&empty).unwrap_err(),
            "The Word package does not contain word/document.xml."
        );
        let dtd = stored_package(&[("word/document.xml", b"<!DOCTYPE x><x/>")]);
        assert!(
            parse(&dtd)
                .unwrap_err()
                .contains("document type declaration")
        );
    }

    #[test]
    fn revisions_align_into_word_level_changes() {
        let before = test_docx(&[p("Intro"), p("The quick brown fox."), p("Old ending")].concat());
        let after = test_docx(
            &[
                p("Intro"),
                p("The quick red fox."),
                p("A new paragraph"),
                p("Old ending"),
            ]
            .concat(),
        );
        let model = build(Some(&before), Some(&after)).unwrap();
        assert_eq!(model.state, State::Ready);
        assert_eq!(model.changes.len(), 2);
        let changed = &model.changes[0];
        assert_eq!(
            (changed.kind, changed.before, changed.after),
            (ChangeKind::Modified, Some(1), Some(1))
        );
        let segments: Vec<_> = changed
            .segments
            .iter()
            .map(|s| (s.kind, s.text.as_str()))
            .collect();
        assert_eq!(
            segments,
            [
                (SegmentKind::Equal, "The quick "),
                (SegmentKind::Remove, "brown"),
                (SegmentKind::Add, "red"),
                (SegmentKind::Equal, " fox."),
            ]
        );
        assert_eq!(model.changes[1].kind, ChangeKind::Added);
        assert_eq!(
            model.stats,
            Stats {
                blocks_added: 1,
                blocks_deleted: 0,
                blocks_modified: 1,
                blocks_changed: 2,
                words_added: 4,
                words_deleted: 1,
            }
        );
        let same = build(Some(&before), Some(&before)).unwrap();
        assert_eq!((same.state, same.changes.len()), (State::Empty, 0));
        let new = build(None, Some(&after)).unwrap();
        assert_eq!((new.state, new.stats.blocks_added), (State::Added, 4));
        assert!(build(None, None).is_err());
    }

    #[test]
    fn spaces_collapse_but_tabs_stay() {
        assert_eq!(normalize_text("  a  b \n  c\t d \r\n"), "a b\nc\t d");
    }
}
