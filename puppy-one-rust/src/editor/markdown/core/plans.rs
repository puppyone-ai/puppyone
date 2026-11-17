//! Render plans (`TA-32`, `TA-33`, product `core/plans/markdownPlanCompiler.ts`):
//! each semantic element compiles to how it is presented, cached per top-level
//! block and incrementally spliced across [`SyntaxSplice`] windows so typing in
//! paragraph 500 only recompiles plans in paragraph 500's block window.
use super::{
    feature::{self, CompileCx, Features},
    state::FeatureStateStore,
    syntax::{Element, Kind, Span, Syntax, SyntaxSplice},
};
use crate::editor::text::buffer::Buffer;
use std::{
    any::Any,
    collections::HashMap,
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
    pub built_at: usize,
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
            model: Rc::new(model),
        }
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

    fn finalize_built_at(mut self) -> Self {
        let start = self.source.start;
        if let Presentation::BlockAtom(embed) = &mut self.presentation
            && embed.built_at == usize::MAX
        {
            embed.built_at = start;
        }
        self
    }

    fn clamp_to_doc(mut self, doc: &Buffer) -> Self {
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
        self.finalize_built_at()
    }
}

/// Core inline elements (marks, escapes); everything else is visible source.
fn compile_core_element(index: usize, e: &Element) -> Plan {
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
        | Kind::WikiLink
        | Kind::Highlight
        | Kind::LinkDefinition
        | Kind::Comment
        | Kind::InlineHtml => match &e.content {
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
        Kind::Emoji | Kind::Entity | Kind::FootnoteReference | Kind::FootnoteDefinition => {
            match &e.text {
                Some(text) => Plan {
                    presentation: Presentation::InlineAtom(Atom::Text(text.clone())),
                    ..visible
                },
                None => visible,
            }
        }
        _ => visible,
    }
}

fn compile_one_element(index: usize, e: &Element, cx: &CompileCx, features: Features) -> Plan {
    for f in features
        .iter()
        .filter(|f| f.semantic_kinds().contains(&e.kind))
    {
        match feature::catch_feature_panic(f.id(), "compile_element", || {
            f.compile_element(index, e, cx)
        }) {
            Some(Some(plan)) => return plan.clamp_to_doc(cx.doc),
            Some(None) => continue,
            None => {
                return Plan {
                    element: Some(index),
                    source: e.range.clone(),
                    presentation: Presentation::VisibleSource,
                    delete_units: Vec::new(),
                };
            }
        }
    }
    compile_core_element(index, e)
}

/// Per-block compiled `Plan` cache (`TA-32`), keyed by `(block_start,
/// block_content_hash, state_hash)` so unchanged blocks skip recompilation.
#[derive(Clone, Default)]
pub struct PlanCache {
    entries: HashMap<(usize, u64, u64), Vec<Plan>>,
    pub block_compiles: u64,
}

impl PlanCache {
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Build a narrow `Syntax` view bounded to `byte_window` (`line_window`) so
/// feature `compile_blocks` hooks only inspect constructs inside that window!
pub fn window_syntax_view(
    syntax: &Syntax,
    byte_window: &Span,
    line_window: &Range<usize>,
) -> Syntax {
    let slice_spans = |v: &[Span]| -> Vec<Span> {
        let a = v.partition_point(|r| r.end <= byte_window.start);
        let b = v.partition_point(|r| r.start < byte_window.end).max(a);
        v[a..b].to_vec()
    };
    let f_a = syntax
        .fences
        .partition_point(|f| f.range.end <= byte_window.start);
    let f_b = syntax
        .fences
        .partition_point(|f| f.range.start < byte_window.end)
        .max(f_a);
    let fences = syntax.fences[f_a..f_b].to_vec();
    let code_lines = fences.iter().map(|f| f.lines.clone()).collect();

    let c_a = syntax
        .callouts
        .partition_point(|c| c.last_line < line_window.start);
    let c_b = syntax
        .callouts
        .partition_point(|c| c.first_line < line_window.end)
        .max(c_a);
    let callouts = syntax.callouts[c_a..c_b].to_vec();

    Syntax {
        elements: Vec::new(),
        items: Vec::new(),
        lists: Vec::new(),
        paragraphs: Vec::new(),
        fences,
        code_lines,
        highlights: Vec::new(),
        tables: slice_spans(&syntax.tables),
        table_cells: slice_spans(&syntax.table_cells),
        callouts,
        note_definitions: Vec::new(),
        inline_tags: Vec::new(),
        html_blocks: slice_spans(&syntax.html_blocks),
        top_blocks: slice_spans(&syntax.top_blocks),
        footnotes: Default::default(),
        link_defs: Vec::new(),
        block_delimiters: Vec::new(),
    }
}

/// Recompile block plans inside `byte_window` (`line_window`) only, used both
/// by incremental plan splicing (`TA-32`) and by on-demand refresh of shifted
/// suffix `BlockEmbed`s when scrolled into view or targeted by a command.
pub fn compile_blocks_in_window(
    doc: &Buffer,
    syntax: &Syntax,
    folds: &FeatureStateStore,
    features: Features,
    byte_window: Span,
    line_window: Range<usize>,
) -> Vec<Plan> {
    let win_syn = window_syntax_view(syntax, &byte_window, &line_window);
    let win_cx = CompileCx {
        doc,
        syntax: &win_syn,
        folds,
    };
    let mut out = Vec::new();
    for f in features {
        let mut stage = Vec::new();
        if feature::catch_feature_panic(f.id(), "compile_blocks", || {
            f.compile_blocks(&win_cx, &mut stage);
        })
        .is_some()
        {
            for p in stage {
                let clamped = p.clamp_to_doc(doc);
                if clamped.source.end > byte_window.start && clamped.source.start < byte_window.end
                    || (byte_window.start == 0 && clamped.source.start == 0)
                {
                    out.push(clamped);
                }
            }
        }
    }
    out.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    retain_first_block_owner(&mut out);
    out
}

/// Full-document plan compilation (preserving the exact signature expected by
/// existing feature unit tests).
pub fn compile(
    doc: &Buffer,
    syntax: &Syntax,
    folds: &FeatureStateStore,
    features: Features,
) -> Vec<Plan> {
    let cx = CompileCx { doc, syntax, folds };
    let mut plans: Vec<Plan> = syntax
        .elements
        .iter()
        .enumerate()
        .map(|(i, e)| compile_one_element(i, e, &cx, features))
        .collect();
    for f in features {
        let mut stage = Vec::new();
        if feature::catch_feature_panic(f.id(), "compile_blocks", || {
            f.compile_blocks(&cx, &mut stage);
        })
        .is_some()
        {
            plans.extend(stage.into_iter().map(|p| p.clamp_to_doc(doc)));
        }
    }
    plans.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    retain_first_block_owner(&mut plans);
    plans
}

/// Composition order decides which feature owns an identical block range,
/// including a feature's explicit source fallback. Stable source sorting
/// preserves that order. Inline plans remain independent.
fn retain_first_block_owner(plans: &mut Vec<Plan>) {
    let mut claimed = std::collections::HashSet::new();
    plans.retain(|plan| {
        let block = plan.embed().is_some() || (plan.element.is_none() && plan.is_visible_source());
        !block || claimed.insert((plan.source.start, plan.source.end))
    });
}

fn shift_signed(v: usize, delta: isize) -> usize {
    (v as isize + delta) as usize
}

fn shift_range(r: &Range<usize>, delta: isize) -> Range<usize> {
    shift_signed(r.start, delta)..shift_signed(r.end, delta)
}

/// Incrementally splice compiled `Plan`s across `splice` (`TA-32`), recompiling
/// ONLY elements and feature blocks inside `splice.new_bytes` and shifting
/// suffix plans in place!
#[allow(clippy::too_many_arguments)]
pub fn compile_incremental(
    doc: &Buffer,
    syntax: &Syntax,
    prev_plans: &[Plan],
    prev_element_count: usize,
    splice: &SyntaxSplice,
    folds: &FeatureStateStore,
    features: Features,
    cache: &mut PlanCache,
) -> Vec<Plan> {
    let mut next = prev_plans.to_vec();
    compile_incremental_in_place(
        doc,
        syntax,
        &mut next,
        prev_element_count,
        splice,
        folds,
        features,
        cache,
    );
    next
}

/// In-place variant of [`compile_incremental`] (`TA-32`, `TA-13`), splicing and
/// shifting `plans` without cloning suffix `Vec<Range<usize>>` heap allocations.
#[allow(clippy::too_many_arguments)]
pub fn compile_incremental_in_place(
    doc: &Buffer,
    syntax: &Syntax,
    plans: &mut Vec<Plan>,
    prev_element_count: usize,
    splice: &SyntaxSplice,
    folds: &FeatureStateStore,
    features: Features,
    cache: &mut PlanCache,
) {
    let ob = &splice.old_bytes;
    let nb = &splice.new_bytes;
    let bd = splice.byte_delta;
    let elem_delta = syntax.elements.len() as isize - prev_element_count as isize;

    // Fall back to full compilation if any prior plan straddles the splice
    // boundaries, or if multi-block feature delimiters occur inside/unpaired
    // before the splice window.
    let pre_delims = syntax.block_delimiters.partition_point(|&p| p < nb.start);
    let end_delims = syntax.block_delimiters.partition_point(|&p| p < nb.end);
    if splice.old_had_delimiters
        || end_delims > pre_delims
        || pre_delims % 2 == 1
        || plans.iter().any(|p| {
            (p.source.start < ob.start && p.source.end > ob.start)
                || (p.source.start < ob.end && p.source.end > ob.end)
        })
    {
        *plans = compile(doc, syntax, folds, features);
        return;
    }

    let full_cx = CompileCx { doc, syntax, folds };
    let el_start = syntax
        .elements
        .partition_point(|e| e.range.start < nb.start);
    let el_end = syntax
        .elements
        .partition_point(|e| e.range.start < nb.end)
        .max(el_start);

    let mut win_plans: Vec<Plan> = (el_start..el_end)
        .map(|i| compile_one_element(i, &syntax.elements[i], &full_cx, features))
        .collect();
    win_plans.extend(compile_blocks_in_window(
        doc,
        syntax,
        folds,
        features,
        nb.clone(),
        splice.new_lines.clone(),
    ));
    if win_plans
        .iter()
        .any(|p| p.source.start < nb.start || p.source.end > nb.end)
    {
        *plans = compile(doc, syntax, folds, features);
        return;
    }
    win_plans.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    cache.block_compiles += 1;

    let p_pre = plans.partition_point(|p| p.source.start < ob.start);
    let p_suf = plans
        .partition_point(|p| p.source.start < ob.end)
        .max(p_pre);
    let win_len = win_plans.len();
    plans.splice(p_pre..p_suf, win_plans);

    if bd != 0 || elem_delta != 0 {
        for m in &mut plans[p_pre + win_len..] {
            m.source = shift_range(&m.source, bd);
            if let Some(el) = &mut m.element {
                *el = shift_signed(*el, elem_delta);
            }
            if bd != 0 {
                for du in &mut m.delete_units {
                    *du = shift_range(du, bd);
                }
                if let Presentation::InlineMark { content, markers } = &mut m.presentation {
                    *content = shift_range(content, bd);
                    for mk in markers {
                        *mk = shift_range(mk, bd);
                    }
                }
            }
        }
    }
}

/// Ensure any `BlockAtom` plan intersecting `byte_range` has a fresh `model`
/// compiled at its current `source.start` (used before running commands on a
/// block that was previously byte-shifted).
pub fn refresh_shifted_block_plans(
    doc: &Buffer,
    syntax: &Syntax,
    folds: &FeatureStateStore,
    features: Features,
    plans: &mut [Plan],
    byte_range: Span,
) {
    let needs_refresh = plans.iter().any(|p| {
        p.source.end >= byte_range.start
            && p.source.start <= byte_range.end
            && p.embed().is_some_and(|e| e.built_at != p.source.start)
    });
    if !needs_refresh {
        return;
    }
    let start_line = doc.line_index(byte_range.start);
    let end_line = (doc.line_index(byte_range.end) + 1).min(doc.line_count());
    let fresh = compile_blocks_in_window(
        doc,
        syntax,
        folds,
        features,
        byte_range,
        start_line..end_line,
    );
    for p in plans.iter_mut() {
        if let Some(embed) = p.embed()
            && embed.built_at != p.source.start
            && let Some(replacement) = fresh.iter().find(|f| {
                f.source == p.source && f.embed().is_some_and(|fe| fe.feature == embed.feature)
            })
        {
            *p = replacement.clone();
        }
    }
}
