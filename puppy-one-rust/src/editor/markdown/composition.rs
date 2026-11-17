//! The built-in Markdown features (composition/markdownFeatureComposition.ts):
//! the only lists of them, one per dialect. Order matters where features
//! claim the same source (earlier wins).
use super::{
    core::feature::{Features, MarkdownFeature},
    features::{
        callout, code_block, front_matter, html, image, math, mdx, mermaid, rule, table, task,
        video,
    },
};

/// `puppyGfmFeatures`: the standard Markdown dialect.
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
    &video::FEATURE,
];

/// `openKnowledgeMdxFeatures`: the OpenKnowledge dialect, components claiming
/// their blocks before HTML does.
pub static MDX_FEATURES: Features = &[
    &front_matter::FEATURE as &dyn MarkdownFeature,
    &math::FEATURE,
    &mermaid::FEATURE,
    &code_block::FEATURE,
    &mdx::FEATURE,
    &html::FEATURE,
    &table::FEATURE,
    &rule::FEATURE,
    &task::FEATURE,
    &callout::FEATURE,
    &image::FEATURE,
    &video::FEATURE,
];
