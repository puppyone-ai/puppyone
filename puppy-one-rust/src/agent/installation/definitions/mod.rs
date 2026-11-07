//! `local-agent-installation/definitions`: each product's executable names,
//! candidate paths and identity policy.
pub mod claude;
pub mod codex;
pub mod cursor;
pub mod hermes;
pub mod opencode;
pub mod pi;
pub mod workbuddy;

/// `platform === "win32" ? `${name}.exe` : name`.
pub(crate) fn executable_name(name: &str, platform: &str) -> String {
    if platform == "win32" {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// `path.join(...segments)` as text.
pub(crate) fn join(base: impl AsRef<std::path::Path>, segments: &[&str]) -> String {
    let mut path = base.as_ref().to_path_buf();
    for segment in segments {
        path.push(segment);
    }
    crate::platform::paths::normalize(&path)
        .to_string_lossy()
        .into_owned()
}
