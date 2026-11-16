//! Mermaid (product features/mermaid): a fence labelled `mermaid` or `mmd`
//! shows its diagram, drawn by the product's own Mermaid in the render
//! service through [`crate::editor::markdown::platform::render`]. The caret
//! inside the block (Edit, or a click on the diagram) shows its source above
//! the diagram, which follows as it is typed; Done leaves it. Zoom (− 100% + Fit)
//! is the pane's view state. Larger diagrams wait for Render (`deferred`),
//! the largest stay a code block (`markdownBlockExecution.ts`).
mod controls;
mod widget;

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            feature::{CommandCx, CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan, Presentation},
            state::PreviewState,
        },
        shared::fence::{
            DocumentProfile, FenceExecution, decide_fence_execution, fence_delimiter_ranges,
        },
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};
use widget::MermaidBlockWidget;

pub struct MermaidFeature;
pub static FEATURE: MermaidFeature = MermaidFeature;
pub const ID: &str = "mermaid";

/// `MERMAID_RICH_BYTES` / `_ITEMS` by document profile, and the deferred
/// ceilings beyond which the source stays a code block.
const RICH_BYTES: [usize; 3] = [32 * 1024, 24 * 1024, 12 * 1024];
const RICH_ITEMS: [usize; 3] = [1_000, 700, 350];
const DEFERRED_MAX_BYTES: usize = 128 * 1024;
const DEFERRED_MAX_ITEMS: usize = 4_000;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct MermaidBlock {
    /// Opening fence line start to closing line end.
    pub range: Range<usize>,
    /// The diagram source between the fences.
    pub code: Range<usize>,
    pub source: String,
    /// The block waits for Render (`execution.mode === "deferred"`).
    pub deferred: bool,
}

/// `isMermaidCodeBlockLanguage`.
pub fn is_mermaid(language: &str) -> bool {
    matches!(language.trim().to_lowercase().as_str(), "mermaid" | "mmd")
}

/// `decideMarkdownBlockExecution("mermaid", …)`: `Some(deferred)` for a
/// diagram, `None` for one that stays source.
fn execution(source: &str, profile: DocumentProfile) -> Option<bool> {
    match decide_fence_execution(
        source,
        profile,
        RICH_BYTES,
        RICH_ITEMS,
        DEFERRED_MAX_BYTES,
        DEFERRED_MAX_ITEMS,
    ) {
        FenceExecution::Immediate => Some(false),
        FenceExecution::Deferred => Some(true),
        FenceExecution::FallbackToCode => None,
    }
}

/// The widget's commands: zoom, Render, and ShowSource change the pane's view;
/// Edit and Done move the caret into and out of the block.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum Action {
    Zoom {
        at: usize,
        percent: u16,
    },
    Activate {
        at: usize,
    },
    ShowSource {
        start: usize,
        end: usize,
        caret: usize,
    },
    Edit {
        at: usize,
    },
    Done {
        at: usize,
    },
}

impl MarkdownFeature for MermaidFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// Fences in a Mermaid language, before the code block feature (later
    /// in the composition) would show them as code.
    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        let units = cx.doc.as_str().encode_utf16().count();
        let profile = DocumentProfile::classify(units, cx.doc.line_count());
        for fence in &cx.syntax.fences {
            if !is_mermaid(&fence.language) {
                continue;
            }
            let source = cx.doc.slice(fence.code.clone()).to_owned();
            let Some(deferred) = execution(&source, profile) else {
                continue;
            };
            out.push(Plan {
                element: None,
                source: fence.range.clone(),
                presentation: Presentation::BlockAtom(BlockEmbed::new(
                    ID,
                    MermaidBlock {
                        range: fence.range.clone(),
                        code: fence.code.clone(),
                        source,
                        deferred,
                    },
                )),
                delete_units: Vec::new(),
            });
        }
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        let block = embed.model::<MermaidBlock>()?;
        Some(Rc::new(MermaidBlockWidget::new(
            block,
            cx.theme,
            cx.diagrams.get(block.range.start),
        )))
    }

    /// The fences are no caret position while the diagram shows.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<MermaidBlock>() {
            let (open, close) = fence_delimiter_ranges(&block.range, &block.code);
            cx.atomic(open);
            cx.atomic(close);
        }
    }

    fn command(&self, command: &Command, cx: &CommandCx) -> Option<Transaction> {
        match command.payload::<Action>()? {
            Action::Edit { at } => {
                let block = block_at(cx, *at)?;
                Some(Transaction::select(Selection::cursor(block.code.end)))
            }
            Action::Done { at } => {
                let block = block_at(cx, *at)?;
                Some(Transaction::select(Selection::cursor(block.range.end)))
            }
            _ => None,
        }
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        match *command.payload::<Action>()? {
            Action::Zoom { at, percent } => {
                preview.diagrams.update(at, |v| v.zoom = Some(percent));
                Some(Transaction::select(state.selection))
            }
            Action::Activate { at } => {
                preview.diagrams.update(at, |v| v.activated = true);
                Some(Transaction::select(state.selection))
            }
            Action::ShowSource { start, end, caret } => {
                let len = state.doc.len();
                preview.revealed_source = Some(start.min(len)..end.min(len));
                Some(Transaction::select(Selection::cursor(caret.min(len))))
            }
            Action::Edit { .. } | Action::Done { .. } => None,
        }
    }
}

fn block_at(cx: &CommandCx, at: usize) -> Option<MermaidBlock> {
    cx.plans
        .iter()
        .filter_map(|p| p.embed()?.model::<MermaidBlock>())
        .find(|b| b.range.start == at)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_mermaid_fence_is_a_diagram_and_other_fences_stay_code() {
        use crate::editor::markdown::{
            composition::FEATURES, core::plans, core::state::CalloutFolds,
        };
        use crate::editor::text::buffer::Buffer;
        let doc = Buffer::new("```mermaid\ngraph TD\n  A-->B\n```\n\n```js\nx\n```\n");
        let syntax = crate::editor::markdown::core::syntax::Syntax::parse(&doc);
        let compiled = plans::compile(&doc, &syntax, &CalloutFolds::default(), FEATURES);
        let embeds: Vec<&str> = compiled
            .iter()
            .filter_map(|p| p.embed())
            .map(|e| e.feature)
            .collect();
        assert_eq!(embeds, [ID, "code-block", "code-block"]);
        let block = compiled[0]
            .embed()
            .unwrap()
            .model::<MermaidBlock>()
            .unwrap();
        assert_eq!(block.source, "graph TD\n  A-->B");
        assert!(!block.deferred);
    }

    #[test]
    fn zoom_render_and_show_source_update_pane_view_state() {
        use crate::editor::markdown::core::state::DiagramViews;
        let mut views = DiagramViews::default();
        assert_eq!(views.get(10).zoom, None);
        views.update(10, |v| v.zoom = Some(150));
        views.update(10, |v| v.activated = true);
        assert_eq!(views.get(10).zoom, Some(150));
        assert!(views.get(10).activated);
        let mut preview = PreviewState::default();
        preview.diagrams = views;
        let state = EditorState::new("```mermaid\nA-->B\n```\n");
        let zoom = Command::new(
            ID,
            Action::Zoom {
                at: 10,
                percent: 80,
            },
        );
        assert!(FEATURE.view_command(&zoom, &mut preview, &state).is_some());
        assert_eq!(preview.diagrams.get(10).zoom, Some(80));

        let show = Command::new(
            ID,
            Action::ShowSource {
                start: 0,
                end: 20,
                caret: 11,
            },
        );
        assert!(FEATURE.view_command(&show, &mut preview, &state).is_some());
        assert_eq!(preview.revealed_source, Some(0..20));
    }

    #[test]
    fn mermaid_languages_and_budgets_follow_the_product() {
        assert!(is_mermaid("mermaid") && is_mermaid(" MMD ") && !is_mermaid("mermaidjs"));
        assert_eq!(
            execution("graph TD\n  A-->B\n", DocumentProfile::Normal),
            Some(false)
        );
        let large = "A-->B\n".repeat(1_200);
        assert_eq!(
            execution(&large, DocumentProfile::Normal),
            Some(true),
            "over the rich items, deferred"
        );
        let huge = "A-->B\n".repeat(5_000);
        assert_eq!(
            execution(&huge, DocumentProfile::Normal),
            None,
            "beyond the deferred ceiling"
        );
        assert_eq!(
            DocumentProfile::classify(2 * 1024 * 1024, 10),
            DocumentProfile::Large
        );
        assert_eq!(
            DocumentProfile::classify(10, 300_000),
            DocumentProfile::Extreme
        );
    }
}
