//! GPUI presentation primitives and text input; no document or service ownership.
pub mod appearance;
pub mod components;
pub mod form_input;
mod fractional_text;
#[cfg(feature = "dev-capture")]
pub mod gallery;
pub mod input;
pub mod pulse_grid;
pub use fractional_text::fractional_text;
