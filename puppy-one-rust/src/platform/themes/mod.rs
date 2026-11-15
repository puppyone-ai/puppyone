//! Installed Sub Themes: the Themes Folder, the product's theme contracts and
//! CSS compiler checks, and the palette projection for the native renderer.
//! The Application target changes native colours; the Markdown and CSV
//! targets (with the Application) cascade over the viewers' Neutral tokens
//! (`document`); Typography is validated like the product's.
pub mod compiler;
pub mod contract;
pub mod css;
pub mod document;
mod named_colors;
pub mod palette;
pub mod service;
pub mod value;
