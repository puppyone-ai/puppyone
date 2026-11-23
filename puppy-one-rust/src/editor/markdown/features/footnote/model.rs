//! Footnote definition/reference pairing and first-reference numbering
//! (product `features/footnote/footnoteModel.ts`).
use super::syntax::{footnote_marker, is_escaped};
use crate::editor::{
    markdown::core::syntax::{Element, Kind, Span, Syntax},
    text::buffer::Buffer,
};
use std::{collections::HashMap, ops::Range};

/// Collect footnote definition (`[^id]:`) and reference (`[^id]`) elements
/// inside `window`, numbered by order of first reference.
pub fn collect_footnotes_in_range(
    doc: &Buffer,
    syntax: &Syntax,
    window: Range<usize>,
    out: &mut Vec<Element>,
) {
    let mut starts: Vec<usize> = syntax
        .paragraphs
        .iter()
        .map(|p| p.range.start)
        .chain(syntax.note_definitions.iter().copied())
        .filter(|&at| window.start <= at && at < window.end)
        .collect();
    starts.sort_unstable();
    starts.dedup();
    let mut definitions: Vec<(String, Span)> = Vec::new();
    for at in starts {
        let probe = doc.slice_cow(at..doc.len().min(at + 256));
        if let Some(len) = footnote_marker(&probe, 0)
            && probe.get(len + 3..).is_some_and(|r| r.starts_with(':'))
        {
            let id = probe[2..2 + len].to_owned();
            if !definitions.iter().any(|(d, _)| *d == id) {
                definitions.push((id, at..at + len + 4));
            }
        }
    }
    if definitions.is_empty() {
        return;
    }

    let code: Vec<Span> = syntax
        .elements
        .iter()
        .filter(|e| e.kind == Kind::InlineCode)
        .map(|e| e.range.clone())
        .collect();
    let ranges = syntax.inline_ranges_in(doc, window);
    let mut references: Vec<(String, Span)> = Vec::new();
    for region in ranges {
        let base = region.start;
        let source_cow = doc.slice_cow(region);
        let source = source_cow.as_ref();
        let bytes = source.as_bytes();
        if !source.contains("[^") {
            continue;
        }
        let mut i = 0;
        while let Some(found) = source[i..].find("[^") {
            let at = i + found;
            i = at + 2;
            let Some(len) = footnote_marker(source, at) else {
                continue;
            };
            let range = base + at..base + at + len + 3;
            let linked = matches!(bytes.get(at + len + 3), Some(b'(' | b'['));
            if is_escaped(bytes, at)
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
    for (id, range) in &references {
        if defined(id).is_none_or(|d| d.start == range.start) || numbers.contains_key(id) {
            continue;
        }
        numbers.insert(id.clone(), numbers.len() + 1);
    }
    for (id, range) in &definitions {
        let mut e = Element::new(Kind::FootnoteDefinition, range.clone(), vec![], None);
        e.text = Some(numbers.get(id).map_or_else(|| id.clone(), usize::to_string));
        e.href = Some(id.clone());
        out.push(e);
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
        out.push(e);
    }
}

#[cfg(test)]
mod tests {
    use super::super::FEATURE;
    use crate::editor::{
        markdown::core::{
            features::MarkdownFeature,
            syntax::{Kind, Syntax},
        },
        text::buffer::Buffer,
    };
    use core::prelude::v1::test;

    #[test]
    fn notes_are_numbered_by_first_reference() {
        let doc = Buffer::new(
            "See[^b] and[^a], again[^b], `[^a]` and \\[^a] and [^none].\n\n[^a]: First.\n\n[^b]: Second.\n",
        );
        static F: &[&dyn MarkdownFeature] = &[&FEATURE];
        let s = Syntax::parse_with(&doc, F);
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
