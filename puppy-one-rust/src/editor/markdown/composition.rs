//! The built-in Markdown features (composition/markdownFeatureComposition.ts):
//! the only list of them. Order matters where features claim the same
//! source (earlier wins).
use super::{
    core::feature::{Features, MarkdownFeature},
    features::{code_block, math, rule, table, task},
};

pub static FEATURES: Features = &[
    // Math claims the fences labelled `math` before code blocks do.
    &math::FEATURE as &dyn MarkdownFeature,
    &code_block::FEATURE,
    &table::FEATURE,
    &rule::FEATURE,
    &task::FEATURE,
];
