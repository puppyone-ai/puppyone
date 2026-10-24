//! Executable lookup shared by native Agent and PTY hosts.
use std::path::PathBuf;
pub(crate) fn search_dirs() -> Vec<PathBuf> {
    let mut dirs =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect::<Vec<_>>();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.extend([
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".bun/bin"),
            home.join(".opencode/bin"),
            home.join(".hermes/node/bin"),
        ]);
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions = entries
                .flatten()
                .map(|e| e.path().join("bin"))
                .collect::<Vec<_>>();
            versions.sort();
            versions.reverse();
            dirs.extend(versions);
        }
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    dirs
}
pub fn search_path() -> std::ffi::OsString {
    std::env::join_paths(search_dirs()).unwrap_or_default()
}
/// Preferred OS languages, most preferred first (BCP 47 tags as reported).
/// macOS GUI apps rarely inherit `LANG`, so `AppleLanguages` is consulted once.
/// `PUPPYONE_LOCALE` stands in for the OS choice (captures, manual checks).
pub fn system_languages() -> &'static [String] {
    static LANGUAGES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    LANGUAGES.get_or_init(|| {
        let mut languages = vec![];
        if let Ok(tag) = std::env::var("PUPPYONE_LOCALE") {
            languages.push(tag);
        }
        #[cfg(target_os = "macos")]
        if let Ok(output) = std::process::Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleLanguages"])
            .stderr(std::process::Stdio::null())
            .output()
        {
            languages.extend(
                String::from_utf8_lossy(&output.stdout)
                    .split(['\n', ','])
                    .map(|l| l.trim().trim_matches(['(', ')', '"', ' ']).to_owned())
                    .filter(|l| !l.is_empty()),
            );
        }
        for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
            if let Ok(value) = std::env::var(key) {
                let tag = value
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .replace('_', "-");
                if !tag.is_empty() && tag != "C" && tag != "POSIX" {
                    languages.push(tag);
                }
            }
        }
        languages
    })
}
