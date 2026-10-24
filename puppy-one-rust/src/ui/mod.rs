//! GPUI presentation primitives and text input; no document or service ownership.
pub mod appearance;
mod exact_text;
pub mod form_input;
mod fractional_text;
pub mod input;
pub mod menu;
mod primitives;
pub mod pulse_grid;
pub use exact_text::exact_text;
pub use fractional_text::fractional_text;
pub use primitives::*;
