//! GPUI presentation primitives and text input; no document or service ownership.
pub mod appearance;
pub mod components;
pub mod form_input;
mod fractional_text;
#[cfg(feature = "dev-capture")]
pub mod gallery;
pub mod ime;
pub mod input;
pub mod motion;
pub mod pulse_grid;
mod tracked_text;
pub use fractional_text::fractional_text;
pub use tracked_text::tracked_text;
