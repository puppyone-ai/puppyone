//! Render plans (`TA-32`, `TA-33`, product `core/plans/`):
//! each semantic element compiles to how it is presented, cached per top-level
//! block and incrementally spliced across `SyntaxSplice` windows so typing in
//! paragraph 500 only recompiles plans in paragraph 500's block window.
pub mod compiler;
pub mod execution;
pub mod incremental;
pub mod index;
pub mod primitives;
pub mod types;

pub use compiler::{compile, compile_blocks_in_window, window_syntax_view};
pub use incremental::{
    append_shifted_tail, compile_incremental, compile_incremental_in_place,
    refresh_shifted_block_plans,
};
pub use index::PlanCache;
pub use types::{Atom, BlockEmbed, Plan, Presentation};
