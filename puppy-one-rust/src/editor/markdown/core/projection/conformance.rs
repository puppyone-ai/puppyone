//! View-independent conformance snapshot of compiled Markdown plans
//! (product `core/projection/markdownConformance.ts`).
//!
//! Editable and read-only panes share the same plan classification; only
//! interactive editing/reveal hooks differ at the view layer.
use super::super::plans::{Plan, Presentation};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConformanceSnapshot {
    pub live: bool,
    pub read_only: bool,
    pub block_embeds: usize,
    pub source_fallbacks: Vec<&'static str>,
}

impl ConformanceSnapshot {
    pub fn from_plans(plans: &[Plan], live: bool, read_only: bool) -> Self {
        let mut block_embeds = 0usize;
        let mut source_fallbacks = Vec::new();
        for plan in plans {
            match &plan.presentation {
                Presentation::BlockAtom(_) => block_embeds += 1,
                Presentation::SourceFallback { code } => source_fallbacks.push(*code),
                _ => {}
            }
        }
        Self {
            live,
            read_only,
            block_embeds,
            source_fallbacks,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::markdown::core::plans::BlockEmbed;
    use core::prelude::v1::test;

    #[test]
    fn editable_and_read_only_share_identical_plan_classification() {
        let plans = vec![
            Plan {
                element: None,
                source: 0..10,
                presentation: Presentation::BlockAtom(BlockEmbed::new("table", 1u8)),
                delete_units: Vec::new(),
            },
            Plan {
                element: None,
                source: 12..30,
                presentation: Presentation::SourceFallback {
                    code: "htmlBlock.malformed",
                },
                delete_units: Vec::new(),
            },
        ];
        let editable = ConformanceSnapshot::from_plans(&plans, true, false);
        let readonly = ConformanceSnapshot::from_plans(&plans, true, true);
        assert_eq!(editable.block_embeds, 1);
        assert_eq!(readonly.block_embeds, 1);
        assert_eq!(editable.source_fallbacks, vec!["htmlBlock.malformed"]);
        assert_eq!(readonly.source_fallbacks, editable.source_fallbacks);
    }
}
