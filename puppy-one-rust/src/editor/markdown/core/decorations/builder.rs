//! The decoration builder: what one pass over the document accumulates
//! (line boxes and widgets, hidden and atomic source, inline class spans,
//! each line's inline context), and the narrow facades features decorate
//! through.
use super::DecorateCx;
use crate::editor::{
    markdown::{
        core::{
            classes::{Class, SourceSyntax},
            plans::Plan,
            syntax::Syntax,
        },
        style::{
            MarkdownTheme,
            cascade::{self, LineContext, LineInput},
        },
    },
    text::buffer::Buffer,
    view::{decoration::Block, style::LineStyle},
};
use gpui::SharedString;
use std::{ops::Range, rc::Rc};

/// An inline span carrying CSS classes (a mark decoration).
pub(super) struct ClassSpan {
    pub range: Range<usize>,
    pub classes: Class,
    pub href: Option<SharedString>,
}

pub(super) struct Builder<'a> {
    pub cx: &'a DecorateCx<'a>,
    pub blocks: Vec<Block>,
    pub hidden: Vec<Range<usize>>,
    /// Source the caret may not rest inside besides hidden ranges.
    pub atomic: Vec<Range<usize>>,
    /// Source shown as other text.
    pub replaced: Vec<(Range<usize>, SharedString)>,
    pub superscripts: Vec<crate::editor::view::decoration::Superscript>,
    /// Colours an element sets on its content (inline HTML `style`): text
    /// and background, packed.
    pub colors: Vec<(Range<usize>, Option<u32>, Option<u32>)>,
    pub spans: Vec<ClassSpan>,
    /// Inline context of each source line (`None` inside widgets).
    pub contexts: Vec<Option<LineContext>>,
    /// Plans by the line their source starts on.
    pub by_line: Vec<Vec<&'a Plan>>,
}

impl<'a> Builder<'a> {
    pub fn new(cx: &'a DecorateCx<'a>) -> Self {
        let count = cx.doc.line_count();
        let mut by_line: Vec<Vec<&Plan>> = vec![Vec::new(); count];
        for plan in cx.plans {
            by_line[cx.doc.line_index(plan.source.start)].push(plan);
        }
        Self {
            cx,
            blocks: Vec::with_capacity(count),
            hidden: Vec::new(),
            atomic: Vec::new(),
            replaced: Vec::new(),
            superscripts: Vec::new(),
            colors: Vec::new(),
            spans: Vec::new(),
            contexts: vec![None; count],
            by_line,
        }
    }

    /// Hide `range`, or show it as revealed source.
    pub fn hide(&mut self, range: Range<usize>, kind: SourceSyntax, reveal: bool) {
        if range.is_empty() {
            return;
        }
        if reveal {
            self.spans.push(ClassSpan {
                range,
                classes: kind.revealed(),
                href: None,
            });
        } else {
            self.hidden.push(range);
        }
    }

    /// The `.cm-line` box of a source line; in live preview, features may add
    /// to it (`decorate_line`).
    pub fn line_box(&mut self, line: usize, input: LineInput, features: bool) {
        let cx = self.cx;
        let (mut style, context) = cascade::line(cx.theme, &input);
        if features && cx.live {
            let plans = self.by_line[line].clone();
            let mut decoration = LineDecoration {
                doc: cx.doc,
                line,
                range: cx.doc.line_range(line),
                plans: &plans,
                syntax: cx.syntax,
                theme: cx.theme,
                preview: cx.preview,
                assets: cx.assets,
                references: cx.references,
                context: &context,
                style: &mut style,
                hidden: &mut self.hidden,
                replaced: &mut self.replaced,
            };
            for feature in cx.features {
                feature.decorate_line(&mut decoration);
            }
        }
        self.contexts[line] = Some(context);
        self.blocks.push(Block::Line {
            line,
            style: Rc::new(style),
        });
    }
}

/// A feature decorating the line box of one source line.
pub struct LineDecoration<'b> {
    pub doc: &'b crate::editor::text::buffer::Buffer,
    pub line: usize,
    pub range: Range<usize>,
    /// Plans whose source starts on this line.
    pub plans: &'b [&'b Plan],
    pub syntax: &'b Syntax,
    pub theme: &'b MarkdownTheme,
    pub preview: &'b crate::editor::markdown::core::state::PreviewState,
    pub assets: Option<&'b crate::editor::registry::DocumentAssets>,
    pub references: Option<&'b crate::editor::navigation::ReferenceContext>,
    /// The cascade's facts about the line (marker slot, text row).
    pub context: &'b LineContext,
    pub style: &'b mut LineStyle,
    /// Source the line hides, and source it shows as other text.
    pub hidden: &'b mut Vec<Range<usize>>,
    pub replaced: &'b mut Vec<(Range<usize>, SharedString)>,
}

/// A feature decorating its block (around its widget).
pub struct BlockDecoration<'b, 'a> {
    pub(super) builder: &'b mut Builder<'a>,
    #[expect(
        dead_code,
        reason = "feature context: handed to every feature; none reads it yet"
    )]
    pub source: Range<usize>,
    #[expect(
        dead_code,
        reason = "feature context: handed to every feature; none reads it yet"
    )]
    pub lines: Range<usize>,
}

impl BlockDecoration<'_, '_> {
    pub fn doc(&self) -> &Buffer {
        self.builder.cx.doc
    }
    #[expect(
        dead_code,
        reason = "feature context: handed to every feature; none reads it yet"
    )]
    pub fn syntax(&self) -> &Syntax {
        self.builder.cx.syntax
    }
    pub fn theme(&self) -> &MarkdownTheme {
        self.builder.cx.theme
    }
    /// Source the caret may not rest strictly inside.
    pub fn atomic(&mut self, range: Range<usize>) {
        if !range.is_empty() {
            self.builder.atomic.push(range);
        }
    }
    /// Decorate one source line's inline Markdown, as text in `context`
    /// (text a widget shows, e.g. table cells).
    pub fn inline_line(&mut self, line: usize, context: LineContext) {
        self.builder.contexts[line] = Some(context);
        let plans = self.builder.by_line[line].clone();
        self.builder.inline(line, &plans, Vec::new());
    }
}
