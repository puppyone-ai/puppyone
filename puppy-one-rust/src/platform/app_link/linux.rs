//! Linux custom URL scheme registration via XDG `.desktop` entry + `xdg-mime`.
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

fn applications_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(dir).join("applications");
    }
    crate::platform::paths::home_dir().join(".local/share/applications")
}

/// Registers an XDG `.desktop` handler for `scheme://` when running from a
/// packaged binary (skips Cargo `target/` dev runs).
pub(super) fn register_scheme(scheme: &str) -> Result<(), String> {
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return Err(format!("Invalid URL scheme: {scheme}"));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if exe.components().any(|c| c.as_os_str() == "target") {
        return Ok(());
    }
    let desktop_name = format!("{scheme}-handler.desktop");
    let dir = applications_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let desktop_path = dir.join(&desktop_name);
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=PuppyOne\nExec=\"{}\" %u\nTerminal=false\nNoDisplay=true\nMimeType=x-scheme-handler/{scheme};\n",
        exe.display()
    );
    std::fs::write(&desktop_path, content).map_err(|e| e.to_string())?;
    let _ = Command::new("xdg-mime")
        .args([
            "default",
            &desktop_name,
            &format!("x-scheme-handler/{scheme}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    Ok(())
}
