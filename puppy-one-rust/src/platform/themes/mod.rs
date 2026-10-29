//! Installed Sub Themes: the Themes Folder, the product's theme contracts and
//! CSS compiler checks, and the palette projection for the native renderer.
//! Only the Application target changes native colours; Typography, Markdown
//! and CSV targets are validated like the product's (the native Markdown and
//! CSV views still read the Neutral profile, for built-in themes too).
pub mod compiler;
pub mod contract;
pub mod css;
mod named_colors;
pub mod palette;
pub mod service;
pub mod value;
