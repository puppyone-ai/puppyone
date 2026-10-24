//! Horizontal rules (core/widgets/inlineWidgets.ts `HorizontalRuleWidget`):
//! a thematic break is a block widget drawing a centred 1px rule.
pub mod style;
mod widget;

use crate::editor::{
    markdown::core::{
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
        syntax::{Element, Kind},
    },
    view::widget::BlockWidget,
};
use std::rc::Rc;
use widget::RuleWidget;

pub struct RuleFeature;
pub static FEATURE: RuleFeature = RuleFeature;
pub const ID: &str = "rule";

/// A thematic break (it has no data beyond its source).
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct Rule;

impl MarkdownFeature for RuleFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn semantic_kinds(&self) -> &'static [Kind] {
        &[Kind::Rule]
    }

    fn compile_element(&self, index: usize, element: &Element, _: &CompileCx) -> Option<Plan> {
        Some(Plan { element: Some(index), source: element.range.clone(), presentation: Presentation::BlockAtom(BlockEmbed::new(ID, Rule)), delete_units: Vec::new() })
    }

    fn block_widget(&self, _: &BlockEmbed, cx: &WidgetFactoryCx) -> Option<Rc<dyn BlockWidget>> {
        Some(Rc::new(RuleWidget::new(&cx.theme.rule)))
    }
}
