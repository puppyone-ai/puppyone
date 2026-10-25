//! Render plans (product core/plans/markdownPlanCompiler.ts): each semantic
//! element compiles to how it is presented. Incomplete or unrenderable
//! constructs are `VisibleSource` and lose collapsed-marker deletion.
//! Decorations, keymaps and reveal read capabilities from plans rather than
//! re-inferring them from element kinds. Features compile the elements they
//! claim and their own block plans (`core/feature.rs`).
use super::{
    feature::{CompileCx, Features},
    syntax::{Element, Kind, Syntax},
};
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
    TaskCheckbox { checked: bool },
}

/// A block replaced by a feature widget: the owning feature and its model
/// (`BlockEmbedModel`).
#[derive(Clone)]
pub struct BlockEmbed {
    pub feature: &'static str,
    key: u64,
    model: Rc<dyn Any>,
}

impl BlockEmbed {
    pub fn new<T: Any + Hash>(feature: &'static str, model: T) -> Self {
        let mut h = DefaultHasher::new();
        (feature, &model).hash(&mut h);
        Self {
            feature,
            key: h.finish(),
            model: Rc::new(model),
        }
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
    /// The block embed, if this plan is a feature block.
    pub fn embed(&self) -> Option<&BlockEmbed> {
        match &self.presentation {
            Presentation::BlockAtom(embed) => Some(embed),
            _ => None,
        }
    }
}

/// Core inline elements (marks, escapes); everything else is visible source.
fn compile_element(index: usize, e: &Element) -> Plan {
    let visible = Plan {
        element: Some(index),
        source: e.range.clone(),
        presentation: Presentation::VisibleSource,
        delete_units: Vec::new(),
    };
    match e.kind {
        Kind::Strong
        | Kind::Emphasis
        | Kind::Strike
        | Kind::InlineCode
        | Kind::Link
        | Kind::WikiLink => match &e.content {
            Some(c) if c.start < c.end => Plan {
                element: Some(index),
                source: e.range.clone(),
                presentation: Presentation::InlineMark {
                    content: c.clone(),
                    markers: e.markers.clone(),
                },
                delete_units: e.markers.clone(),
            },
            _ => visible,
        },
        Kind::Escape => Plan {
            presentation: Presentation::InlineAtom(Atom::Escape),
            delete_units: e.markers.clone(),
            ..visible
        },
        _ => visible,
    }
}

/// Plans of every element plus feature blocks, sorted by source range.
pub fn compile(doc: &Buffer, syntax: &Syntax, features: Features) -> Vec<Plan> {
    let cx = CompileCx { doc, syntax };
    let mut plans: Vec<Plan> = syntax
        .elements
        .iter()
        .enumerate()
        .map(|(i, e)| {
            features
                .iter()
                .filter(|f| f.semantic_kinds().contains(&e.kind))
                .find_map(|f| f.compile_element(i, e, &cx))
                .unwrap_or_else(|| compile_element(i, e))
        })
        .collect();
    for feature in features {
        feature.compile_blocks(&cx, &mut plans);
    }
    plans.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    plans
}
