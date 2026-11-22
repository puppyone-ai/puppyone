//! Video (product features/video): an Obsidian `![[clip.mp4]]` embed alone
//! on its line is a player, its alias the title or `640x360` its size. The
//! system web engine decodes and draws the video and its controls through
//! [`crate::editor::markdown::platform::embed`]; workspace files exceeding the
//! `32 MiB` budget or missing on disk degrade visibly along
//! `Rendered -> Card Fallback -> Source` (`TA-52`). An embed beside text stays
//! source.
pub mod player;
mod widget;

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan, Presentation},
            state::PreviewState,
            syntax::Kind,
        },
        platform::policy::AssetFailure,
        shared::media_source::{MediaSource, parse_video_size, resolve_embed_media},
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{ops::Range, path::Path, rc::Rc};
use widget::VideoBlockWidget;

pub struct VideoFeature;
pub static FEATURE: VideoFeature = VideoFeature;
pub const ID: &str = "video";

/// Reveal the video embed's raw Markdown source line (`TA-52`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource(pub Range<usize>);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct VideoBlock {
    /// The embed's line.
    pub range: Range<usize>,
    /// The embed's target as written.
    pub href: String,
    /// The alias, unless it is a size.
    pub title: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl VideoBlock {
    /// `createMarkdownVideoModel` for an embed of `href` with `alias`.
    fn new(range: Range<usize>, href: String, alias: Option<&str>) -> Self {
        let parsed = alias.and_then(parse_video_size);
        Self {
            range,
            href,
            title: alias.filter(|_| parsed.is_none()).map(str::to_owned),
            width: parsed.map(|(w, _)| w),
            height: parsed.and_then(|(_, h)| h),
        }
    }

    /// `fallbackLabel`: what a video that cannot play says.
    pub fn label(&self) -> &str {
        self.title.as_deref().unwrap_or(&self.href)
    }
}

impl MarkdownFeature for VideoFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// `collectBlock`: a video embed that owns its whole line.
    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        for e in &cx.syntax.elements {
            if e.kind != Kind::VideoEmbed {
                continue;
            }
            let line = cx.doc.line_range(cx.doc.line_index(e.range.start));
            if !cx.doc.slice(line.start..e.range.start).trim().is_empty()
                || !cx.doc.slice(e.range.end..line.end).trim().is_empty()
            {
                continue;
            }
            let Some(href) = e.href.clone() else { continue };
            out.push(Plan {
                element: None,
                source: line.clone(),
                presentation: Presentation::BlockAtom(BlockEmbed::new(
                    ID,
                    VideoBlock::new(line, href, e.text.as_deref()),
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
        let block = embed.model::<VideoBlock>()?;
        let document = cx.assets.map(|a| a.document.clone()).unwrap_or_default();
        // Workspace files only: the engine never reaches past the project.
        let path = match resolve_embed_media(Path::new(&document), &block.href, cx.references) {
            Ok(MediaSource::Workspace(path)) => Ok(path),
            _ => Err(AssetFailure::Blocked),
        };
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
