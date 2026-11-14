//! Video (product features/video): an Obsidian `![[clip.mp4]]` embed alone
//! on its line is a player, its alias the title or `640x360` its size. The
//! system web engine decodes and draws the video and its controls (as the
//! video viewer does); the file streams from the workspace. An embed beside
//! text stays source.
mod player;
mod widget;

use crate::editor::markdown::{
    core::{
        decorations::BlockDecoration,
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
        syntax::Kind,
    },
    features::image::source,
};
use crate::editor::view::widget::BlockWidget;
use std::{ops::Range, rc::Rc};
use widget::VideoBlockWidget;

pub struct VideoFeature;
pub static FEATURE: VideoFeature = VideoFeature;
pub const ID: &str = "video";

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

/// `parseVideoSize`: `640` or `640x360`, each 1 to 4096.
fn size(value: &str) -> Option<(u32, Option<u32>)> {
    let (w, h) = match value.trim().split_once('x') {
        Some((w, h)) => (w, Some(h)),
        None => (value.trim(), None),
    };
    let number = |s: &str| {
        (!s.is_empty() && s.len() <= 4 && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse::<u32>().ok())
            .flatten()
            .filter(|n| (1..=4096).contains(n))
    };
    Some((
        number(w)?,
        match h {
            Some(h) => Some(number(h)?),
            None => None,
        },
    ))
}

impl VideoBlock {
    /// `createMarkdownVideoModel` for an embed of `href` with `alias`.
    fn new(range: Range<usize>, href: String, alias: Option<&str>) -> Self {
        let parsed = alias.and_then(size);
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
        let path = match source::embed(&document, &block.href, cx.references) {
            Some(source::Source::Workspace(path)) => Some(path),
            _ => None,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn embeds(text: &str) -> Vec<VideoBlock> {
        use crate::editor::markdown::{
            composition::FEATURES, core::plans, core::state::CalloutFolds,
        };
        use crate::editor::text::buffer::Buffer;
        let doc = Buffer::new(text);
        let syntax = crate::editor::markdown::core::syntax::Syntax::parse(&doc);
        plans::compile(&doc, &syntax, &CalloutFolds::default(), FEATURES)
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
        // Images and other files are not videos.
        assert!(embeds("![[a.png]]\n\n![[notes.md]]\n").is_empty());
    }

    #[test]
    fn sizes_follow_the_product() {
        assert_eq!(size("640"), Some((640, None)));
        assert_eq!(size(" 640x360 "), Some((640, Some(360))));
        assert_eq!(size("0"), None);
        assert_eq!(size("5000"), None);
        assert_eq!(size("12345"), None);
        assert_eq!(size("wide"), None);
    }
}
