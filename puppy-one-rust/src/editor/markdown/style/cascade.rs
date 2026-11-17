//! The product's Markdown line CSS (`markdown-editor.css`, then
//! `markdown-content.css`, as imported by `styles/editor.css`) applied to the
//! classes the pipeline puts on a `.cm-line`, in cascade order: rules of equal
//! specificity in source order, higher specificity later. Every value comes
//! from the element styles; every rule cites its selector.
use super::{ListStyle, MarkdownTheme};
use crate::editor::{
    markdown::core::{classes::Class, presentation::ListRhythm},
    view::style::{Align, LineHeight, LineStyle, Paint, Rect, TextStyle},
};
use gpui::{Rgba, SharedString};

/// Facts about one line besides its classes.
pub struct LineInput<'a> {
    pub classes: Class,
    /// `cm-md-heading-N`.
    pub level: u8,
    pub list: Option<&'a ListRhythm>,
    /// `[data-live-preview="true"]` (false: source mode).
    pub live: bool,
}

/// Inherited custom properties a line passes to its spans, and the
/// geometry features decorate the line box with.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LineContext {
    /// `--po-md-inline-foreground`
    pub foreground: Option<Rgba>,
    pub weight: f32,
    pub heading: bool,
    /// The list marker slot (`left`, `width`) of a list or task line.
    pub marker: Option<(f32, f32)>,
    /// Top of the first row inside the box, its line height and font size.
    pub text_top: f32,
    pub line_height: f32,
    pub font_size: f32,
}

/// `--md-list-marker-slot-width` of a list with `columns` (0: bullets).
fn marker_slot(list: &ListStyle, columns: usize, ch: f32) -> f32 {
    if columns == 0 {
        list.marker_width
    } else {
        // `.cm-md-ordered-list-line`: max(width, (columns - 1) * 1ch + suffix).
        list.marker_width
            .max((columns as f32 - 1.) * ch + list.ordered_suffix_width)
    }
}

/// `--md-list-prefix-width` (`.cm-md-list-line`, `.cm-md-nested-list-line`,
/// with the parent prefix of blockDecorations.ts getMarkdownLineAttributes).
fn list_prefix(s: &ListStyle, list: &ListRhythm, ch: f32) -> (f32, f32) {
    let slot = marker_slot(s, list.columns, ch);
    let prefix = match list.parent_columns.split_first() {
        None => s.inset + slot + s.marker_gap + list.depth as f32 * s.indent_step,
        Some((first, rest)) => {
            let parent = s.inset
                + marker_slot(s, *first, ch)
                + s.marker_gap
                + rest
                    .iter()
                    .map(|c| s.indent_step.max(marker_slot(s, *c, ch) + s.marker_gap))
                    .sum::<f32>();
            parent + s.indent_step.max(slot + s.marker_gap)
        }
    };
    (prefix, slot)
}

/// The `.cm-line` box of one source line.
pub fn line(theme: &MarkdownTheme, input: &LineInput) -> (LineStyle, LineContext) {
    let c = input.classes;
    let has = |x: Class| c.has(x);
    let mut text = theme.body.text.clone();
    let mut style = LineStyle::new(text.clone());
    let mut foreground = None;
    let heading = input.live && has(Class::HEADING) && (1..=6).contains(&input.level);
    // --- markdown-editor.css, (0,2,0) in source order -----------------------
    // `.cm-md-code-fence, .cm-md-code-block-line`: code font, colour, size.
    if c.any(Class::CODE_FENCE | Class::CODE_BLOCK_LINE) {
        text.mono = true;
        text.color = theme.code_block.color;
        text.size = theme.code_block.size;
    }
    // `.cm-md-blockquote`: padding-left and a left border.
    if has(Class::BLOCKQUOTE) {
        style.padding.left = theme.quote.padding;
        style.border.left = theme.quote.border_width;
        style.border_color = Some(theme.quote.border_color);
    }
    let ch = text.ch();
    let list = input
        .list
        .filter(|_| c.any(Class::LIST_LINE | Class::TASK_LINE));
    let (prefix, slot) = list.map_or((0., 0.), |l| list_prefix(&theme.list, l, ch));
    // `.cm-md-list-line`: the list rail and colour.
    if has(Class::LIST_LINE) {
        style.padding.left = prefix;
        text.color = theme.list.color;
    }
    // `.cm-md-table-line`
    if has(Class::TABLE_LINE) {
        text.mono = true;
        text.color = theme.table.color;
    }
    // `.cm-md-hr`
    if has(Class::HR) {
        text.color = theme.inline.markup_color;
    }
    // `.cm-md-task-line`
    if has(Class::TASK_LINE) {
        style.padding.left = prefix;
        text.color = theme.list.color;
    }
    // `.cm-md-task-checked`: colour and a 1px line-through.
    if has(Class::TASK_CHECKED) {
        text.color = theme.task.completed_color;
        style.strike = true;
    }
    // (0,3,0) `.cm-md-list-source-line:not(.cm-md-list-continuation)`.
    if has(Class::LIST_SOURCE_LINE) && !has(Class::LIST_CONTINUATION) {
        style.padding.left = prefix - slot - theme.list.marker_gap;
    }
    // (0,3,0) `[data-live-preview="true"] .cm-md-code-block-line`.
    if input.live && has(Class::CODE_BLOCK_LINE) {
        style.background = Some(theme.code_block.background);
    }
    // --- markdown-content.css ---------------------------------------------
    // (0,2,0) `.cm-md-heading`: heading colour and current weight.
    if has(Class::HEADING) {
        text.color = theme.heading.level(1).color;
        text.weight = if heading && input.level <= 3 {
            theme.heading.level(input.level as usize).weight
        } else {
            theme.heading.level(4).weight
        };
    }
    // (0,2,1) `:is(.cm-md-blockquote, …)`: quote colour, inline foreground.
    if has(Class::BLOCKQUOTE) {
        text.color = theme.quote.color;
        foreground = Some(theme.quote.color);
    }
    if heading {
        let h = theme.heading.level(input.level as usize);
        // `.cm-md-heading-N`: size. The syntax-heading span inside h6
        // has its own heading colour, overriding the line's muted h6 colour.
        text.size = h.size;
        // (0,4,0) `.cm-line.cm-md-heading`: heading rhythm and line height.
        style.padding.top = h.gap_before;
        style.padding.bottom = h.gap_after;
        text.line_height = LineHeight::Factor(theme.heading.line_height);
        // (0,3,0) `:is(.cm-md-heading-1, .cm-md-heading-2)`: rule below.
        if input.level <= 2 {
            style.inset_bottom = Some((1., theme.heading.border));
        }
    } else if input.live && !c.any(Class::TABLE_LINE | Class::CODE_FENCE | Class::CODE_BLOCK_LINE) {
        // (0,4,0) `.cm-line:not(heading, table, fence, code)`: line gap plus
        // the semantic gaps (later rhythm rules win).
        let (body, item_gap) = (&theme.body, theme.list.item_gap);
        let before = if has(Class::LIST_START) {
            body.paragraph_gap_before + item_gap / 2.
        } else if has(Class::LIST_ITEM_START) {
            item_gap / 2.
        } else if has(Class::PARAGRAPH_START) {
            body.paragraph_gap_before
        } else {
            0.
        };
        let after = if has(Class::LIST_END) {
            body.paragraph_gap_after + item_gap / 2.
        } else if has(Class::LIST_ITEM_END) {
            item_gap / 2.
        } else if has(Class::PARAGRAPH_END) {
            body.paragraph_gap_after
        } else {
            0.
        };
        style.padding.top = before;
        style.padding.bottom = body.source_line_gap + after;
    }
    let line_height = text.line_height_px();
    let mut marker = None;
    if let Some(list) = list {
        let left = prefix - slot - theme.list.marker_gap;
        marker = Some((left, slot));
        // `.cm-md-list-line:not(task, continuation, source)::before`.
        if has(Class::LIST_LINE)
            && !c.any(Class::TASK_LINE | Class::LIST_CONTINUATION | Class::LIST_SOURCE_LINE)
            && !list.marker.is_empty()
        {
            let l = &theme.list;
            let marker = TextStyle {
                weight: l.marker_weight,
                tabular: l.marker_tabular,
                color: l.marker_color,
                italic: false,
                ..text.clone()
            };
            let align = if has(Class::ORDERED_LIST_LINE) {
                l.ordered_align
            } else {
                Align::Center
            };
            style.overlays.push(Paint::Label {
                rect: Rect::new(left, style.padding.top, slot, line_height),
                text: SharedString::from(list.marker.clone()),
                style: marker,
                align,
            });
        }
    }
    style.text = text.clone();
    let context = LineContext {
        foreground,
        weight: text.weight,
        heading,
        marker,
        text_top: style.padding.top + style.border.top,
        line_height,
        font_size: text.size,
    };
    (style, context)
}
