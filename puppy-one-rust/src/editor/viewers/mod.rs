//! Viewer surfaces: what each built-in viewer contribution
//! (`editor::registry::builtin`) opens. One module per surface; a surface
//! implements `ViewerSurface` and knows nothing of the registry or the host.
pub mod code;
pub mod csv;
pub mod database;
pub mod external;
pub mod html;
pub mod html_visual;
pub mod image;
pub mod media;
pub mod office;
pub mod pdf;
pub mod placeholder;
pub mod text;
pub mod web;
