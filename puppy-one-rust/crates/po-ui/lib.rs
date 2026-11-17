//! The GPUI component library, the theme and typography, and the bundled
//! assets.
// Kit is the single public UI dependency, GPUI macros included.
extern crate gpui_kit as gpui;
#[path = "../../src/assets.rs"]
pub mod assets;
#[path = "../../src/theme.rs"]
pub mod theme;
#[path = "../../src/typography/mod.rs"]
pub mod typography;
#[path = "../../src/ui/mod.rs"]
pub mod ui;

// The modules below this crate, under the names the sources use.
pub(crate) use po_contracts::{asset_catalog, file_kind};
pub(crate) use po_platform::localization;
pub(crate) use po_workspace::workspace;
