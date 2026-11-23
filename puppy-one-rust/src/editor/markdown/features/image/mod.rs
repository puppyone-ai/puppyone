//! Images (product `features/image` and `media`): `![alt](src "title")`,
//! reference images and Obsidian `![[image|size]]` embeds show the image
//! in a line made only of images (or images wrapped in links). Model and
//! sizing live in [`model`], line extraction/classification in [`plan`], and
//! the pure-image line widget in [`widget`].
pub mod model;
pub mod plan;
mod widget;

pub use model::ShowSource;
#[cfg(test)]
pub(crate) use model::fit as fit_for_tests;

use crate::editor::{
    markdown::{
        core::{
            decorations::{InlineDecoration, LineDecoration},
            features::MarkdownFeature,
            state::PreviewState,
        },
        platform::brokers::assets::{self as asset_broker, AssetState},
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, decoration::InlineImage, style::Embed},
};
use crate::render_service::Rendered;
use gpui::SharedString;
use model::Item;
use std::{
    hash::{Hash, Hasher},
    path::PathBuf,
    rc::Rc,
};
use widget::ImageEmbed;

pub struct ImageFeature;
pub static FEATURE: ImageFeature = ImageFeature;
pub const ID: &str = "image";

/// The x-height of the body face, in ems.
const X_HEIGHT: f32 = 0.5;

/// `.cm-md-image-widget` in a line with text: each image drawn where its
/// source is, its alt text (or failure summary) standing in until it decodes.
fn inline(cx: &mut InlineDecoration, items: Vec<Item>) {
    let radius = cx.theme.block.radius;
    for item in items {
        if cx.preview.reveal.as_ref() == Some(&item.image) {
            continue;
        }
        let source = match item.source {
            Ok(source) => source,
            Err(failure) => {
                let summary = widget::describe_failure(&item.label, &failure);
                cx.replaced.push((
                    item.image.clone(),
                    SharedString::from(format!("[{} — {}]", summary.title, summary.reason)),
                ));
                continue;
            }
        };
        let assets = cx.assets.cloned();
        let size = item.size;
        cx.replaced
            .push((item.image.clone(), SharedString::from(item.label)));
        cx.inline_images.push(InlineImage {
            range: item.image,
            pad: 0.,
            radius,
            element: None,
            draw: Rc::new(move |_, column, font, _, app| {
                let AssetState::Ready {
                    image,
                    width,
                    height,
                } = asset_broker::get(&source, assets.as_ref(), app)
                else {
                    return None;
                };
                let (width, height) = model::fit(size, false, (width, height), column);
                Some(Rendered {
                    image,
                    width,
                    height,
                    baseline: height / 2. + X_HEIGHT / 2. * font,
                })
            }),
        });
    }
}

impl MarkdownFeature for ImageFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let show = command.payload::<ShowSource>()?;
        let len = state.doc.len();
        preview.revealed_source = Some(show.line.start.min(len)..show.line.end.min(len));
        Some(Transaction::select(Selection::cursor(show.caret.min(len))))
    }

    fn decorate_inline_content(&self, cx: &mut InlineDecoration) {
        let document: PathBuf = cx.assets.map(|a| a.document.clone()).unwrap_or_default();
        let (items, _) = plan::collect_items(
            cx.doc,
            cx.syntax,
            cx.range.clone(),
            &document,
            cx.references,
        );
        inline(cx, items);
    }

    /// A line of images shows them in place of its text.
    fn decorate_line(&self, cx: &mut LineDecoration) {
        let range = cx.range.clone();
        let mut content = cx.inline_content();
        let document: PathBuf = content
            .assets
            .map(|a| a.document.clone())
            .unwrap_or_default();
        let (items, mixed) = plan::collect_items(
            content.doc,
            content.syntax,
            content.range.clone(),
            &document,
            content.references,
        );
        if items.is_empty() {
            return;
        }
        if mixed {
            inline(&mut content, items);
            return;
        }
        let block = plan::is_block_line(cx.doc, range.start, &items);
        let shown = items[0].range.start..items.last().map_or(range.end, |i| i.range.end);
        cx.hidden.push(shown);
        let mut h = std::hash::DefaultHasher::new();
        (range.start, block).hash(&mut h);
        for i in &items {
            let source_key = i.source.as_ref().ok().map(|s| s.key(cx.assets));
            (
                &i.range,
                &source_key,
                &i.source.is_ok(),
                &i.link,
                &i.label,
                i.size.map(|(w, h)| (w.to_bits(), h.map(f32::to_bits))),
            )
                .hash(&mut h);
        }
        cx.style.embed = Some(Embed {
            key: h.finish(),
            content: Rc::new(ImageEmbed {
                items,
                block,
                line: range,
                assets: cx.assets.cloned(),
                radius: cx.theme.block.radius,
                hover_ring: cx.theme.block.hover_ring,
                selected_ring: cx.theme.block.selected_ring,
                ring_width: cx.theme.block.ring_width,
                text: cx.style.text.clone(),
                dark: cx.theme.dark,
            }),
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::editor::markdown::shared::media::split_image_alt;
    use core::prelude::v1::test;

    #[test]
    fn sizes_follow_the_alt_text() {
        assert_eq!(
            split_image_alt("Logo|300"),
            ("Logo".into(), Some((300., None)))
        );
        assert_eq!(
            split_image_alt("Logo | 300x200"),
            ("Logo".into(), Some((300., Some(200.))))
        );
        assert_eq!(split_image_alt("a|b"), ("a|b".into(), None));
    }
}
