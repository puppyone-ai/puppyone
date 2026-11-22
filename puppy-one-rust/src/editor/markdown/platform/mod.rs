//! Markdown platform capability layer (`TA-42`, `TA-50`, `TA-51`, `TA-52`):
//! brokers (`assets`, `render`, `embed`, `link`) and centralized `policy`.
//! Never imports `markdown::features` or `markdown::composition` (`R7`).
pub mod assets;
pub mod embed;
pub mod link;
pub mod policy;
pub mod render;
