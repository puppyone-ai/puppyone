//! Mermaid (product `features/mermaid`, `TA-40`): a fence labelled `mermaid` or
//! `mmd` shows its diagram, drawn through [`crate::editor::markdown::platform::brokers::render`].
//! Model & budget classification live in [`model`], plan compilation in [`plan`],
//! pane state in [`state`], viewport scaling in [`viewport`], and UI in [`controls`]/[`widget`].
mod controls;
pub mod model;
pub mod plan;
pub mod state;
pub mod viewport;
#[cfg(test)]
pub(crate) mod widget;
#[cfg(not(test))]
mod widget;

pub use model::{MermaidBlock, is_mermaid};
pub use state::{DiagramView, MermaidState};

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            features::{CommandCx, CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan},
            state::PreviewState,
        },
        shared::fence::fence_delimiter_ranges,
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::rc::Rc;
use widget::MermaidBlockWidget;

pub struct MermaidFeature;
pub static FEATURE: MermaidFeature = MermaidFeature;
pub const ID: &str = "mermaid";

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

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        plan::compile_blocks(cx, out);
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        let block = embed.model::<MermaidBlock>()?;
        let view = cx
            .feature_state::<MermaidState>(ID)
            .map_or_else(DiagramView::default, |s| s.get(block.range.start));
        Some(Rc::new(MermaidBlockWidget::new(block, cx.theme, view)))
    }

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
                let block = plan::block_at(cx, *at)?;
                Some(Transaction::select(Selection::cursor(block.code.end)))
            }
            Action::Done { at } => {
                let block = plan::block_at(cx, *at)?;
                let doc_len = cx.state.doc.len();
                let target = if block.range.end < doc_len {
                    (block.range.end + 1).min(doc_len)
                } else if block.range.start > 0 {
                    block.range.start - 1
                } else {
                    block.range.end
                };
                Some(Transaction::select(Selection::cursor(target)))
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
        let rev = state.revision;
        match *command.payload::<Action>()? {
            Action::Zoom { at, percent } => {
                preview
                    .state_mut::<MermaidState>(ID)
                    .update(at, rev, |v| v.zoom = Some(percent));
                Some(Transaction::select(state.selection))
            }
            Action::Activate { at } => {
                preview
                    .state_mut::<MermaidState>(ID)
                    .update(at, rev, |v| v.activated = true);
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

#[cfg(test)]
mod tests {
    use super::{model::execution, *};
    use crate::editor::markdown::core::plans::DocumentProfile;
    use core::prelude::v1::test;

    #[test]
    fn a_mermaid_fence_is_a_diagram_and_other_fences_stay_code() {
        use crate::editor::markdown::{
            composition::FEATURES, core::plans, core::state::FeatureStateStore,
        };
        use crate::editor::text::buffer::Buffer;
        let doc = Buffer::new("```mermaid\ngraph TD\n  A-->B\n```\n\n```js\nx\n```\n");
        let syntax = crate::editor::markdown::core::syntax::Syntax::parse(&doc);
        let compiled = plans::compile(&doc, &syntax, &FeatureStateStore::default(), FEATURES);
        let embeds: Vec<&str> = compiled
            .iter()
            .filter_map(|p| p.embed())
            .map(|e| e.feature)
            .collect();
        assert_eq!(embeds, [ID, "code-block"]);
        let code = compiled
            .iter()
            .find_map(|p| {
                p.embed()?
                    .model::<crate::editor::markdown::features::code_block::CodeBlock>()
            })
            .unwrap();
        assert_eq!(code.language, "js");
        assert_eq!(doc.slice(code.code.clone()).trim(), "x");
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
        let mut views = MermaidState::default();
        assert_eq!(views.get(10).zoom, None);
        views.update(10, 0, |v| v.zoom = Some(150));
        views.update(10, 0, |v| v.activated = true);
        assert_eq!(views.get(10).zoom, Some(150));
        assert!(views.get(10).activated);
        let mut preview = PreviewState::default();
        *preview.state_mut::<MermaidState>(ID) = views;
        let state = EditorState::new("```mermaid\nA-->B\n```\n");
        let zoom = Command::new(
            ID,
            Action::Zoom {
                at: 10,
                percent: 80,
            },
        );
        assert!(FEATURE.view_command(&zoom, &mut preview, &state).is_some());
        assert_eq!(
            preview.state::<MermaidState>(ID).unwrap().get(10).zoom,
            Some(80)
        );

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
