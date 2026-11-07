//! Document sessions and the editing kernels (Markdown, CSV, code, tables),
//! the viewers and the web content host.
// Kit is the single public UI dependency, GPUI macros included.
extern crate gpui_kit as gpui;
#[cfg(all(test, target_os = "macos"))]
#[path = "../../src/bench.rs"]
mod bench;
#[path = "../../src/documents/mod.rs"]
pub mod documents;
#[path = "../../src/editor/mod.rs"]
pub mod editor;
#[path = "../../src/web_host.rs"]
pub mod web_host;

// The modules below this crate, under the names the sources use.
pub(crate) use po_contracts::{formats, model, wake};
pub(crate) use po_platform::{localization, platform};
pub(crate) use po_ui::{assets, theme, typography, ui};
pub(crate) use po_workspace::{cloud, workspace};
