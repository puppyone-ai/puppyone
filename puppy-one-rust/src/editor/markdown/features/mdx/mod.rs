//! MDX components (product features/mdx-component), in `.mdx` documents
//! only (the Open Knowledge MDX dialect): a block opened by a capitalised
//! tag runs to the tag that closes it, across blank lines and around fenced
//! code. `<Tabs>` with only `<Tab label="…">` children shows as tabs, each
//! tab's Markdown rendered; any other component, props, expressions or a
//! malformed block stay source.
mod widget;

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan, Presentation},
            state::{FeatureStateValue, PreviewState},
        },
        shared::fence::{fence_closes, fence_open},
    },
    text::{
        anchor::Anchor,
        buffer::Buffer,
        change::ChangeSet,
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};
use widget::TabsWidget;

pub struct MdxFeature;
pub static FEATURE: MdxFeature = MdxFeature;
pub const ID: &str = "mdx-component";

const MAX_NESTING: usize = 64;
const MAX_TABS: usize = 64;
const MAX_LABEL: usize = 200;
/// `HTML_RICH_BYTES` / `_NODES` / `_DEPTH` (normal profile): beyond them
/// the block stays source.
const RICH_BYTES: usize = 48 * 1024;
const RICH_NODES: usize = 800;
const RICH_DEPTH: usize = 48;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Token {
    from: usize,
    to: usize,
    name: String,
    closing: bool,
    self_closing: bool,
    attributes: String,
}

/// `parseMdxComponentTagTokenAt`: a capitalised tag at `start`, its
/// attributes kept whole (quotes and braces balanced).
fn tag_at(s: &str, start: usize) -> Option<Token> {
    let b = s.as_bytes();
    if b.get(start) != Some(&b'<') {
        return None;
    }
    let mut i = start + 1;
    let closing = b.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let name_from = i;
    if !b.get(i)?.is_ascii_uppercase() {
        return None;
    }
    i += 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'.' | b'-')) {
        i += 1;
    }
    let name = s[name_from..i].to_owned();
    let (mut quote, mut braces) = (None, 0usize);
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b'{' => braces += 1,
            None if c == b'}' && braces > 0 => braces -= 1,
            None if c == b'>' && braces == 0 => break,
            None => {}
        }
        i += 1;
    }
    if i >= b.len() || quote.is_some() || braces != 0 {
        return None;
    }
    let before = &s[name_from + name.len()..i];
    let trimmed = before.trim_end();
    let self_closing = !closing && trimmed.ends_with('/');
    let attributes = if self_closing {
        trimmed[..trimmed.len() - 1].to_owned()
    } else {
        before.to_owned()
    };
    if closing && !attributes.trim().is_empty() {
        return None;
    }
    Some(Token {
        from: start,
        to: i + 1,
        name,
        closing,
        self_closing,
        attributes,
    })
}

/// `scanMdxComponentTagTokens`: the component tags of `s` (offsets from
/// `base`), skipping fenced code.
fn scan(s: &str, base: usize) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut open: Option<(u8, usize)> = None;
    let mut line_start = 0;
    for line in s.split_inclusive('\n') {
        if let Some((c, n)) = open {
            if fence_closes(line, c, n) {
                open = None;
            }
        } else if let Some(f) = fence_open(line) {
            open = Some(f);
        } else {
            let mut i = 0;
            while let Some(at) = line[i..].find('<') {
                let at = line_start + i + at;
                match tag_at(s, at) {
                    Some(mut t) => {
                        i = t.to - line_start;
                        t.from += base;
                        t.to += base;
                        tokens.push(t);
                        if i >= line.len() {
                            break;
                        }
                    }
                    None => i = at - line_start + 1,
                }
            }
        }
        line_start += line.len();
    }
    tokens
}

/// `parseMdxComponentBlock`: the component blocks of the document — from a
/// line opening a component to the line where it closes (or the end).
fn blocks(doc: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut fenced: Option<(u8, usize)> = None;
    let mut at = 0;
    while at < doc.len() {
        let end = doc[at..].find('\n').map_or(doc.len(), |n| at + n + 1);
        let line = &doc[at..end];
        if let Some((c, n)) = fenced {
            if fence_closes(line, c, n) {
                fenced = None;
            }
        } else if let Some(f) = fence_open(line) {
            fenced = Some(f);
        } else {
            let indent = line.len() - line.trim_start_matches(' ').len();
            if indent <= 3 && tag_at(doc, at + indent).is_some_and(|t| !t.closing) {
                let block = close(doc, at + indent);
                out.push(block.clone());
                at = block.end;
                continue;
            }
        }
        at = end;
    }
    out
}

/// Where the component opened at `from` closes: the end of that line.
fn close(doc: &str, from: usize) -> Range<usize> {
    let mut stack: Vec<String> = Vec::new();
    let mut fenced: Option<(u8, usize)> = None;
    let mut at = from;
    let mut first = true;
    while at < doc.len() {
        let end = doc[at..].find('\n').map_or(doc.len(), |n| at + n + 1);
        let line = &doc[at..end];
        let is_first = first;
        first = false;
        if !is_first && let Some((c, n)) = fenced {
            if fence_closes(line, c, n) {
                fenced = None;
            }
        } else if !is_first && let Some(f) = fence_open(line) {
            fenced = Some(f);
        } else if fenced.is_none() {
            for t in scan(line, at) {
                if t.closing {
                    if stack.last() == Some(&t.name) {
                        stack.pop();
                    }
                } else if !t.self_closing {
                    stack.push(t.name);
                }
                if stack.is_empty() {
                    return from..end.min(doc.len()).max(from);
                }
            }
        }
        at = end;
    }
    from..doc.len()
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct Tab {
    pub label: String,
    pub content: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct TabsBlock {
    /// Whole source lines.
    pub range: Range<usize>,
    pub tabs: Vec<Tab>,
}

/// `parseLiteralAttributes`: only quoted literal props, no expressions,
/// spreads or repeats.
fn literal_attributes(s: &str) -> Option<Vec<(String, String)>> {
    let b = s.as_bytes();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() {
            return Some(out);
        }
        if b[i] == b'{' || s[i..].starts_with("...") {
            return None;
        }
        let name_from = i;
        if !(b[i].is_ascii_alphabetic() || matches!(b[i], b'_' | b':')) {
            return None;
        }
        while i < b.len()
            && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'.' | b':' | b'-'))
        {
            i += 1;
        }
        let name = &s[name_from..i];
        if out.iter().any(|(n, _)| n == name) {
            return None;
        }
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if b.get(i) != Some(&b'=') {
            return None;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let quote = *b.get(i)?;
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        let value_from = i + 1;
        let value_to = value_from + s[value_from..].find(quote as char)?;
        out.push((name.to_owned(), s[value_from..value_to].to_owned()));
        i = value_to + 1;
    }
}

/// `parseMarkdownMdxComponent` for a `Tabs` block: its tabs, if complete,
/// supported and within the render budget.
fn tabs(source: &str) -> Option<Vec<Tab>> {
    let tokens = scan(source, 0);
    let (root, last) = (tokens.first()?, tokens.last()?);
    if root.closing
        || root.self_closing
        || tokens.len() < 2
        || root.from != 0
        || root.name != "Tabs"
    {
        return None;
    }
    // `validateBalancedTokens`.
    let mut stack: Vec<&str> = Vec::new();
    let mut depth = 0;
    for (idx, t) in tokens.iter().enumerate() {
        if t.closing {
            if stack.pop() != Some(t.name.as_str()) {
                return None;
            }
            if stack.is_empty() && idx + 1 != tokens.len() {
                return None;
            }
        } else if !t.self_closing {
            stack.push(&t.name);
            depth = depth.max(stack.len());
            if stack.len() > MAX_NESTING {
                return None;
            }
        }
    }
    if !stack.is_empty() || !source[last.to..].trim().is_empty() {
        return None;
    }
    if literal_attributes(&root.attributes).is_none_or(|a| !a.is_empty()) {
        return None;
    }
    let mut tabs = Vec::new();
    let mut stack: Vec<&Token> = vec![root];
    let mut direct = root.to;
    let mut active: Option<(&Token, String)> = None;
    for t in &tokens[1..tokens.len() - 1] {
        if t.closing {
            let opening = stack.pop()?;
            if opening.name != t.name {
                return None;
            }
            if opening.name == "Tab"
                && stack.len() == 1
                && let Some((open, label)) = active.take()
            {
                tabs.push(Tab {
                    label,
                    content: source[open.to..t.from].to_owned(),
                });
                direct = t.to;
            }
            continue;
        }
        if stack.len() == 1 {
            if !source[direct..t.from].trim().is_empty()
                || t.name != "Tab"
                || t.self_closing
                || tabs.len() >= MAX_TABS
            {
                return None;
            }
            let attributes = literal_attributes(&t.attributes)?;
            let label = match attributes.as_slice() {
                [(name, label)] if name == "label" && !label.is_empty() => label.clone(),
                _ => return None,
            };
            if label.chars().count() > MAX_LABEL {
                return None;
            }
            active = Some((t, label));
        }
        if !t.self_closing {
            stack.push(t);
        }
    }
    if !source[direct..last.from].trim().is_empty() || tabs.is_empty() {
        return None;
    }
    // `decideMarkdownBlockExecution("mdxComponent")`.
    let nodes = tokens.len() * 2 + tabs.len() * 3;
    (source.len() <= RICH_BYTES && nodes <= RICH_NODES && depth <= RICH_DEPTH).then_some(tabs)
}

/// The widget's commands: a tab shows; the toolbar reveals the source.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub enum Action {
    Select { at: usize, tab: usize },
    ShowSource(Range<usize>),
}

/// Per-feature MDX active-tab state (`TA-40`), tracked via [`Anchor::after`]
/// so editing above `<Tabs>` (and undoing/redoing via `TA-06`) preserves the
/// selected tab instead of resetting to tab 0.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct TabsState(Vec<(Anchor, usize)>);

impl FeatureStateValue for TabsState {
    fn map_changes(&mut self, changes: &ChangeSet, _doc: &Buffer, new_revision: u64) {
        for (anchor, _) in &mut self.0 {
            anchor.map(changes, new_revision);
        }
    }
}

impl TabsState {
    pub fn get(&self, at: usize) -> usize {
        self.0
            .iter()
            .find(|(a, _)| a.offset == at)
            .map(|(_, tab)| *tab)
            .unwrap_or(0)
    }

    pub fn set(&mut self, at: usize, tab: usize, revision: u64) {
        self.0.retain(|(a, _)| a.offset != at);
        self.0.push((Anchor::after(at, revision), tab));
    }
}

impl MarkdownFeature for MdxFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn scan_block_delimiters(
        &self,
        doc: &Buffer,
        line_window: Range<usize>,
        code_lines: &[Range<usize>],
        out: &mut Vec<usize>,
    ) {
        let mut code_idx = code_lines.partition_point(|r| r.end <= line_window.start);
        let end = line_window.end.min(doc.line_count());
        for line in line_window.start..end {
            while code_idx < code_lines.len() && code_lines[code_idx].end <= line {
                code_idx += 1;
            }
            if code_idx < code_lines.len() && code_lines[code_idx].contains(&line) {
                continue;
            }
            let text = doc.line_cow(line);
            if !text.contains('<') {
                continue;
            }
            let base = doc.line_range(line).start;
            let bytes = text.as_bytes();
            for i in 0..bytes.len() {
                if bytes[i] == b'<' {
                    let next = bytes.get(i + 1).copied();
                    let is_cap_tag = next.is_some_and(|b| b.is_ascii_uppercase())
                        || (next == Some(b'/')
                            && bytes.get(i + 2).is_some_and(|b| b.is_ascii_uppercase()));
                    if is_cap_tag {
                        out.push(base + i);
                    }
                }
            }
        }
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        let (Some(first), Some(last)) = (cx.syntax.top_blocks.first(), cx.syntax.top_blocks.last())
        else {
            return;
        };
        let base = cx.doc.line_range(cx.doc.line_index(first.start)).start;
        let limit = cx
            .doc
            .line_range(cx.doc.line_index(last.end.min(cx.doc.len())))
            .end;
        let slice_cow = cx.doc.slice_cow(base..limit);
        let slice = slice_cow.as_ref();
        for rel_block in blocks(slice) {
            let abs_start = base + rel_block.start;
            let abs_end = (base + rel_block.end).min(limit);
            let line = cx.doc.line_range(cx.doc.line_index(abs_start)).start;
            let source = slice[rel_block.start..abs_end - base].trim_end_matches(['\n', '\r']);
            let range = line..abs_start + source.len();
            let presentation = match tabs(source) {
                Some(tabs) => Presentation::BlockAtom(BlockEmbed::new(
                    ID,
                    TabsBlock {
                        range: range.clone(),
                        tabs,
                    },
                )),
                // Unsupported, malformed or self-closing MDX components stay
                // literal source rather than falling through to HTML blocks.
                None => Presentation::VisibleSource,
            };
            out.push(Plan {
                element: None,
                source: range,
                presentation,
                delete_units: Vec::new(),
            });
        }
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        let block = embed.model::<TabsBlock>()?;
        let active = cx
            .feature_state::<TabsState>(ID)
            .map_or(0, |s| s.get(block.range.start));
        Some(Rc::new(TabsWidget::new(
            block.clone(),
            cx.theme,
            cx.assets.cloned(),
            active,
        )))
    }

    /// The block is one caret position while it renders.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<TabsBlock>() {
            cx.atomic(block.range.clone());
        }
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let len = state.doc.len();
        match command.payload::<Action>()? {
            Action::Select { at, tab } => {
                preview
                    .state_mut::<TabsState>(ID)
                    .set(*at, *tab, state.revision);
                Some(Transaction::select(state.selection))
            }
            Action::ShowSource(range) => {
                preview.revealed_source = Some(range.start.min(len)..range.end.min(len));
                Some(Transaction::select(Selection::cursor(
                    (range.start + 1).min(range.end).min(len),
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const TABS: &str = "<Tabs>\n<Tab label=\"npm\">\n\n```sh\nnpm i </Tab>\n```\n\n</Tab>\n<Tab label='pnpm'>\n**pnpm** add\n</Tab>\n</Tabs>";

    #[test]
    fn a_tabs_block_runs_to_its_closing_tag_around_code() {
        let doc = format!("Intro\n\n{TABS}\n\nAfter <Note/>\n");
        let found = blocks(&doc);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(doc[found[0].clone()].trim_end(), TABS);
        let tabs = tabs(TABS).unwrap();
        assert_eq!(
            tabs.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(),
            ["npm", "pnpm"]
        );
        assert!(
            tabs[0].content.contains("npm i </Tab>"),
            "fenced code is content"
        );
        assert_eq!(tabs[1].content.trim(), "**pnpm** add");
    }

    #[test]
    fn only_literal_tabs_render() {
        let ok = |s: &str| tabs(s).is_some();
        assert!(ok("<Tabs><Tab label=\"a\">x</Tab></Tabs>"));
        assert!(
            !ok("<Tabs id=\"x\"><Tab label=\"a\">x</Tab></Tabs>"),
            "no Tabs props"
        );
        assert!(!ok("<Tabs><Tab label={a}>x</Tab></Tabs>"), "no expressions");
        assert!(
            !ok("<Tabs><Tab label=\"a\" b=\"c\">x</Tab></Tabs>"),
            "one label"
        );
        assert!(
            !ok("<Tabs>text<Tab label=\"a\">x</Tab></Tabs>"),
            "only Tab children"
        );
        assert!(!ok("<Tabs><Tab label=\"a\">x</Tab>"), "unclosed");
        assert!(!ok("<Tabs></Tabs>"), "at least one tab");
        assert!(!ok("<Note><Tab label=\"a\">x</Tab></Note>"), "unregistered");
        assert!(!ok("<Tabs><Tab label=\"a\">x</Tab></Tabs> tail"));
        assert!(
            ok("<Tabs><Tab label=\"a\"><Badge /> x</Tab></Tabs>"),
            "nested components are content"
        );
    }

    #[test]
    fn tabs_render_in_the_mdx_dialect_only() {
        use crate::editor::markdown::{
            composition::{FEATURES, MDX_FEATURES},
            core::{plans, state::CalloutFolds, syntax::Syntax},
        };
        use crate::editor::text::buffer::Buffer;
        let doc = Buffer::new(format!("Intro\n\n{TABS}\n"));
        let syntax = Syntax::parse(&doc);
        let tabs_in = |features| {
            plans::compile(&doc, &syntax, &CalloutFolds::default(), features)
                .iter()
                .filter_map(|p| p.embed()?.model::<TabsBlock>().cloned())
                .collect::<Vec<_>>()
        };
        let found = tabs_in(MDX_FEATURES);
        assert_eq!(found.len(), 1);
        assert_eq!(doc.slice(found[0].range.clone()), TABS);
        assert!(
            tabs_in(FEATURES).is_empty(),
            "plain Markdown has no components"
        );
    }

    #[test]
    fn tags_keep_quoted_and_braced_closers() {
        let t = tag_at("<Tab label=\"a>b\" x={c > d} />", 0).unwrap();
        assert!(t.self_closing && !t.closing);
        assert_eq!(t.name, "Tab");
        assert!(tag_at("<div>", 0).is_none(), "lowercase is HTML");
        assert!(tag_at("</Tab x>", 0).is_none());
    }

    #[test]
    fn self_closing_tabs_at_line_start_stay_literal_source() {
        use crate::{
            editor::{
                markdown::{
                    composition::MDX_FEATURES,
                    core::{
                        decorations::{self, DecorateCx},
                        plans,
                        presentation::block_rhythm,
                        state::{CalloutFolds, PreviewState},
                        syntax::Syntax,
                    },
                    style::MarkdownTheme,
                },
                text::buffer::Buffer,
                view::decoration::Block,
            },
            typography::Scale,
        };
        for snippet in ["<Tabs/>", "<Tabs />"] {
            assert!(tabs(snippet).is_none(), "{snippet} must not parse as Tabs");
        }
        let doc = Buffer::new("<Tabs/>\n\n<Tabs />\n");
        let syntax = Syntax::parse(&doc);
        let compiled = plans::compile(&doc, &syntax, &CalloutFolds::default(), MDX_FEATURES);
        assert!(
            compiled
                .iter()
                .all(|p| p.embed().and_then(|e| e.model::<TabsBlock>()).is_none()),
            "self-closing <Tabs/> must not emit TabsBlock"
        );
        let rhythm = block_rhythm(&doc, &syntax, None);
        let md_theme = MarkdownTheme::resolve(true, Scale::Medium);
        let preview = PreviewState::default();
        let decorated = decorations::decorate(&DecorateCx {
            doc: &doc,
            syntax: &syntax,
            plans: &compiled,
            rhythm: &rhythm,
            theme: &md_theme,
            preview: &preview,
            live: true,
            features: MDX_FEATURES,
            assets: None,
            references: None,
        });
        assert!(
            decorated.hidden.is_empty(),
            "self-closing <Tabs/> lines must remain visible source: {:?}",
            decorated.hidden
        );
        assert!(
            decorated
                .blocks
                .iter()
                .all(|b| matches!(b, Block::Line { .. })),
            "self-closing <Tabs/> must not be replaced by a block widget"
        );
    }
}
