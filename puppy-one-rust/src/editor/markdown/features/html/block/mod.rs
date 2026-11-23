//! HTML block sub-slice (`features/html/block/`): model, plan compilation, and widget.
pub mod model;
pub mod plan;
pub mod widget;

pub use model::{HtmlBlock, ShowSource, admission_failure};
pub use plan::{collect_blocks, compile_blocks};
pub use widget::HtmlBlockWidget;
