//! Inline text, code, comment, and delimiter-mark extraction helpers for
//! `core/syntax/tree.rs` (CommonMark/GFM only; feature inline syntax lives in
//! `features/` per `MA-13`).
use super::{
    Element, Hl, Kind, Span, Syntax, autolink,
    tree::{Frame, HlNode, Walker, trim},
};
use pulldown_cmark::{LinkType, Tag};

impl Walker<'_> {
    pub(super) fn start_emphasis_or_strong(&mut self, strong: bool, range: Span) {
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

    pub(super) fn start_strikethrough(&mut self, range: Span) {
        let doc = self.doc;
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
        } else if range.len() >= 3
            && doc[range.clone()].starts_with('~')
            && doc[range.clone()].ends_with('~')
            && !doc[range.start + 1..range.end - 1]
                .chars()
                .any(char::is_whitespace)
        {
            let markers = vec![range.start..range.start + 1, range.end - 1..range.end];
            for m in &markers {
                node.children.push(HlNode::leaf(m.clone(), Hl::MARKUP));
            }
            self.syntax.elements.push(Element::new(
                Kind::Strike,
                range.clone(),
                markers,
                Some(range.start + 1..range.end - 1),
            ));
        }
        self.push(Frame::Strike, node);
    }

    pub(super) fn start_link_or_image(&mut self, tag: Tag, range: Span) {
        let doc = self.doc;
        let (image, link_type, dest_url, title) = match tag {
            Tag::Link {
                link_type,
                dest_url,
                ..
            } => (false, link_type, dest_url, None),
            Tag::Image {
                link_type,
                dest_url,
                title,
                ..
            } => (true, link_type, dest_url, Some(title)),
            _ => return,
        };
        let range = if link_type == LinkType::Collapsed
            && doc.as_bytes().get(range.end..range.end + 2) == Some(b"[]")
        {
            range.start..range.end + 2
        } else {
            range
        };
        let reference = matches!(
            link_type,
            LinkType::Reference | LinkType::Collapsed | LinkType::Shortcut
        )
        .then(|| dest_url.to_string());
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
            let mut e = Element::new(Kind::Link, range.clone(), marks.clone(), Some(content));
            e.href = autolink
                .then(|| doc[marks[0].end..marks[1].start].trim().to_owned())
                .or(reference);
            self.syntax.elements.push(e);
        }
        if let Some(title) = title
            && marks.len() >= 2
        {
            let content = marks[0].end..marks[1].start.max(marks[0].end);
            let mut e = Element::new(Kind::Image, range.clone(), marks.clone(), Some(content));
            e.href = Some(dest_url.to_string());
            e.text = (!title.is_empty()).then(|| title.to_string());
            self.syntax.elements.push(e);
        }
        self.push(Frame::Link, node);
    }

    pub(super) fn text(&mut self, range: Span, shown: &str) {
        let doc = self.doc;
        if !self.in_code() {
            let source = &doc[range.clone()];
            // pulldown-cmark reports a character reference as its own text.
            if source.len() > 2
                && source.starts_with('&')
                && source.ends_with(';')
                && shown != source
            {
                let mut e = Element::new(Kind::Entity, range.clone(), vec![range.clone()], None);
                e.text = Some(shown.to_owned());
                self.syntax.elements.push(e);
                return;
            }
        }
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
            let bare = self.bare_url_parent();
            for r in autolink::find(&doc[range.clone()]) {
                let r = range.start + r.start..range.start + r.end;
                self.attach(HlNode::leaf(r.clone(), Hl::LINK));
                if bare {
                    let mut e = Element::new(Kind::Link, r.clone(), vec![], Some(r.clone()));
                    e.href = Some(autolink::href(&doc[r]));
                    self.syntax.elements.push(e);
                }
            }
        }
    }

    /// `<!-- … -->` (Lezer `Comment` / `CommentBlock`): one element over the
    /// whole comment, however many events it arrives in.
    pub(super) fn html(&mut self, range: Span) {
        if range.start < self.comment_end {
            return;
        }
        let doc = self.doc;
        let source = doc[range.clone()].trim_start();
        if !source.starts_with("<!--") {
            return;
        }
        let start = range.end - doc[range.clone()].trim_start().len();
        let end = doc[start + 4..]
            .find("-->")
            .map_or(trim(doc, range.clone()).end, |i| start + 4 + i + 3);
        self.comment_end = end;
        self.syntax.elements.push(Element::new(
            Kind::Comment,
            start..end,
            vec![],
            Some(start..end),
        ));
    }

    pub(super) fn code(&mut self, range: Span) {
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

pub(super) fn heading_marks(doc: &str, range: &Span, atx: bool) -> Vec<Span> {
    let text = &doc[range.clone()];
    if !atx {
        let last = text.rfind('\n').map_or(0, |i| i + 1);
        let underline = text[last..].trim();
        let at = range.start + last + text[last..].find(underline).unwrap_or(0);
        return vec![at..at + underline.len()];
    }
    let lead = text.len() - text.trim_start_matches(' ').len();
    let hashes = text[lead..].bytes().take_while(|&b| b == b'#').count();
    let mut marks = vec![range.start + lead..range.start + lead + hashes];
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
pub(super) fn heading_element(doc: &str, mark: Span, line: Span) -> Option<Element> {
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
pub(super) fn blockquote_element(doc: &str, range: Span, line: Span) -> Option<Element> {
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

/// LinkMark children of a link or image: `[` (or `![`), the label's `]`,
/// then `(` … `)` for inline links or the reference label's brackets.
pub(super) fn link_marks(doc: &str, range: &Span, image: bool, link_type: LinkType) -> Vec<Span> {
    let bytes = doc.as_bytes();
    let open = range.start..range.start + if image { 2 } else { 1 };
    if open.end > range.end {
        return Vec::new();
    }
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
        LinkType::Inline
            if bytes.get(close + 1) == Some(&b'(')
                && range.end > close + 2
                && bytes[range.end - 1] == b')' =>
        {
            marks.push(close + 1..close + 2);
            marks.push(range.end - 1..range.end);
        }
        LinkType::Reference
        | LinkType::Collapsed
        | LinkType::ReferenceUnknown
        | LinkType::CollapsedUnknown
            if bytes.get(close + 1) == Some(&b'[') && bytes[range.end - 1] == b']' =>
        {
            marks.push(close + 1..close + 2);
            marks.push(range.end - 1..range.end);
        }
        _ => {}
    }
    marks
}

/// Fenced code as Lezer sees it: CodeMark fences, CodeText body.
pub(super) fn fence_marks(doc: &str, range: &Span) -> Vec<HlNode> {
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
pub(super) fn flatten(node: &HlNode, inherited: Hl, out: &mut Vec<(Span, Hl)>) {
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
            continue;
        }
        emit(pos..child.range.start, cls, out);
        flatten(child, pass, out);
        pos = child.range.end;
    }
    emit(pos..node.range.end.max(pos), cls, out);
}

fn shift_span(span: &mut Span, delta: usize) {
    span.start += delta;
    span.end += delta;
}

pub(super) fn shift_syntax_base(syntax: &mut Syntax, base: usize) {
    if base == 0 {
        return;
    }
    for e in &mut syntax.elements {
        shift_span(&mut e.range, base);
        for m in &mut e.markers {
            shift_span(m, base);
        }
        if let Some(c) = &mut e.content {
            shift_span(c, base);
        }
        if let Some(l) = &mut e.line {
            shift_span(l, base);
        }
    }
    for item in &mut syntax.items {
        shift_span(&mut item.range, base);
        item.marker_from += base;
        item.marker_to += base;
        item.content_from += base;
        if let Some(task) = &mut item.task {
            shift_span(&mut task.line, base);
            shift_span(&mut task.checkbox, base);
            task.prefix_to += base;
        }
        for (_, r) in &mut item.blocks {
            shift_span(r, base);
        }
    }
    for list in &mut syntax.lists {
        shift_span(&mut list.range, base);
    }
    for p in &mut syntax.paragraphs {
        shift_span(&mut p.range, base);
    }
    for (r, _) in &mut syntax.highlights {
        shift_span(r, base);
    }
    for vec in [
        &mut syntax.code_blocks,
        &mut syntax.tables,
        &mut syntax.table_cells,
        &mut syntax.inline_tags,
        &mut syntax.html_blocks,
        &mut syntax.top_blocks,
    ] {
        for r in vec {
            shift_span(r, base);
        }
    }
    for n in &mut syntax.note_definitions {
        *n += base;
    }
}
