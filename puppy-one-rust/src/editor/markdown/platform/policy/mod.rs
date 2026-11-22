//! Centralized Markdown security & resource policies (`platform/policy/`,
//! `MA-14`, `TA-50`, `TA-51`, `TA-52`, `R15`).
pub mod asset;
pub mod html_profiles;
pub mod limits;
pub mod network;
pub mod svg;
pub mod url;

pub use asset::{
    AssetFailure, ContentStamp, DATA_URL_MAX_BYTES, DATA_URL_MAX_ENCODED_LEN,
    MAX_REMOTE_IMAGE_BYTES, MAX_WORKSPACE_ASSET_BYTES, local_workspace_root,
    resolve_image_reference, validate_data_image_url, verify_workspace_file,
};
pub use html_profiles::{
    BLOCKED_TAGS, DROPPED_WITH_CONTENT, HTML_MAX_DEPTH, MAX_HTML_DEPTH, is_blocked_html_tag,
    is_blocked_tag,
};
pub use limits::MAX_TEX_DEPTH;
pub use network::{
    ValidatedEndpoint, build_pinned_https_client, is_public_ip, redirect_allowed,
    resolve_public_endpoint,
};
pub use svg::{SVG_SCALE, rasterize_svg};
pub use url::{allowed_https_href, allowed_https_url, safe_href};
