//! Viewer surfaces: what each built-in viewer contribution
//! (`editor::registry::builtin`) opens. One module per surface; a surface
//! implements `ViewerSurface` and knows nothing of the registry or the host.
pub mod csv;
pub mod external;
pub mod image;
pub mod placeholder;
pub mod text;
