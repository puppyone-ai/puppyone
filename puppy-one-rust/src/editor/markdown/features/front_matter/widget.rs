//! `.cm-md-front-matter-table` (markdown-inline-widgets.css): a grid of
//! keys (`minmax(96px, max-content)`, the markup colour) and values (the
//! content colour, wrapping anywhere) at the meta size, 4px / 16px apart,
//! 8px above and below; the `.cm-md-html-widget` toolbar's source toggle
//! reveals the metadata's source in place.
use super::{FrontMatter, ID, ShowSource};
use crate::editor::{
    markdown::{shared::source_toggle::source_toggle, style::MarkdownTheme},
    view::{
        command::Command,
        style::TextStyle,
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{prelude::*, *};

const KEY_MIN: f32 = 96.;
const ROW_GAP: f32 = 4.;
const COLUMN_GAP: f32 = 16.;
const PADDING: f32 = 8.;

pub struct FrontMatterWidget {
    block: FrontMatter,
    key: TextStyle,
    value: TextStyle,
    dark: bool,
}

impl FrontMatterWidget {
    pub fn new(block: &FrontMatter, theme: &MarkdownTheme) -> Self {
        let meta = crate::theme::ty().ui.meta;
        // The content's unitless line height, at the meta size.
        let mut value = theme.body.text.clone();
        value.size = meta;
        let key = TextStyle {
            color: theme.inline.markup_color,
            ..value.clone()
        };
        Self {
            block: block.clone(),
            key,
            value,
            dark: theme.dark,
        }
    }
}

impl BlockWidget for FrontMatterWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width;
        let row = self.value.line_height_px();
        let key_width = self
            .block
            .entries
            .iter()
            .map(|(k, _)| cx.render.plain_extent(k, &self.key, None).1.ceil())
            .fold(KEY_MIN, f32::max)
            .min(width / 2.);
        let value_width = (width - key_width - COLUMN_GAP).max(0.);
        let cell = |style: &TextStyle, text: &str, x: f32, y: f32, w: f32, rows: usize| {
            let mut d = div()
                .absolute()
                .left(px(x))
                .top(px(y))
                .w(px(w))
                .h(px(rows as f32 * row));
            style.apply(d.style());
            d.child(SharedString::from(text.to_owned()))
        };
        let mut children = Vec::new();
        let mut y = PADDING;
        for (key, value) in &self.block.entries {
            let rows = cx
                .render
                .plain_extent(value, &self.value, Some(value_width))
                .0;
            children.push(cell(&self.key, key, 0., y, key_width, 1));
            children.push(cell(
                &self.value,
                value,
                key_width + COLUMN_GAP,
                y,
                value_width,
                rows,
            ));
            y += rows as f32 * row + ROW_GAP;
        }
        let height = y - ROW_GAP + PADDING;
        let toggle = source_toggle(
            cx.id("md-front-matter-source"),
            "md-front-matter",
            width,
            self.dark,
            cx.state.focus_within() || cx.state.selected,
            cx.sender(),
            Command::new(ID, ShowSource(self.block.range.clone())),
        );
        let table = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-front-matter")
            .children(children)
            .child(toggle);
        (cx.block_box(height).child(table).into_any_element(), height)
    }
}
