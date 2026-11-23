//! Markdown platform capability brokers (`platform/brokers/`, `MA-09`, `MA-14`):
//! - `assets`: async, cancellable, bounded LRU image/SVG loader;
//! - `render`: Mermaid / KaTeX render service coordinator;
//! - `embed`: per-window bounded `WebHost` pool for local media and `https:` iframes;
//! - `link`: controlled link/embed target validation and execution port.
pub mod assets;
pub mod embed;
pub mod link;
pub mod render;
