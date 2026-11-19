//! Opt-in discovery outside the normal shell environment. Never change the OS PATH.
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

fn valid(path: &Path, platform: &str) -> bool {
    let Some(text) = path.to_str() else {
        return false;
    };
    if !path.is_absolute() || text.len() > 4096 || text.contains(['\r', '\n', '\0']) {
        return false;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if platform == "win32" {
        ["codex.exe", "codex.cmd"]
            .iter()
            .any(|n| name.eq_ignore_ascii_case(n))
    } else {
        name == "codex"
    }
}

fn record(home: &Path) -> PathBuf {
    home.join(".puppyone/agent-runtimes/codex/rust-cli-path")
}

pub(crate) fn saved(home: &Path, platform: &str) -> Option<PathBuf> {
    if !home.is_absolute() {
        return None;
    }
    let file = record(home);
    let metadata = file.symlink_metadata().ok()?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return None;
    }
    let mut value = String::new();
    File::open(file)
        .ok()?
        .take(4097)
        .read_to_string(&mut value)
        .ok()?;
    let path = PathBuf::from(value);
    valid(&path, platform).then_some(path)
}

pub(crate) fn remember(home: &Path, path: &Path, platform: &str) -> io::Result<()> {
    if !home.is_absolute() || !valid(path, platform) {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let target = record(home);
    let dir = target.parent().unwrap();
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!("rust-cli-path.{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    let result = (|| {
        file.write_all(path.to_str().unwrap().as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub(crate) fn candidates(
    home: &Path,
    platform: &str,
    inherited: &BTreeMap<String, String>,
    selected: Option<PathBuf>,
    workspace: &Path,
) -> Vec<PathBuf> {
    if let Some(file) = selected {
        return vec![file]
            .into_iter()
            .filter(|p| valid(p, platform) && p.is_file())
            .collect();
    }
    let mut dirs = Vec::new();
    if let Some(path) = inherited.get("PATH").or_else(|| inherited.get("Path")) {
        dirs.extend(std::env::split_paths(path).take(256));
    }
    match platform {
        "darwin" => {
            dirs.extend(
                [".volta/bin", ".npm-global/bin", ".local/share/pnpm"].map(|p| home.join(p)),
            );
            let versions = home.join(".nvm/versions/node");
            if let Ok(entries) = fs::read_dir(versions) {
                let mut bins: Vec<_> = entries
                    .take(32)
                    .flatten()
                    .map(|e| e.path().join("bin"))
                    .collect();
                bins.sort();
                dirs.extend(bins.into_iter().rev());
            }
            dirs.extend(
                [
                    "/opt/homebrew/bin",
                    "/usr/local/bin",
                    "/Applications/Codex.app/Contents/Resources",
                ]
                .map(PathBuf::from),
            );
            dirs.push(home.join("Applications/Codex.app/Contents/Resources"));
        }
        "win32" => {
            if let Some(appdata) = inherited.get("APPDATA") {
                dirs.push(Path::new(appdata).join("npm"));
            }
            if let Some(local) = inherited.get("LOCALAPPDATA") {
                dirs.push(Path::new(local).join("Programs/OpenAI/Codex/bin"));
                dirs.push(Path::new(local).join("Volta/bin"));
            }
        }
        _ => return Vec::new(),
    }
    let workspace = workspace.canonicalize().ok();
    let mut out = Vec::new();
    for dir in dirs.into_iter().filter(|p| p.is_absolute()) {
        let names: &[&str] = if platform == "win32" {
            &["codex.exe", "codex.cmd"]
        } else {
            &["codex"]
        };
        for name in names {
            let file = dir.join(name);
            if !valid(&file, platform) || !file.is_file() || out.contains(&file) {
                continue;
            }
            // Never auto-run a program supplied by the currently open project.
            let Ok(target) = file.canonicalize() else {
                continue;
            };
            if workspace
                .as_ref()
                .is_some_and(|root| target.starts_with(root))
            {
                continue;
            }
            out.push(file);
            if out.len() == 8 {
                return out;
            }
        }
    }
    out
}

/// A wrapper may need a sibling interpreter. Keep the authoritative search order.
pub(crate) fn launch_path(path: &Path, original: &str) -> Option<String> {
    let parent = path.parent()?;
    let mut dirs: Vec<_> = std::env::split_paths(original)
        .filter(|p| p.is_absolute())
        .collect();
    if !dirs.iter().any(|p| p == parent) {
        dirs.push(parent.into());
    }
    std::env::join_paths(dirs).ok()?.into_string().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repair_checks_user_installations_for_each_platform() {
        let profile = tempfile::tempdir().unwrap();
        let home = profile.path();
        let mac = home.join(".nvm/versions/node/v24/bin/codex");
        let win = home.join("Roaming/npm/codex.cmd");
        for file in [&mac, &win] {
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, b"fixture").unwrap();
        }
        let env = BTreeMap::from([("APPDATA".into(), home.join("Roaming").display().to_string())]);
        let work = home.join("workspace");
        let search = |os| candidates(home, os, &env, None, &work);
        assert!(search("darwin").contains(&mac));
        assert!(!search("darwin").contains(&win));
        assert!(search("win32").contains(&win));
        assert!(!search("win32").contains(&mac));
    }
}
