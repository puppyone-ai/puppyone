//! The built-in Markdown features (composition/markdownFeatureComposition.ts):
//! the only list of them. Order matters where features claim the same
//! source (earlier wins).
use super::{
    core::feature::{Features, MarkdownFeature},
    features::{callout, code_block, front_matter, html, image, math, mermaid, rule, table, task},
};

pub static FEATURES: Features = &[
    &front_matter::FEATURE as &dyn MarkdownFeature,
    // Math and Mermaid claim their fences before code blocks do.
    &math::FEATURE,
    &mermaid::FEATURE,
    &code_block::FEATURE,
    &html::FEATURE,
    &table::FEATURE,
    &rule::FEATURE,
    &task::FEATURE,
    &callout::FEATURE,
    &image::FEATURE,
];
