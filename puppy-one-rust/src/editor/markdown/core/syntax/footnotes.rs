//! Footnotes (`features/footnote/footnoteModel.ts`): `[^id]:` opening a
//! paragraph or a link reference definition defines a note, and `[^id]`
//! elsewhere refers to it. Uses `Buffer` rope line slices without materialising
//! `doc.flat` (`TA-01`, `TA-31`).
use super::{Element, Kind, Span, Syntax};
use crate::editor::{markdown::core::links, text::buffer::Buffer};
use std::collections::HashMap;

/// `[^id]` at `at` in `text` (`/^\[\^([^\]\s]+)\]/`): the id's length.
fn marker(text: &str, at: usize) -> Option<usize> {
    let rest = text.get(at..)?.strip_prefix("[^")?;
    let len = rest.find(|c: char| c == ']' || c.is_whitespace())?;
    (len > 0 && rest[len..].starts_with(']')).then_some(len)
}

/// The notes' definitions (`[^id]:`, the first per id) and first
/// references, by id.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Footnotes {
    pub definitions: HashMap<String, Span>,
    pub first_references: HashMap<String, usize>,
}

/// Scan footnote definitions and references in eligible lines and table
/// cells without materialising `doc.flat`.
pub(super) fn add_in_ranges(doc: &Buffer, ranges: &[Span], syntax: &mut Syntax) {
    let mut starts: Vec<usize> = syntax.paragraphs.iter().map(|p| p.range.start).collect();
    starts.extend(syntax.note_definitions.iter().copied());
    starts.sort_unstable();
    starts.dedup();
    let mut definitions: Vec<(String, Span)> = Vec::new();
    for at in starts {
        let probe = doc.slice_cow(at..doc.len().min(at + 256));
        if let Some(len) = marker(&probe, 0)
            && probe.get(len + 3..).is_some_and(|r| r.starts_with(':'))
        {
            let id = probe[2..2 + len].to_owned();
            if !definitions.iter().any(|(d, _)| *d == id) {
                definitions.push((id, at..at + len + 4));
            }
        }
    }
    if definitions.is_empty() {
        syntax.footnotes = Footnotes::default();
        return;
    }

    let code: Vec<Span> = syntax
        .elements
        .iter()
        .filter(|e| e.kind == Kind::InlineCode)
        .map(|e| e.range.clone())
        .collect();
    let mut references: Vec<(String, Span)> = Vec::new();
    for region in ranges {
        let base = region.start;
        let source_cow = doc.slice_cow(region.clone());
        let source = source_cow.as_ref();
        let bytes = source.as_bytes();
        if !source.contains("[^") {
            continue;
        }
        let mut i = 0;
        while let Some(found) = source[i..].find("[^") {
            let at = i + found;
            i = at + 2;
            let Some(len) = marker(source, at) else {
                continue;
            };
            let range = base + at..base + at + len + 3;
            let linked = matches!(bytes.get(at + len + 3), Some(b'(' | b'['));
            if links::is_escaped(bytes, at)
                || linked
                || code
                    .iter()
                    .any(|c| c.start < range.end && range.start < c.end)
            {
                continue;
            }
            references.push((source[at + 2..at + 2 + len].to_owned(), range));
            i = at + len + 3;
        }
    }
    let defined = |id: &str| definitions.iter().find(|(d, _)| d == id).map(|(_, r)| r);
    let mut numbers: HashMap<String, usize> = HashMap::new();
    let mut first_references = HashMap::new();
    for (id, range) in &references {
        if defined(id).is_none_or(|d| d.start == range.start) || numbers.contains_key(id) {
            continue;
        }
        numbers.insert(id.clone(), numbers.len() + 1);
        first_references.insert(id.clone(), range.start);
    }
    for (id, range) in &definitions {
        let mut e = Element::new(Kind::FootnoteDefinition, range.clone(), vec![], None);
        e.text = Some(numbers.get(id).map_or_else(|| id.clone(), usize::to_string));
        e.href = Some(id.clone());
        syntax.elements.push(e);
    }
    for (id, range) in references {
        let Some(&n) = numbers.get(&id) else {
            continue;
        };
        if defined(&id).is_some_and(|d| d.start == range.start) {
            continue;
        }
        let mut e = Element::new(Kind::FootnoteReference, range, vec![], None);
        e.text = Some(n.to_string());
        e.href = Some(id);
        syntax.elements.push(e);
    }
    syntax.footnotes = Footnotes {
        definitions: definitions.into_iter().collect(),
        first_references,
    };
}

impl Footnotes {
    pub fn is_empty(&self) -> bool {
        self.definitions.is_empty() && self.first_references.is_empty()
    }

    pub fn shift_in_place(&mut self, after_byte: usize, byte_delta: isize) {
        if self.is_empty() || byte_delta == 0 {
            return;
        }
        let shift = |v: usize| {
            if v >= after_byte {
                ((v as isize) + byte_delta) as usize
            } else {
                v
            }
        };
        for r in self.definitions.values_mut() {
            *r = shift(r.start)..shift(r.end);
        }
        for off in self.first_references.values_mut() {
            *off = shift(*off);
        }
    }

    pub fn shifted(&self, after_byte: usize, byte_delta: isize) -> Self {
        if self.is_empty() || byte_delta == 0 {
            return self.clone();
        }
        let shift = |v: usize| {
            if v >= after_byte {
                ((v as isize) + byte_delta) as usize
            } else {
                v
            }
        };
        Self {
            definitions: self
                .definitions
                .iter()
                .map(|(k, r)| (k.clone(), shift(r.start)..shift(r.end)))
                .collect(),
            first_references: self
                .first_references
                .iter()
                .map(|(k, &off)| (k.clone(), shift(off)))
                .collect(),
        }
    }

    pub fn target(&self, element: &Element) -> Option<usize> {
        let id = element.href.as_deref()?;
        match element.kind {
            Kind::FootnoteReference => self.definitions.get(id).map(|r| r.start),
            Kind::FootnoteDefinition => self.first_references.get(id).copied(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Kind, Syntax};
    use crate::editor::text::buffer::Buffer;
    use core::prelude::v1::test;

    #[test]
    fn notes_are_numbered_by_first_reference() {
        let doc = Buffer::new(
            "See[^b] and[^a], again[^b], `[^a]` and \\[^a] and [^none].\n\n[^a]: First.\n\n[^b]: Second.\n",
        );
        let s = Syntax::parse(&doc);
        let shown = |kind| {
            s.elements
                .iter()
                .filter(|e| e.kind == kind)
                .map(|e| (doc.slice(e.range.clone()), e.text.clone().unwrap()))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            shown(Kind::FootnoteReference),
            vec![
                ("[^b]", "1".into()),
                ("[^a]", "2".into()),
                ("[^b]", "1".into()),
            ]
        );
        assert_eq!(
            shown(Kind::FootnoteDefinition),
            vec![("[^a]:", "2".into()), ("[^b]:", "1".into())]
        );
        let first_b = s
            .elements
            .iter()
            .find(|e| e.kind == Kind::FootnoteReference)
            .unwrap();
        let def_b = s
            .elements
            .iter()
            .filter(|e| e.kind == Kind::FootnoteDefinition)
            .nth(1)
            .unwrap();
        assert_eq!(s.footnotes.target(first_b), Some(def_b.range.start));
        assert_eq!(s.footnotes.target(def_b), Some(first_b.range.start));
    }
}
