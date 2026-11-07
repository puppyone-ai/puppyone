pub mod application;
pub mod domain;
#[cfg(any(test, feature = "dev-capture"))]
pub mod fixtures;
pub mod infrastructure;
pub mod ui;
pub use ui::panel::bind_keys;
