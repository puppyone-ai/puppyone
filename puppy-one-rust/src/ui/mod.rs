//! GPUI presentation primitives and text input; no document or service ownership.
pub mod agent_brands;
pub mod appearance;
#[cfg(feature = "dev-capture")]
pub mod asset_gallery;
pub mod components;
pub mod fonts;
pub mod form_input;
mod fractional_text;
#[cfg(feature = "dev-capture")]
pub mod gallery;
pub mod ime;
pub mod input;
pub mod loading;
pub mod motion;
pub mod resource_drag;
pub mod scrollbar;
pub use fractional_text::fractional_text;
