//! Cross-node replacement, split and join semantics.
use crate::native_editor::core::{
    document::{Block, Document, Item, Kind, Style},
    projection::Projection,
    text::{Text, concat, slice, split},
};
use std::ops::Range;
impl Document {
    /// Apply an exact input replacement. Return the caret in the new projection.
    pub fn replace_visible(&mut self, range: Range<usize>, inserted: Text, soft: bool) -> usize {
        let projection = Projection::new(self);
        let first = projection.at(range.start).clone();
        let last = projection.at(range.end).clone();
        let left = self.blocks[first.key.0].kind.texts()[first.key.1];
        let right = self.blocks[last.key.0].kind.texts()[last.key.1];
        let a = range
            .start
            .saturating_sub(first.range.start)
            .min(left.text.len());
        let b = range
            .end
            .saturating_sub(last.range.start)
            .min(right.text.len());
        let prefix = slice(left, 0..a);
        let suffix = slice(right, b..right.text.len());
        let merged = concat(&[prefix.clone(), inserted.clone(), suffix]);
        let caret = range.start + inserted.text.len();
        let first_table = matches!(self.blocks[first.key.0].kind, Kind::Table { .. });
        let last_table = matches!(self.blocks[last.key.0].kind, Kind::Table { .. });
        if first.key == last.key {
            let kind = &self.blocks[first.key.0].kind;
            let empty_list_enter = !soft
                && inserted.text == "\n"
                && left.text.is_empty()
                && matches!(kind, Kind::List { .. });
            if !soft && inserted.text == "\n" && range.is_empty() {
                if let Kind::Text(Style::Paragraph, text) = kind
                    && a == text.text.len()
                    && let Some(language) = text.text.strip_prefix("```")
                    && language
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+'))
                {
                    self.blocks[first.key.0].kind = Kind::Code {
                        language: language.into(),
                        text: Text::default(),
                    };
                    return first.range.start;
                }
                if matches!(kind, Kind::Text(Style::Heading(_) | Style::Quote, _)) {
                    if left.text.is_empty() {
                        self.blocks[first.key.0].kind =
                            Kind::Text(Style::Paragraph, Text::default());
                        return first.range.start;
                    }
                    if a == 0 {
                        let mut paragraph =
                            Block::new(Kind::Text(Style::Paragraph, Text::default()));
                        paragraph.leading =
                            std::mem::replace(&mut self.blocks[first.key.0].leading, "\n\n".into());
                        self.blocks.insert(first.key.0, paragraph);
                        return first.range.start + 1;
                    }
                }
            }
            *self.text_mut(first.key).unwrap() = merged;
            if !soft && inserted.text.contains('\n') {
                self.split_node(first.key, a, &inserted, &prefix);
            }
            if empty_list_enter {
                return Projection::new(self)
                    .offset((first.key.0 + usize::from(first.key.1 > 0), 0));
            }
            return caret.min(Projection::new(self).text.text.len());
        }
        // Selecting across cells keeps the grid; selected cell contents are
        // cleared. A whole-document replacement can remove the table normally.
        if range.start == 0 && range.end == projection.text.text.len() {
            let leading: String = self
                .blocks
                .iter()
                .filter(|b| !b.leading.trim().is_empty())
                .map(|b| b.leading.as_str())
                .collect();
            self.blocks = vec![Block::new(Kind::Text(Style::Paragraph, merged))];
            self.blocks[0].leading = leading;
            if !soft {
                self.split_node((0, 0), a, &inserted, &prefix);
            }
            return inserted
                .text
                .len()
                .min(Projection::new(self).text.text.len());
        }
        if first_table || last_table {
            // A boundary next to a table is structural, not a removable cell
            // separator. Keep surrounding unselected content in its own node.
            if range.len() == 1 && inserted.text.is_empty() && first.key.0 != last.key.0 {
                return range.end;
            }
            for span in &projection.spans {
                if span.key < first.key || span.key > last.key {
                    continue;
                }
                let value = if span.key == first.key {
                    concat(&[prefix.clone(), inserted.clone()])
                } else if span.key == last.key {
                    let text = self.blocks[span.key.0].kind.texts()[span.key.1];
                    slice(text, b..text.text.len())
                } else {
                    Text::default()
                };
                *self.text_mut(span.key).unwrap() = value;
            }
            for index in ((first.key.0 + 1)..last.key.0).rev() {
                self.remove_block(index);
            }
            return Projection::new(self).offset(first.key) + a + inserted.text.len();
        }
        if first.key.0 == last.key.0 {
            if let Kind::List { items, .. } = &mut self.blocks[first.key.0].kind {
                items[first.key.1].text = merged;
                items.drain(first.key.1 + 1..=last.key.1);
            }
        } else {
            // Keep list items outside the selected range, and the first node's
            // formatting. Unselected blocks and parser gaps retain their source.
            let remainder = match &self.blocks[last.key.0].kind {
                Kind::List { start, items } if last.key.1 + 1 < items.len() => Some(Kind::List {
                    start: start.map(|n| n + last.key.1 as u64 + 1),
                    items: items[last.key.1 + 1..].to_vec(),
                }),
                _ => None,
            };
            match &mut self.blocks[first.key.0].kind {
                Kind::List { items, .. } => {
                    items.truncate(first.key.1 + 1);
                    items[first.key.1].text = merged;
                }
                kind => *kind.text_mut(0).unwrap() = merged,
            }
            for index in ((first.key.0 + 1)..=last.key.0).rev() {
                self.remove_block(index);
            }
            if let Some(kind) = remainder {
                self.blocks.insert(first.key.0 + 1, Block::new(kind));
            }
        }
        if !soft && inserted.text.contains('\n') {
            self.split_node(first.key, a, &inserted, &prefix);
        }
        caret.min(Projection::new(self).text.text.len())
    }
    fn split_node(&mut self, key: (usize, usize), at: usize, inserted: &Text, prefix: &Text) {
        let kind = self.blocks[key.0].kind.clone();
        let text = kind.texts()[key.1];
        // Split only newly inserted newlines; pre-existing soft line breaks stay
        // within their paragraph. Shift+Enter never enters this path.
        let mut parts = split(inserted);
        parts[0] = concat(&[prefix.clone(), parts[0].clone()]);
        let end = at + inserted.text.len();
        let tail = slice(text, end..text.text.len());
        let final_part = parts.last_mut().unwrap();
        *final_part = concat(&[final_part.clone(), tail]);
        let empty_list_enter = text.text == "\n" && inserted.text == "\n";
        match kind {
            Kind::Text(style, _) => {
                self.blocks[key.0].kind = Kind::Text(style, parts.remove(0));
                for (i, text) in parts.into_iter().enumerate() {
                    self.blocks.insert(
                        key.0 + i + 1,
                        Block::new(Kind::Text(
                            if style == Style::Quote {
                                Style::Quote
                            } else {
                                Style::Paragraph
                            },
                            text,
                        )),
                    );
                }
            }
            Kind::List { start, mut items } => {
                let checked = items[key.1].checked;
                // Enter on an empty list item exits the list at this position.
                if empty_list_enter {
                    let tail = items.split_off(key.1 + 1);
                    items.pop();
                    let mut replacement = Vec::new();
                    if !items.is_empty() {
                        replacement.push(Block::new(Kind::List { start, items }));
                    }
                    replacement.push(Block::new(Kind::Text(Style::Paragraph, Text::default())));
                    if !tail.is_empty() {
                        replacement.push(Block::new(Kind::List {
                            start: start.map(|n| n + key.1 as u64 + 1),
                            items: tail,
                        }));
                    }
                    replacement[0].leading = self.blocks[key.0].leading.clone();
                    self.blocks.splice(key.0..=key.0, replacement);
                } else {
                    let replacement = parts.into_iter().enumerate().map(|(i, text)| Item {
                        checked: checked.map(|value| i == 0 && value),
                        text,
                    });
                    items.splice(key.1..=key.1, replacement);
                    self.blocks[key.0].kind = Kind::List { start, items };
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests;
