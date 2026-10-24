//! Markdown shortcuts run after committed typing, never during IME preedit.
use crate::native_editor::core::{
    document::{Document, Item, Kind, Style},
    projection::Projection,
    text::{concat, slice},
};
impl Document {
    /// Markdown block prefixes are consumed only after committed typing.
    pub fn shortcut(&mut self, cursor: usize) -> usize {
        let projection = Projection::new(self);
        let span = projection.at(cursor);
        if let Kind::List { items, .. } = &mut self.blocks[span.key.0].kind {
            let item = &mut items[span.key.1];
            let local = cursor
                .saturating_sub(span.range.start)
                .min(item.text.text.len());
            if item.checked.is_none() && matches!(&item.text.text[..local], "[ ] " | "[x] " | "[] ")
            {
                item.checked = Some(item.text.text.starts_with("[x]"));
                item.text = slice(&item.text, local..item.text.text.len());
                return span.range.start;
            }
        }
        if self.blocks[span.key.0].kind.rich() {
            let text = self.text_mut(span.key).unwrap();
            let local = cursor.saturating_sub(span.range.start).min(text.text.len());
            for delimiter in ["**", "__", "*", "_"] {
                let prefix = &text.text[..local];
                let Some(body) = prefix.strip_suffix(delimiter) else {
                    continue;
                };
                let Some(open) = body.rfind(delimiter) else {
                    continue;
                };
                let begin = open + delimiter.len();
                if begin == body.len() || body[begin..].contains('\n') {
                    continue;
                }
                if delimiter.len() == 1
                    && (body[..open].ends_with(delimiter)
                        || body[begin..].starts_with(delimiter)
                        || body.ends_with(delimiter))
                {
                    continue;
                }
                let mut marked = slice(text, begin..body.len());
                for mark in &mut marked.marks {
                    if delimiter.len() == 2 {
                        mark.bold = true;
                    } else {
                        mark.italic = true;
                    }
                }
                *text = concat(&[
                    slice(text, 0..open),
                    marked,
                    slice(text, local..text.text.len()),
                ]);
                return cursor - 2 * delimiter.len();
            }
        }
        let Kind::Text(Style::Paragraph, text) = &self.blocks[span.key.0].kind else {
            return cursor;
        };
        let local = cursor.saturating_sub(span.range.start).min(text.text.len());
        let prefix = &text.text[..local];
        let rest = slice(text, local..text.text.len());
        let kind = match prefix {
            "# " => Kind::Text(Style::Heading(1), rest),
            "## " => Kind::Text(Style::Heading(2), rest),
            "### " => Kind::Text(Style::Heading(3), rest),
            "> " => Kind::Text(Style::Quote, rest),
            "- " | "* " => Kind::List {
                start: None,
                items: vec![Item {
                    checked: None,
                    text: rest,
                }],
            },
            "1. " => Kind::List {
                start: Some(1),
                items: vec![Item {
                    checked: None,
                    text: rest,
                }],
            },
            "[] " | "[ ] " | "- [ ] " => Kind::List {
                start: None,
                items: vec![Item {
                    checked: Some(false),
                    text: rest,
                }],
            },
            "``` " => Kind::Code {
                language: String::new(),
                text: rest,
            },
            _ => return cursor,
        };
        self.blocks[span.key.0].kind = kind;
        span.range.start
    }
}
