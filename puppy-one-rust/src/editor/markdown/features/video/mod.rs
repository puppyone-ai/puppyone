//! Video (product `features/video`): an Obsidian `![[clip.mp4]]` embed alone
//! on its line is a player, its alias the title or `640x360` its size. Model
//! lives in [`model`], plan compilation in [`plan`], widget in [`widget`], and
//! `WebHost` media pooling in [`crate::editor::markdown::platform::brokers::embed`].
pub mod model;
pub mod plan;
mod widget;

pub use model::{ShowSource, VideoBlock};

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan},
        state::PreviewState,
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{path::Path, rc::Rc};
use widget::VideoBlockWidget;

pub struct VideoFeature;
pub static FEATURE: VideoFeature = VideoFeature;
pub const ID: &str = "video";

impl MarkdownFeature for VideoFeature {
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
        let block = embed.model::<VideoBlock>()?;
        let document = cx.assets.map(|a| a.document.clone()).unwrap_or_default();
        // Workspace files only: the engine never reaches past the project.
        let path = model::resolve_workspace_video(Path::new(&document), &block.href, cx.references);
        Some(Rc::new(VideoBlockWidget::new(
            block.clone(),
            path,
            cx.assets.cloned(),
            cx.theme,
        )))
    }

    /// The embed is one caret stop while the player shows.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<VideoBlock>() {
            cx.atomic(block.range.clone());
        }
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let ShowSource(range) = command.payload::<ShowSource>()?;
        let len = state.doc.len();
        preview.revealed_source = Some(range.start.min(len)..range.end.min(len));
        Some(Transaction::select(Selection::cursor(range.start.min(len))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::markdown::shared::media::parse_video_size;
    use core::prelude::v1::test;

    fn embeds(text: &str) -> Vec<VideoBlock> {
        use crate::editor::markdown::{
            composition::FEATURES, core::plans, core::state::FeatureStateStore,
        };
        use crate::editor::text::buffer::Buffer;
        let doc = Buffer::new(text);
        let syntax = crate::editor::markdown::core::syntax::Syntax::parse_with(&doc, FEATURES);
        plans::compile(&doc, &syntax, &FeatureStateStore::default(), FEATURES)
            .iter()
            .filter_map(|p| p.embed()?.model::<VideoBlock>().cloned())
            .collect()
    }

    #[test]
    fn a_video_embed_alone_on_its_line_is_a_player() {
        let text = "![[clip.mp4]]\n\nsee ![[clip.mp4]] here\n\n![[demo.webm|640x360]]\n\n![[a.mov|Intro]]\n";
        let blocks = embeds(text);
        assert_eq!(blocks.len(), 3, "beside text it stays source");
        assert_eq!(blocks[0].range, 0..13);
        assert_eq!(blocks[0].label(), "clip.mp4");
        assert_eq!((blocks[1].width, blocks[1].height), (Some(640), Some(360)));
        assert_eq!(blocks[1].title, None);
        assert_eq!(blocks[2].title.as_deref(), Some("Intro"));
        assert!(embeds("![[a.png]]\n\n![[notes.md]]\n").is_empty());
    }

    #[test]
    fn sizes_follow_the_product() {
        assert_eq!(parse_video_size("640"), Some((640, None)));
        assert_eq!(parse_video_size(" 640x360 "), Some((640, Some(360))));
        assert_eq!(parse_video_size("0"), None);
        assert_eq!(parse_video_size("5000"), None);
        assert_eq!(parse_video_size("12345"), None);
        assert_eq!(parse_video_size("wide"), None);
    }
}
