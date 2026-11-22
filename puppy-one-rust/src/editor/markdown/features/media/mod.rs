//! Media embed syntax feature slice (product `features/media/mediaSyntaxFeature.ts`):
//! recognizes Obsidian `![[image]]` and `![[video]]` embeds via `recognize_inline`.
pub mod syntax;

use crate::editor::markdown::core::{features::MarkdownFeature, syntax::Element};

pub struct MediaFeature;
pub static FEATURE: MediaFeature = MediaFeature;
pub const ID: &str = "media";

impl MarkdownFeature for MediaFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn recognize_inline(&self, line_start: usize, line_text: &str, out: &mut Vec<Element>) {
        syntax::recognize_media_embeds(line_start, line_text, out);
    }
}
