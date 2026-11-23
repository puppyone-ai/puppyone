//! Core render-plan types (product `core/plans/markdownPlanTypes.ts`).
use crate::editor::text::buffer::Buffer;
use std::{
    any::Any,
    fmt,
    hash::{DefaultHasher, Hash, Hasher},
    ops::Range,
    rc::Rc,
};

#[derive(Clone, Debug, PartialEq)]
pub enum Atom {
    Escape,
    TaskCheckbox {
        checked: bool,
    },
    /// Short source shown as the text it means (an emoji, an entity, inline TeX).
    Text(String),
}

/// A block replaced by a feature widget: the owning feature and its model
/// (`BlockEmbedModel`).
#[derive(Clone)]
pub struct BlockEmbed {
    pub feature: &'static str,
    key: u64,
    /// Start byte offset when `model` was compiled (detects shifted suffix embeds).
    built_at: usize,
    /// Start line when `model` was compiled: models such as tables keep line
    /// numbers, which a shift can change while the start byte comes back.
    built_line: usize,
    model: Rc<dyn Any>,
}

impl BlockEmbed {
    pub fn new<T: Any + Hash>(feature: &'static str, model: T) -> Self {
        let mut h = DefaultHasher::new();
        (feature, &model).hash(&mut h);
        Self {
            feature,
            key: h.finish(),
            built_at: usize::MAX,
            built_line: usize::MAX,
            model: Rc::new(model),
        }
    }

    /// Whether `model` was compiled for a block starting at `start` in `doc`.
    pub fn built_for(&self, doc: &Buffer, start: usize) -> bool {
        self.built_at == start && self.built_line == doc.line_index(start)
    }

    pub fn key(&self) -> u64 {
        self.key
    }

    /// The model, if it is a `T`.
    pub fn model<T: Any>(&self) -> Option<&T> {
        self.model.downcast_ref()
    }
}

impl PartialEq for BlockEmbed {
    fn eq(&self, other: &Self) -> bool {
        self.feature == other.feature && self.key == other.key
    }
}

impl fmt::Debug for BlockEmbed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BlockEmbed({}, {:x})", self.feature, self.key)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Presentation {
    VisibleSource,
    /// A recognized feature intentionally keeps its source, with a stable
    /// diagnostic code for inspection and acceptance (not a UI message).
    SourceFallback {
        code: &'static str,
    },
    InlineMark {
        content: Range<usize>,
        markers: Vec<Range<usize>>,
    },
    InlineAtom(Atom),
    BlockAtom(BlockEmbed),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    /// Index into `Syntax::elements` (`None` for feature blocks).
    pub element: Option<usize>,
    pub source: Range<usize>,
    pub presentation: Presentation,
    /// Collapsed marker ranges a single deletion removes as a unit.
    pub delete_units: Vec<Range<usize>>,
}

impl Plan {
    pub fn is_visible_source(&self) -> bool {
        matches!(
            self.presentation,
            Presentation::VisibleSource | Presentation::SourceFallback { .. }
        )
    }

    /// The block embed, if this plan is a feature block.
    pub fn embed(&self) -> Option<&BlockEmbed> {
        match &self.presentation {
            Presentation::BlockAtom(embed) => Some(embed),
            _ => None,
        }
    }

    fn finalize_built_at(mut self, doc: &Buffer) -> Self {
        let start = self.source.start;
        if let Presentation::BlockAtom(embed) = &mut self.presentation
            && embed.built_at == usize::MAX
        {
            embed.built_at = start;
            embed.built_line = doc.line_index(start);
        }
        self
    }

    pub(super) fn clamp_to_doc(mut self, doc: &Buffer) -> Self {
        self.source = doc.clamp_range(self.source);
        self.delete_units = self
            .delete_units
            .into_iter()
            .map(|r| doc.clamp_range(r))
            .collect();
        if let Presentation::InlineMark { content, markers } = &mut self.presentation {
            *content = doc.clamp_range(content.clone());
            for m in markers {
                *m = doc.clamp_range(m.clone());
            }
        }
        self.finalize_built_at(doc)
    }
}
