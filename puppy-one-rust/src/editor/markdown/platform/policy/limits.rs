//! Security-relevant recursion and parsing limits (`platform/policy/limits.rs`,
//! `TA-51`).
pub use super::html_profiles::MAX_HTML_DEPTH;

/// Maximum recursion depth for TeX group/command conversion (`TA-51`, `TODO-36`).
pub const MAX_TEX_DEPTH: usize = 64;
