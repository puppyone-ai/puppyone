//! The built-in Markdown features (composition/markdownFeatureComposition.ts):
//! the only list of them. Order matters where features claim the same
//! source (earlier wins).
use super::{
    core::feature::{Features, MarkdownFeature},
    features::{code_block, rule, table, task},
};

pub static FEATURES: Features = &[&code_block::FEATURE as &dyn MarkdownFeature, &table::FEATURE, &rule::FEATURE, &task::FEATURE];
