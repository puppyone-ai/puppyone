//! pulldown-cmark offset events → the parts of the Lezer Markdown tree the
//! product reads: semantic elements (markdownElements.ts), list items
//! (markdownListStructure.ts), paragraph / item / list boundaries
//! (markdownBlockRhythm.ts) and the classes `puppyMarkdownHighlightStyle`
//! assigns through Lezer's style tags (markdownCodeMirrorExtensions.ts).
//!
//! Lezer marks delimiters as child nodes (`EmphasisMark`, `LinkMark`, …);
//! pulldown-cmark reports container ranges only, so those children are
//! derived from the source here with the same extents.
use super::{
    BlockKind, Element, Hl, Kind, List, ListItem, Paragraph, Span, Syntax, TaskLine, autolink,
};
use crate::editor::text::buffer::Buffer;
use pulldown_cmark::{CodeBlockKind, Event, LinkType, Options, Parser, Tag, TagEnd};

/// A Lezer node that carries (or blocks) a highlight class.
struct HlNode {
    range: Span,
    own: Hl,
    /// `Node/...` style rules: descendants inherit the class.
    inherit: bool,
    children: Vec<HlNode>,
}

impl HlNode {
    fn new(range: Span, own: Hl, inherit: bool) -> Self {
        Self {
            range,
            own,
            inherit,
            children: Vec::new(),
        }
    }
    fn leaf(range: Span, own: Hl) -> Self {
        Self::new(range, own, false)
    }
}

enum Frame {
    Root,
    Heading,
    Quote,
    List {
        index: usize,
    },
    Item {
        index: usize,
        implicit: Option<usize>,
    },
    Paragraph {
        index: usize,
    },
    Emphasis,
    Strong,
    Strike,
    Link,
    Code,
    Table,
    TableHead,
    Other,
}

struct Walker<'a> {
    doc: &'a str,
    syntax: Syntax,
    stack: Vec<(Frame, HlNode)>,
}

/// `trimEnd`: container ranges end at their last content byte, as Lezer's do.
fn trim(doc: &str, range: Span) -> Span {
    let end = range.start
        + doc[range.clone()]
            .trim_end_matches(['\n', '\r', ' ', '\t'])
            .len();
    range.start..end.max(range.start)
}

/// CodeMirror `countColumn` with tab size 4.
fn columns(text: &str) -> usize {
    text.chars()
        .fold(0, |n, c| if c == '\t' { n + 4 - n % 4 } else { n + 1 })
}

fn line_start(doc: &str, offset: usize) -> usize {
    doc[..offset].rfind('\n').map_or(0, |i| i + 1)
}

fn line_end(doc: &str, offset: usize) -> usize {
    doc[offset..].find('\n').map_or(doc.len(), |i| offset + i)
}

/// Whitespace (spaces / tabs) from `at` to the end of its line.
fn blank_run(doc: &str, at: usize) -> usize {
    doc[at..]
        .bytes()
        .take_while(|&b| b == b' ' || b == b'\t')
        .count()
}

impl<'a> Walker<'a> {
    fn new(doc: &'a str) -> Self {
        Self {
            doc,
            syntax: Syntax::default(),
            stack: vec![(Frame::Root, HlNode::new(0..doc.len(), Hl::NONE, false))],
        }
    }

    fn push(&mut self, frame: Frame, node: HlNode) {
        self.stack.push((frame, node));
    }

    fn pop(&mut self) -> Frame {
        let (frame, node) = self.stack.pop().expect("balanced events");
        self.attach(node);
        frame
    }

    fn attach(&mut self, mut node: HlNode) {
        let parent = &mut self.stack.last_mut().expect("root").1;
        // Clamp to the parent: pulldown ranges may include a trailing break.
        node.range.start = node.range.start.max(parent.range.start);
        node.range.end = node.range.end.min(parent.range.end).max(node.range.start);
        parent.children.push(node);
    }

    fn quoted(&self) -> bool {
        self.stack.iter().any(|(f, _)| matches!(f, Frame::Quote))
    }

    /// Ancestor item indices, outermost first.
    fn items(&self) -> Vec<usize> {
        self.stack
            .iter()
            .filter_map(|(f, _)| {
                if let Frame::Item { index, .. } = f {
                    Some(*index)
                } else {
                    None
                }
            })
            .collect()
    }

    fn innermost_list(&self) -> Option<usize> {
        self.stack.iter().rev().find_map(|(f, _)| {
            if let Frame::List { index } = f {
                Some(*index)
            } else {
                None
            }
        })
    }

    fn in_code(&self) -> bool {
        matches!(self.stack.last(), Some((Frame::Code, _)))
    }

    fn in_link(&self) -> bool {
        self.stack.iter().any(|(f, _)| matches!(f, Frame::Link))
    }

    /// Inline content directly inside a tight list item belongs to an
    /// implicit paragraph (Lezer always has a Paragraph or Task node there).
    fn inline_content(&mut self, range: &Span) {
        let count = self.syntax.paragraphs.len();
        let item_quoted = self.quoted();
        let Some((Frame::Item { index, implicit }, _)) = self.stack.last_mut() else {
            return;
        };
        match implicit {
            Some(p) => {
                let p = *p;
                self.syntax.paragraphs[p].range.end =
                    self.syntax.paragraphs[p].range.end.max(range.end);
                let item = &mut self.syntax.items[*index];
                if let Some(block) = item
                    .blocks
                    .iter_mut()
                    .rev()
                    .find(|b| b.1.start == self.syntax.paragraphs[p].range.start)
                {
                    block.1.end = block.1.end.max(range.end);
                }
            }
            None => {
                *implicit = Some(count);
                let index = *index;
                self.syntax.paragraphs.push(Paragraph {
                    range: range.clone(),
                    item: Some(index),
                    item_quoted,
                    direct: true,
                    task: false,
                });
                self.syntax.items[index]
                    .blocks
                    .push((BlockKind::Paragraph, range.clone()));
            }
        }
    }

    fn end_implicit(&mut self) {
        if let Some((Frame::Item { implicit, .. }, _)) = self.stack.last_mut() {
            *implicit = None;
        }
    }

    fn start(&mut self, tag: Tag, range: Span) {
        let inline = matches!(
            tag,
            Tag::Emphasis
                | Tag::Strong
                | Tag::Strikethrough
                | Tag::Link { .. }
                | Tag::Image { .. }
                | Tag::Superscript
                | Tag::Subscript
        );
        if inline {
            self.inline_content(&range);
        } else {
            self.end_implicit();
        }
        let doc = self.doc;
        match tag {
            Tag::Paragraph => {
                let range = trim(doc, range);
                let items = self.items();
                let item_quoted = items.last().is_some_and(|&i| self.syntax.items[i].quoted);
                let direct = matches!(self.stack.last(), Some((Frame::Item { .. }, _)));
                let index = self.syntax.paragraphs.len();
                self.syntax.paragraphs.push(Paragraph {
                    range: range.clone(),
                    item: items.last().copied(),
                    item_quoted,
                    direct,
                    task: false,
                });
                if direct {
                    let item = *items.last().unwrap();
                    self.syntax.items[item]
                        .blocks
                        .push((BlockKind::Paragraph, range.clone()));
                }
                self.push(
                    Frame::Paragraph { index },
                    HlNode::new(range, Hl::NONE, false),
                );
            }
            Tag::Heading { .. } => {
                let range = trim(doc, range);
                let atx = doc[range.clone()].trim_start_matches(' ').starts_with('#');
                if matches!(self.stack.last(), Some((Frame::Item { .. }, _))) {
                    let item = *self.items().last().unwrap();
                    self.syntax.items[item]
                        .blocks
                        .push((BlockKind::Heading, range.clone()));
                }
                let marks = heading_marks(doc, &range, atx);
                if atx {
                    let line = line_start(doc, range.start)..line_end(doc, range.start);
                    if let Some(e) = heading_element(doc, marks[0].clone(), line) {
                        self.syntax.elements.push(e);
                    }
                }
                let mut node = HlNode::new(range.clone(), Hl::HEADING, true);
                for mark in marks {
                    node.children.push(HlNode::leaf(mark, Hl::MARKUP));
                }
                self.push(Frame::Heading, node);
            }
            Tag::BlockQuote(_) => {
                let range = trim(doc, range);
                let line = line_start(doc, range.start)..line_end(doc, range.start);
                if let Some(e) = blockquote_element(doc, range.clone(), line) {
                    self.syntax.elements.push(e);
                }
                let mut node = HlNode::new(range.clone(), Hl::QUOTE, true);
                // QuoteMark children: the `>` run starting each covered line.
                let mut at = range.start;
                while at < range.end {
                    let end = line_end(doc, at);
                    let text = &doc[at..end];
                    let lead = text.len() - text.trim_start_matches([' ', '\t']).len();
                    if text[lead..].starts_with('>') && at + lead >= range.start {
                        node.children
                            .push(HlNode::leaf(at + lead..at + lead + 1, Hl::MARKUP));
                    }
                    at = end + 1;
                }
                self.push(Frame::Quote, node);
            }
            Tag::List(first) => {
                let range = trim(doc, range);
                let index = self.syntax.lists.len();
                self.syntax.lists.push(List {
                    range: range.clone(),
                    ordered: first.is_some(),
                    items: Vec::new(),
                    parent: self.items().last().copied(),
                    quoted: self.quoted(),
                    columns: 0,
                });
                self.push(Frame::List { index }, HlNode::new(range, Hl::LIST, true));
            }
            Tag::Item => {
                let range = trim(doc, range);
                let index = self.syntax.items.len();
                let list = self.innermost_list().unwrap_or(0);
                let item = self.list_item(range.clone(), list);
                if let Some(l) = self.syntax.lists.get_mut(list) {
                    l.items.push(index);
                }
                let mut node = HlNode::new(range, Hl::NONE, false);
                node.children.push(HlNode::leaf(
                    item.marker_from..item.marker_from + item.marker.len(),
                    Hl::MARKUP,
                ));
                self.syntax.items.push(item);
                self.push(
                    Frame::Item {
                        index,
                        implicit: None,
                    },
                    node,
                );
            }
            Tag::Emphasis | Tag::Strong => {
                let strong = matches!(tag, Tag::Strong);
                let n = if strong { 2 } else { 1 };
                let mut node = HlNode::new(
                    range.clone(),
                    if strong { Hl::STRONG } else { Hl::EMPHASIS },
                    true,
                );
                if range.len() >= 2 * n {
                    let markers = vec![range.start..range.start + n, range.end - n..range.end];
                    for m in &markers {
                        node.children.push(HlNode::leaf(m.clone(), Hl::MARKUP));
                    }
                    let content = range.start + n..range.end - n;
                    let kind = if strong { Kind::Strong } else { Kind::Emphasis };
                    self.syntax
                        .elements
                        .push(Element::new(kind, range, markers, Some(content)));
                }
                self.push(
                    if strong {
                        Frame::Strong
                    } else {
                        Frame::Emphasis
                    },
                    node,
                );
            }
            Tag::Strikethrough => {
                // Lezer's GFM extension only knows `~~`; the element itself
                // comes from the product's line expression (lines.rs).
                let double = doc[range.clone()].starts_with("~~") && range.len() >= 4;
                let mut node = HlNode::new(
                    range.clone(),
                    if double { Hl::STRIKE } else { Hl::NONE },
                    true,
                );
                if double {
                    node.children
                        .push(HlNode::leaf(range.start..range.start + 2, Hl::MARKUP));
                    node.children
                        .push(HlNode::leaf(range.end - 2..range.end, Hl::MARKUP));
                }
                self.push(Frame::Strike, node);
            }
            Tag::Link { link_type, .. } | Tag::Image { link_type, .. } => {
                let image = matches!(tag, Tag::Image { .. });
                let autolink = matches!(link_type, LinkType::Autolink | LinkType::Email);
                let marks = if autolink {
                    vec![range.start..range.start + 1, range.end - 1..range.end]
                } else {
                    link_marks(doc, &range, image, link_type)
                };
                let mut node = HlNode::new(range.clone(), Hl::LINK, !autolink);
                for m in &marks {
                    node.children.push(HlNode::leaf(m.clone(), Hl::MARKUP));
                }
                if autolink && marks.len() == 2 {
                    node.children
                        .insert(1, HlNode::leaf(marks[0].end..marks[1].start, Hl::LINK));
                }
                if !image && marks.len() >= 2 {
                    let content = marks[0].end..marks[1].start.max(marks[0].end);
                    let mut e =
                        Element::new(Kind::Link, range.clone(), marks.clone(), Some(content));
                    e.href = autolink.then(|| doc[marks[0].end..marks[1].start].trim().to_owned());
                    self.syntax.elements.push(e);
                }
                self.push(Frame::Link, node);
            }
            Tag::CodeBlock(kind) => {
                let mut node = HlNode::new(range.clone(), Hl::NONE, false);
                match kind {
                    CodeBlockKind::Fenced(_) => {
                        for mark in fence_marks(doc, &range) {
                            node.children.push(mark);
                        }
                    }
                    CodeBlockKind::Indented => node
                        .children
                        .push(HlNode::leaf(trim(doc, range.clone()), Hl::MONOSPACE)),
                }
                self.push(Frame::Code, node);
            }
            Tag::Table(_) => {
                let range = trim(doc, range);
                self.syntax.tables.push(range.clone());
                let mut node = HlNode::new(range.clone(), Hl::NONE, false);
                // TableDelimiter: the delimiter row and every cell pipe.
                let mut at = range.start;
                let mut row = 0;
                while at < range.end {
                    let end = line_end(doc, at).min(range.end);
                    if row == 1 {
                        node.children.push(HlNode::leaf(at..end, Hl::MARKUP));
                    } else if row > 1 {
                        for (i, _) in doc[at..end].match_indices('|') {
                            if !super::super::links::is_escaped(doc.as_bytes(), at + i) {
                                node.children
                                    .push(HlNode::leaf(at + i..at + i + 1, Hl::MARKUP));
                            }
                        }
                    }
                    row += 1;
                    at = end + 1;
                }
                self.push(Frame::Table, node);
            }
            Tag::TableHead => {
                let range = trim(self.doc, range);
                let mut node = HlNode::new(range.clone(), Hl::HEADING, true);
                for (i, _) in doc[range.clone()].match_indices('|') {
                    node.children.push(HlNode::leaf(
                        range.start + i..range.start + i + 1,
                        Hl::MARKUP,
                    ));
                }
                self.push(Frame::TableHead, node);
            }
            _ => self.push(Frame::Other, HlNode::new(range, Hl::NONE, false)),
        }
    }

    fn end(&mut self, tag: TagEnd) {
        let block = !matches!(
            tag,
            TagEnd::Emphasis
                | TagEnd::Strong
                | TagEnd::Strikethrough
                | TagEnd::Link
                | TagEnd::Image
                | TagEnd::Superscript
                | TagEnd::Subscript
        );
        if block {
            self.end_implicit();
        }
        let frame = self.pop();
        match frame {
            Frame::List { index } => {
                let list = &self.syntax.lists[index];
                if list.ordered {
                    let widest = list
                        .items
                        .iter()
                        .map(|&i| self.syntax.items[i].marker.len())
                        .max()
                        .unwrap_or(0);
                    self.syntax.lists[index].columns = widest;
                }
            }
            Frame::Item { index, .. } => {
                if let Some(e) = list_element(self.doc, &self.syntax.items[index]) {
                    self.syntax.elements.push(e);
                }
            }
            _ => {}
        }
    }

    fn list_item(&self, range: Span, list: usize) -> ListItem {
        let doc = self.doc;
        let bytes = doc.as_bytes();
        let line_from = line_start(doc, range.start);
        let line_to = line_end(doc, range.start);
        // The marker: skip indentation (and quote markers of quoted items).
        let mut at = range.start;
        while at < line_to && matches!(bytes[at], b' ' | b'\t' | b'>') {
            at += 1;
        }
        let digits = bytes[at..line_to]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        let marker_len = if digits > 0 && matches!(bytes.get(at + digits), Some(b'.' | b')')) {
            digits + 1
        } else {
            1
        };
        let mark_to = (at + marker_len).min(line_to);
        let marker_to = mark_to + blank_run(doc, mark_to).min(line_to - mark_to);
        let parents = self.items();
        let quoted = self.quoted();
        let marker_end_column = columns(&doc[line_from..mark_to]);
        let after_column = columns(&doc[line_from..marker_to]);
        let padding = after_column - marker_end_column;
        ListItem {
            range,
            list,
            parents: parents.clone(),
            quoted,
            marker: doc[at..mark_to].to_owned(),
            marker_from: at,
            marker_to,
            content_from: marker_to,
            task: None,
            blocks: Vec::new(),
            indent_columns: columns(&doc[line_from..at]),
            content_column: marker_end_column
                + if (1..=4).contains(&padding) {
                    padding
                } else {
                    1
                },
        }
    }

    fn task_marker(&mut self, range: Span, checked: bool) {
        let doc = self.doc;
        let Some(&item_index) = self.items().last() else {
            return;
        };
        let depth = self.syntax.items[item_index].parents.len();
        let line_from = line_start(doc, range.start);
        let line_to = line_end(doc, range.start);
        let content_from = range.end + blank_run(doc, range.end).min(line_to - range.end);
        let item = &mut self.syntax.items[item_index];
        item.content_from = content_from;
        item.task = Some(TaskLine {
            line: line_from..line_to,
            depth,
            checked,
            checkbox: range.clone(),
            prefix_to: content_from,
        });
        // The paragraph holding the marker is a `Task` block, not a Paragraph.
        if let Some(first) = item.blocks.first_mut() {
            first.0 = BlockKind::Task;
            first.1.start = first.1.start.min(range.start);
        } else {
            item.blocks.push((BlockKind::Task, range.start..line_to));
        }
        let start = range.start;
        // The item's first direct paragraph (implicit or explicit).
        if let Some(p) = self
            .syntax
            .paragraphs
            .iter_mut()
            .find(|p| p.item == Some(item_index) && p.direct)
        {
            p.task = true;
            p.range.start = p.range.start.min(start);
        }
        // Task (style `tags.list`, not inherited) from the marker to the end
        // of its paragraph; the TaskMarker child carries no class.
        let mut node = HlNode::new(range.start..line_to, Hl::LIST, false);
        node.children.push(HlNode::leaf(range, Hl::NONE));
        self.attach(node);
    }

    fn text(&mut self, range: Span) {
        let doc = self.doc;
        // A backslash escape: pulldown-cmark drops the backslash, so the text
        // starts right after an uncovered `\` followed by punctuation.
        if !self.in_code()
            && range.start > 0
            && doc.as_bytes()[range.start - 1] == b'\\'
            && doc.as_bytes()[range.start].is_ascii_punctuation()
        {
            let b = range.start - 1;
            let e = Element::new(Kind::Escape, b..b + 2, vec![b..b + 1], Some(b + 1..b + 2));
            self.syntax.elements.push(e);
            self.attach(HlNode::leaf(b..b + 2, Hl::NONE));
        }
        if !self.in_code() && !self.in_link() {
            for r in autolink::find(&doc[range.clone()]) {
                self.attach(HlNode::leaf(
                    range.start + r.start..range.start + r.end,
                    Hl::LINK,
                ));
            }
        }
    }

    fn code(&mut self, range: Span) {
        let doc = self.doc;
        let ticks = doc[range.clone()]
            .bytes()
            .take_while(|&b| b == b'`')
            .count();
        let mut node = HlNode::new(range.clone(), Hl::MONOSPACE, false);
        if ticks > 0 && range.len() >= 2 * ticks {
            let markers = vec![
                range.start..range.start + ticks,
                range.end - ticks..range.end,
            ];
            for m in &markers {
                node.children.push(HlNode::leaf(m.clone(), Hl::MARKUP));
            }
            let content = range.start + ticks..range.end - ticks;
            self.syntax.elements.push(Element::new(
                Kind::InlineCode,
                range,
                markers,
                Some(content),
            ));
        }
        self.attach(node);
    }
}

fn heading_marks(doc: &str, range: &Span, atx: bool) -> Vec<Span> {
    let text = &doc[range.clone()];
    if !atx {
        // Setext: the underline is the HeaderMark.
        let last = text.rfind('\n').map_or(0, |i| i + 1);
        let underline = text[last..].trim();
        let at = range.start + last + text[last..].find(underline).unwrap_or(0);
        return vec![at..at + underline.len()];
    }
    let lead = text.len() - text.trim_start_matches(' ').len();
    let hashes = text[lead..].bytes().take_while(|&b| b == b'#').count();
    let mut marks = vec![range.start + lead..range.start + lead + hashes];
    // An optional closing sequence ` ###`.
    let body = text.trim_end();
    let closing = body.len() - body.trim_end_matches('#').len();
    if closing > 0
        && body.len() - closing > lead + hashes
        && body[..body.len() - closing].ends_with([' ', '\t'])
    {
        marks.push(range.start + body.len() - closing..range.start + body.len());
    }
    marks
}

/// createHeadingElement: the first HeaderMark plus one following space.
fn heading_element(doc: &str, mark: Span, line: Span) -> Option<Element> {
    if mark.is_empty() {
        return None;
    }
    let marker_to = if doc.as_bytes().get(mark.end) == Some(&b' ') {
        mark.end + 1
    } else {
        mark.end
    };
    let level = mark.len() as u8;
    let mut e = Element::new(
        Kind::Heading,
        mark.start..line.end,
        vec![mark.start..marker_to],
        Some(marker_to..line.end),
    );
    e.line = Some(line);
    e.level = level;
    Some(e)
}

/// createBlockquoteElement: one marker per `>` of `^(\s*)(>+)(\s?)`.
fn blockquote_element(doc: &str, range: Span, line: Span) -> Option<Element> {
    let text = &doc[line.clone()];
    let lead = text.len() - text.trim_start().len();
    let quotes = text[lead..].bytes().take_while(|&b| b == b'>').count();
    if quotes == 0 {
        return None;
    }
    let space = text[lead + quotes..]
        .chars()
        .next()
        .filter(|c| c.is_whitespace())
        .map_or(0, char::len_utf8);
    let markers: Vec<Span> = (0..quotes)
        .map(|i| {
            let from = line.start + lead + i;
            from..from + 1 + if i == quotes - 1 { space } else { 0 }
        })
        .collect();
    let marker_to = markers.iter().map(|m| m.end).max().unwrap_or(line.start);
    let mut e = Element::new(
        Kind::Blockquote,
        range.clone(),
        markers,
        Some(marker_to..range.end.max(marker_to)),
    );
    e.line = Some(line);
    Some(e)
}

/// createListElement: tasks own two markers (indent + list marker, checkbox).
fn list_element(doc: &str, item: &ListItem) -> Option<Element> {
    if item.quoted {
        return None;
    }
    let line = line_start(doc, item.marker_from)..line_end(doc, item.marker_from);
    let mut e = match &item.task {
        Some(task) => {
            let mut e = Element::new(
                Kind::Task,
                item.range.clone(),
                vec![
                    line.start..task.checkbox.start,
                    task.checkbox.start..task.prefix_to,
                ],
                Some(task.prefix_to..item.range.end.max(task.prefix_to)),
            );
            e.checked = task.checked;
            e
        }
        None => Element::new(
            Kind::List,
            item.range.clone(),
            vec![line.start..item.marker_to],
            Some(item.marker_to..item.range.end.max(item.marker_to)),
        ),
    };
    e.line = Some(line);
    Some(e)
}

/// LinkMark children of a link or image: `[` (or `![`), the label's `]`,
/// then `(` … `)` for inline links or the reference label's brackets.
fn link_marks(doc: &str, range: &Span, image: bool, link_type: LinkType) -> Vec<Span> {
    let bytes = doc.as_bytes();
    let open = range.start..range.start + if image { 2 } else { 1 };
    if open.end > range.end {
        return Vec::new();
    }
    // The matching `]`, skipping escapes and code spans.
    let mut depth = 0usize;
    let mut i = open.end;
    let mut close = None;
    while i < range.end {
        match bytes[i] {
            b'\\' => i += 1,
            b'`' => {
                let n = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let fence = &doc[i..i + n];
                if let Some(end) = doc[i + n..range.end].find(fence) {
                    i += n + end + n;
                    continue;
                }
                i += n - 1;
            }
            b'[' => depth += 1,
            b']' if depth == 0 => {
                close = Some(i);
                break;
            }
            b']' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    let Some(close) = close else {
        return vec![open];
    };
    let mut marks = vec![open, close..close + 1];
    match link_type {
        LinkType::Inline => {
            if bytes.get(close + 1) == Some(&b'(')
                && range.end > close + 2
                && bytes[range.end - 1] == b')'
            {
                marks.push(close + 1..close + 2);
                marks.push(range.end - 1..range.end);
            }
        }
        LinkType::Reference
        | LinkType::Collapsed
        | LinkType::ReferenceUnknown
        | LinkType::CollapsedUnknown => {
            if bytes.get(close + 1) == Some(&b'[') && bytes[range.end - 1] == b']' {
                marks.push(close + 1..close + 2);
                marks.push(range.end - 1..range.end);
            }
        }
        _ => {}
    }
    marks
}

/// Fenced code as Lezer sees it: CodeMark fences, CodeText body.
fn fence_marks(doc: &str, range: &Span) -> Vec<HlNode> {
    let mut out = Vec::new();
    let text = &doc[range.clone()];
    let mut at = range.start;
    let lines: Vec<&str> = text.split('\n').collect();
    let last = lines
        .iter()
        .rposition(|l| !l.trim().is_empty())
        .unwrap_or(0);
    for (k, line) in lines.iter().enumerate() {
        let lead = line.len() - line.trim_start().len();
        let fence = line[lead..]
            .bytes()
            .take_while(|&b| b == b'`' || b == b'~')
            .count();
        if (k == 0 || k == last) && fence >= 3 {
            out.push(HlNode::leaf(at + lead..at + lead + fence, Hl::MARKUP));
        } else if !line.is_empty() && k < last {
            out.push(HlNode::leaf(at..at + line.len(), Hl::MONOSPACE));
        }
        at += line.len() + 1;
    }
    out
}

/// Flatten the class tree like `highlightTree`: a node's text gets inherited
/// classes plus its own; only `/...` rules pass a class to descendants.
fn flatten(node: &HlNode, inherited: Hl, out: &mut Vec<(Span, Hl)>) {
    let cls = inherited | node.own;
    let pass = if node.inherit { cls } else { inherited };
    let emit = |range: Span, cls: Hl, out: &mut Vec<(Span, Hl)>| {
        if range.is_empty() || cls == Hl::NONE {
            return;
        }
        match out.last_mut() {
            Some((last, c)) if *c == cls && last.end == range.start => last.end = range.end,
            _ => out.push((range, cls)),
        }
    };
    let mut children: Vec<&HlNode> = node.children.iter().collect();
    children.sort_by_key(|c| (c.range.start, std::cmp::Reverse(c.range.end)));
    let mut pos = node.range.start;
    for child in children {
        if child.range.start < pos {
            continue; // Overlapping synthesized child; the first one wins.
        }
        emit(pos..child.range.start, cls, out);
        flatten(child, pass, out);
        pos = child.range.end;
    }
    emit(pos..node.range.end.max(pos), cls, out);
}

pub(super) fn walk(buffer: &Buffer) -> Syntax {
    let doc = buffer.as_str();
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut w = Walker::new(doc);
    for (event, range) in Parser::new_ext(doc, options).into_offset_iter() {
        match event {
            Event::Start(tag) => w.start(tag, range),
            Event::End(tag) => w.end(tag),
            Event::Text(_) => {
                w.inline_content(&range);
                w.text(range);
            }
            Event::Code(_) => {
                w.inline_content(&range);
                w.code(range);
            }
            Event::TaskListMarker(checked) => {
                w.inline_content(&range);
                w.task_marker(range, checked);
            }
            Event::Rule => {
                w.end_implicit();
                let range = trim(doc, range);
                let line = line_start(doc, range.start)..line_end(doc, range.start);
                let mut e = Element::new(Kind::Rule, range.clone(), vec![range.clone()], None);
                e.line = Some(line);
                w.syntax.elements.push(e);
                w.attach(HlNode::leaf(range, Hl::MARKUP));
            }
            Event::SoftBreak
            | Event::HardBreak
            | Event::InlineHtml(_)
            | Event::FootnoteReference(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_) => w.inline_content(&range),
            Event::Html(_) => w.end_implicit(),
        }
    }
    while w.stack.len() > 1 {
        w.pop();
    }
    let root = w.stack.pop().unwrap().1;
    let mut highlights = Vec::new();
    flatten(&root, Hl::NONE, &mut highlights);
    w.syntax.highlights = highlights;
    w.syntax
}
