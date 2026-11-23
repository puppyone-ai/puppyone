//! Presentation helpers (product `core/presentation/`):
//! block rhythm, content-language reading weight, CSS class bitsets, and
//! source-mode syntax highlighting.
pub mod classes;
pub mod content_language;
pub mod rhythm;
pub mod source_highlight;

pub use classes::{Class, SourceSyntax};
pub use content_language::ReadingLanguage;
pub use rhythm::{LineRhythm, ListRhythm, block_rhythm, block_rhythm_in_lines};
