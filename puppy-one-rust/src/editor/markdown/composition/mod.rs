//! The built-in Markdown features (`composition/markdownFeatureComposition.ts`):
//! the only lists of them, one per dialect. Order matters where features
//! claim the same source (earlier wins).
pub mod preview;

use super::{
    core::features::{Features, MarkdownFeature},
    features::{
        callout, code_block, footnote, front_matter, html, image, inline_syntax, math, mdx, media,
        mermaid, rule, table, task, video,
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
    &footnote::FEATURE,
    &inline_syntax::FEATURE,
    &media::FEATURE,
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
    &footnote::FEATURE,
    &inline_syntax::FEATURE,
    &media::FEATURE,
];

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn dialect_feature_lists_preserve_exact_claim_order() {
        let gfm: Vec<&str> = FEATURES.iter().map(|f| f.id()).collect();
        assert_eq!(
            gfm,
            [
                "front-matter",
                "math",
                "mermaid",
                "code-block",
                "html",
                "table",
                "rule",
                "task",
                "callout",
                "image",
                "video",
                "footnote",
                "inline-syntax",
                "media",
            ]
        );
        let mdx: Vec<&str> = MDX_FEATURES.iter().map(|f| f.id()).collect();
        assert_eq!(
            mdx,
            [
                "front-matter",
                "math",
                "mermaid",
                "code-block",
                "mdx-component",
                "html",
                "table",
                "rule",
                "task",
                "callout",
                "image",
                "video",
                "footnote",
                "inline-syntax",
                "media",
            ]
        );
    }
}
