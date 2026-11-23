//! Shared pure data types exchanged between `core/` and feature slices
//! (product `core/features/markdownFeatureData.ts`).
//!
//! Pure data contract (`R10`: zero `gpui` references). Feature-owned models
//! live inside their respective `features/<name>/model.rs` directories.
pub use crate::editor::markdown::core::syntax::{Element, Kind, Span};
use std::collections::HashMap;

/// What an inline HTML element carries across core decorations and links:
/// its tag name and the attributes that style or link it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InlineTag {
    pub name: String,
    /// `a href` as authored (the URL policy applies when it is followed).
    pub href: Option<String>,
    /// `style` colours (`color`, `background-color`), as CSS colours.
    pub color: Option<String>,
    pub background: Option<String>,
}

/// Pure navigation index of footnotes derived from `Kind::FootnoteDefinition`
/// and `Kind::FootnoteReference` elements contributed by `features/footnote`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Footnotes {
    pub definitions: HashMap<String, Span>,
    pub first_references: HashMap<String, usize>,
}

impl Footnotes {
    /// Build the footnote target index from sorted `Syntax::elements`.
    pub fn from_elements(elements: &[Element]) -> Self {
        let mut definitions = HashMap::new();
        let mut first_references = HashMap::new();
        for e in elements {
            let Some(id) = e.href.as_ref() else {
                continue;
            };
            match e.kind {
                Kind::FootnoteDefinition => {
                    definitions
                        .entry(id.clone())
                        .or_insert_with(|| e.range.clone());
                }
                Kind::FootnoteReference => {
                    first_references.entry(id.clone()).or_insert(e.range.start);
                }
                _ => {}
            }
        }
        Self {
            definitions,
            first_references,
        }
    }

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
