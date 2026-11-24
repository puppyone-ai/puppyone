//! HTML block sub-slice (`features/html/block/`): model, plan compilation, and widget.
pub mod model;
pub mod plan;
pub mod state;
pub mod widget;

pub use model::{HtmlBlock, RenderDeferred, ShowSource, admission_failure};
pub use plan::{collect_blocks, compile_blocks};
pub use state::HtmlState;
pub use widget::HtmlBlockWidget;
