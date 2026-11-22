//! pulldown-cmark offset events → the parts of the Lezer Markdown tree the
//! product reads: semantic elements (`markdownElements.ts`), list items
//! (`markdownListStructure.ts`), paragraph / item / list boundaries
//! (`markdownBlockRhythm.ts`), and `puppyMarkdownHighlightStyle` classes.
//!
//! Table, list, and inline helpers are split into `tree_table.rs`,
//! `tree_list.rs`, and `tree_inline.rs`.
use super::{
    BlockKind, Element, Hl, Kind, List, Paragraph, Span, Syntax, autolink,
    tree_inline::{
        blockquote_element, fence_marks, flatten, heading_element, heading_marks, shift_syntax_base,
    },
    tree_list::list_element,
};
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

/// A Lezer node that carries (or blocks) a highlight class.
pub(super) struct HlNode {
    pub(super) range: Span,
    pub(super) own: Hl,
    /// `Node/...` style rules: descendants inherit the class.
    pub(super) inherit: bool,
    pub(super) children: Vec<HlNode>,
}

impl HlNode {
    pub(super) fn new(range: Span, own: Hl, inherit: bool) -> Self {
        Self {
            range,
            own,
            inherit,
            children: Vec::new(),
        }
    }

    pub(super) fn leaf(range: Span, own: Hl) -> Self {
        Self::new(range, own, false)
    }
}

pub(super) enum Frame {
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
    Paragraph,
    Emphasis,
    Strong,
    Strike,
    Link,
    Code,
    Table,
    TableHead,
    Other,
}

pub(super) struct Walker<'a> {
    pub(super) doc: &'a str,
    pub(super) syntax: Syntax,
    pub(super) stack: Vec<(Frame, HlNode)>,
    /// The end of the HTML comment being read (its later events are inside).
    pub(super) comment_end: usize,
}

/// `trimEnd`: container ranges end at their last content byte, as Lezer's do.
pub(super) fn trim(doc: &str, range: Span) -> Span {
    let end = range.start
        + doc[range.clone()]
            .trim_end_matches(['\n', '\r', ' ', '\t'])
            .len();
    range.start..end.max(range.start)
}

/// CodeMirror `countColumn` with tab size 4.
pub(super) fn columns(text: &str) -> usize {
    text.chars()
        .fold(0, |n, c| if c == '\t' { n + 4 - n % 4 } else { n + 1 })
}

pub(super) fn line_start(doc: &str, offset: usize) -> usize {
    doc[..offset].rfind('\n').map_or(0, |i| i + 1)
}

pub(super) fn line_end(doc: &str, offset: usize) -> usize {
    doc[offset..].find('\n').map_or(doc.len(), |i| offset + i)
}

/// Whitespace (spaces / tabs) from `at` to the end of its line.
pub(super) fn blank_run(doc: &str, at: usize) -> usize {
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
            comment_end: 0,
        }
    }

    pub(super) fn push(&mut self, frame: Frame, node: HlNode) {
        self.stack.push((frame, node));
    }

    fn pop(&mut self) -> Frame {
        let (frame, node) = self.stack.pop().expect("balanced events");
        self.attach(node);
        frame
    }

    pub(super) fn attach(&mut self, mut node: HlNode) {
        let parent = &mut self.stack.last_mut().expect("root").1;
        node.range.start = node.range.start.max(parent.range.start);
        node.range.end = node.range.end.min(parent.range.end).max(node.range.start);
        parent.children.push(node);
    }

    pub(super) fn quoted(&self) -> bool {
        self.stack.iter().any(|(f, _)| matches!(f, Frame::Quote))
    }

    /// Ancestor item indices, outermost first.
    pub(super) fn items(&self) -> Vec<usize> {
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

    pub(super) fn in_code(&self) -> bool {
        matches!(self.stack.last(), Some((Frame::Code, _)))
    }

    pub(super) fn in_link(&self) -> bool {
        self.stack.iter().any(|(f, _)| matches!(f, Frame::Link))
    }

    /// A bare URL is a link only as direct inline content of a paragraph or
    /// heading (`BARE_URL_PARENTS`).
    pub(super) fn bare_url_parent(&self) -> bool {
        matches!(
            self.stack.last(),
            Some((Frame::Paragraph | Frame::Heading, _))
                | Some((
                    Frame::Item {
                        implicit: Some(_),
                        ..
                    },
                    _
                ))
        )
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
            if self.stack.len() == 1 {
                self.syntax.top_blocks.push(trim(self.doc, range.clone()));
            }
        }
        let doc = self.doc;
        match tag {
            Tag::Paragraph => {
                let range = trim(doc, range);
                let items = self.items();
                let item_quoted = items.last().is_some_and(|&i| self.syntax.items[i].quoted);
                let direct = matches!(self.stack.last(), Some((Frame::Item { .. }, _)));
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
                self.push(Frame::Paragraph, HlNode::new(range, Hl::NONE, false));
            }
            Tag::Heading { level, .. } => {
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
                } else {
                    let text_slice = &doc[range.clone()];
                    let title_len = text_slice.rfind('\n').map_or(text_slice.len(), |i| {
                        text_slice[..i].trim_end_matches('\r').len()
                    });
                    let mut e = Element::new(
                        Kind::Heading,
                        range.clone(),
                        Vec::new(),
                        Some(range.start..range.start + title_len),
                    );
                    e.level = level as u8;
                    self.syntax.elements.push(e);
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
                self.start_emphasis_or_strong(matches!(tag, Tag::Strong), range)
            }
            Tag::Strikethrough => self.start_strikethrough(range),
            Tag::Link { .. } | Tag::Image { .. } => self.start_link_or_image(tag, range),
            Tag::CodeBlock(kind) => {
                self.syntax.code_blocks.push(trim(doc, range.clone()));
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
            Tag::Table(_) => self.start_table(range),
            Tag::TableHead => self.start_table_head(range),
            Tag::TableCell => self.start_table_cell(range),
            Tag::HtmlBlock => {
                if self.stack.len() == 1 {
                    self.syntax.html_blocks.push(trim(self.doc, range.clone()));
                }
                self.push(Frame::Other, HlNode::new(range, Hl::NONE, false));
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
}

/// Parse a slice `doc_slice` starting at byte `base` in the document, supplying
/// `extra_link_defs` so reference links resolve identically to a full parse (`TA-31`).
pub(super) fn walk_slice(
    doc_slice: &str,
    base: usize,
    extra_link_defs: &str,
) -> (Syntax, Vec<(Span, String)>) {
    let slice_len = doc_slice.len();
    let combined_storage: String;
    let parse_input: &str = if extra_link_defs.is_empty() {
        doc_slice
    } else {
        combined_storage = format!("{doc_slice}\n\n{extra_link_defs}");
        &combined_storage
    };

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut w = Walker::new(doc_slice);
    let mut events = Parser::new_ext(parse_input, options).into_offset_iter();
    for (event, range) in &mut events {
        if range.start >= slice_len {
            continue;
        }
        let range = range.start..range.end.min(slice_len);
        match event {
            Event::Start(tag) => w.start(tag, range),
            Event::End(tag) => w.end(tag),
            Event::Text(text) => {
                w.inline_content(&range);
                w.text(range, &text);
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
                let range = trim(doc_slice, range);
                if w.stack.len() == 1 {
                    w.syntax.top_blocks.push(range.clone());
                }
                let line = line_start(doc_slice, range.start)..line_end(doc_slice, range.start);
                let mut e = Element::new(Kind::Rule, range.clone(), vec![range.clone()], None);
                e.line = Some(line);
                w.syntax.elements.push(e);
                w.attach(HlNode::leaf(range, Hl::MARKUP));
            }
            Event::InlineHtml(_) => {
                w.inline_content(&range);
                if !w.in_code() {
                    w.syntax.inline_tags.push(range.clone());
                }
                w.html(range);
            }
            Event::HardBreak => {
                w.inline_content(&range);
                if doc_slice.as_bytes().get(range.start) == Some(&b'\\') {
                    w.syntax.elements.push(Element::new(
                        Kind::Escape,
                        range.clone(),
                        vec![range.start..range.start + 1],
                        Some(range.start + 1..range.end),
                    ));
                }
            }
            Event::SoftBreak
            | Event::FootnoteReference(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_) => w.inline_content(&range),
            Event::Html(_) => {
                w.end_implicit();
                w.html(range);
            }
        }
    }
    let mut link_defs = Vec::new();
    for (_, definition) in events.reference_definitions().iter() {
        let span = definition.span.clone();
        if span.end > slice_len {
            continue;
        }
        let source = &doc_slice[span.clone()];
        let Some(open) = source.find('[') else {
            continue;
        };
        let Some(close) = source[open..].find("]:").map(|i| open + i) else {
            continue;
        };
        if source[open + 1..].starts_with('^') {
            w.syntax.note_definitions.push(span.start + open);
            continue;
        }
        link_defs.push((base + span.start..base + span.end, source.to_owned()));
        let tail = &source[close + 2..];
        if let Some(url) = autolink::find(tail).into_iter().next()
            && matches!(tail[..url.start].trim(), "" | "<")
        {
            let range = span.start + close + 2 + url.start..span.start + close + 2 + url.end;
            let mut link = Element::new(Kind::Link, range.clone(), vec![], Some(range));
            link.href = Some(autolink::href(&tail[url]));
            w.syntax.elements.push(link);
        }
        let (open, close) = (span.start + open, span.start + close);
        w.syntax.elements.push(Element::new(
            Kind::LinkDefinition,
            open..close + 2,
            vec![open..open + 1, close..close + 2],
            Some(open + 1..close),
        ));
    }
    link_defs.sort_by_key(|(r, _)| (r.start, r.end));
    while w.stack.len() > 1 {
        w.pop();
    }
    let root = w.stack.pop().unwrap().1;
    let mut highlights = Vec::new();
    flatten(&root, Hl::NONE, &mut highlights);
    w.syntax.highlights = highlights;
    shift_syntax_base(&mut w.syntax, base);
    (w.syntax, link_defs)
}
