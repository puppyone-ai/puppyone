//! Workspace-scoped native tools. Mutations and commands require a turn-owned approval.
use cap_std::fs::Dir;
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Component, Path},
    sync::atomic::AtomicBool,
};
pub fn schema() -> Value {
    json!([
      {"type":"function","function":{"name":"read","description":"Read a UTF-8 file inside the assigned workspace.","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}}},
      {"type":"function","function":{"name":"ls","description":"List one workspace directory.","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}}},
      {"type":"function","function":{"name":"grep","description":"Search UTF-8 workspace files for a literal substring; bounded results with line numbers.","parameters":{"type":"object","properties":{"path":{"type":"string"},"query":{"type":"string"}},"required":["path","query"],"additionalProperties":false}}},
      {"type":"function","function":{"name":"find","description":"Find workspace paths containing a literal name fragment.","parameters":{"type":"object","properties":{"path":{"type":"string"},"query":{"type":"string"}},"required":["path","query"],"additionalProperties":false}}},
      {"type":"function","function":{"name":"write","description":"Write a UTF-8 workspace file after user approval.","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"],"additionalProperties":false}}},
      {"type":"function","function":{"name":"edit","description":"Replace exactly one matching text in a workspace file after approval.","parameters":{"type":"object","properties":{"path":{"type":"string"},"old_text":{"type":"string"},"new_text":{"type":"string"}},"required":["path","old_text","new_text"],"additionalProperties":false}}},
      {"type":"function","function":{"name":"bash","description":"Run an explicitly approved shell command with the workspace as cwd. Use read/ls for inspection when possible.","parameters":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}}}
    ])
}
pub fn approval(name: &str) -> bool {
    !matches!(name, "read" | "ls" | "grep" | "find")
}
fn relative(value: &Value) -> Result<&Path, String> {
    let path = Path::new(value["path"].as_str().ok_or("Tool path is required")?);
    if path.is_absolute()
        || path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Tool path must stay inside the assigned workspace".into());
    }
    Ok(path)
}
pub fn execute(
    root: &Path,
    name: &str,
    args: &Value,
    cancel: &AtomicBool,
) -> Result<String, String> {
    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("Turn stopped".into());
    }
    if name == "bash" {
        let command = args["command"].as_str().ok_or("Command is required")?;
        if command.len() > 64000 {
            return Err("Command is too long".into());
        }
        // env -i strips provider credentials from child commands; the API key is never in this process environment.
        let path = format!(
            "PATH={}",
            crate::platform::environment::search_path().to_string_lossy()
        );
        let home = format!("HOME={}", std::env::var("HOME").unwrap_or_default());
        return crate::platform::process::run(
            Path::new("/usr/bin/env"),
            &[
                "-i",
                &path,
                &home,
                "LANG=en_US.UTF-8",
                "/bin/bash",
                "-c",
                command,
            ],
            root,
            None,
            std::time::Duration::from_secs(120),
            cancel,
        )
        .map(|b| String::from_utf8_lossy(&b).chars().take(64000).collect());
    }
    let dir =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|e| e.to_string())?;
    let path = relative(args)?;
    match name {
        "grep" | "find" => search(
            &dir,
            path,
            args["query"].as_str().ok_or("Search query is required")?,
            name == "grep",
            cancel,
        ),
        "read" => read(&dir, path),
        "ls" => Ok(dir
            .read_dir(path)
            .map_err(|e| e.to_string())?
            .take(500)
            .filter_map(Result::ok)
            .map(|e| {
                format!(
                    "{}{}",
                    e.file_name().to_string_lossy(),
                    if e.file_type().is_ok_and(|t| t.is_dir()) {
                        "/"
                    } else {
                        ""
                    }
                )
            })
            .collect::<Vec<_>>()
            .join("\n")),
        "write" | "edit" => {
            let content = if name == "write" {
                args["content"]
                    .as_str()
                    .ok_or("Content is required")?
                    .to_owned()
            } else {
                let old = read(&dir, path)?;
                let from = args["old_text"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("Nonempty old_text is required")?;
                if old.matches(from).count() != 1 {
                    return Err(
                        "Edit needs exactly one matching occurrence; read the file again".into(),
                    );
                }
                old.replacen(
                    from,
                    args["new_text"].as_str().ok_or("new_text is required")?,
                    1,
                )
            };
            if content.len() > 1024 * 1024 {
                return Err("File exceeds the 1 MiB tool limit".into());
            }
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            let target = path.file_name().ok_or("A file name is required")?;
            let parent = dir.open_dir(parent).map_err(|e| e.to_string())?;
            if parent
                .symlink_metadata(target)
                .is_ok_and(|m| m.is_symlink())
            {
                return Err("Writing through a symlink is not supported".into());
            }
            let temp = format!(".puppyone-{}.tmp", uuid::Uuid::new_v4());
            let result = (|| -> std::io::Result<()> {
                use std::io::Write;
                let mut options = cap_std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                let mut f = parent.open_with(&temp, &options)?;
                f.write_all(content.as_bytes())?;
                f.sync_all()?;
                parent.rename(&temp, &parent, target)
            })();
            if result.is_err() {
                let _ = parent.remove_file(&temp);
            }
            result.map_err(|e| e.to_string())?;
            Ok(format!(
                "Saved {} ({} bytes)",
                path.display(),
                content.len()
            ))
        }
        _ => Err(format!("Unsupported tool: {name}")),
    }
}
fn read(dir: &Dir, path: &Path) -> Result<String, String> {
    let mut text = String::new();
    dir.open(path)
        .map_err(|e| e.to_string())?
        .take(1024 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 1024 * 1024 {
        return Err("File exceeds the 1 MiB tool limit".into());
    }
    Ok(text)
}
fn search(
    dir: &Dir,
    start: &Path,
    query: &str,
    content: bool,
    cancel: &AtomicBool,
) -> Result<String, String> {
    if query.is_empty() || query.len() > 1000 {
        return Err("A nonempty query of at most 1000 bytes is required".into());
    }
    let mut queue = vec![(start.to_path_buf(), 0usize)];
    let mut examined = 0;
    let mut budget = 16 * 1024 * 1024u64;
    let mut hits = Vec::new();
    while let Some((path, depth)) = queue.pop() {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Search stopped".into());
        }
        if examined >= 5000 || hits.len() >= 200 || budget == 0 {
            break;
        }
        examined += 1;
        let metadata = match dir.symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.is_symlink() {
            continue;
        }
        if !content && path.to_string_lossy().contains(query) {
            hits.push(path.to_string_lossy().into_owned());
        }
        if metadata.is_dir() {
            if depth < 12 {
                for entry in dir
                    .read_dir(&path)
                    .map_err(|e| e.to_string())?
                    .take((5000usize - examined).saturating_sub(queue.len()))
                    .filter_map(Result::ok)
                {
                    let name = entry.file_name();
                    if !matches!(name.to_str(), Some(".git" | "node_modules" | "target")) {
                        queue.push((path.join(name), depth + 1));
                    }
                }
            }
        } else if content && metadata.len() <= 1024 * 1024 && metadata.len() <= budget {
            budget -= metadata.len();
            if let Ok(text) = read(dir, &path) {
                for (index, line) in text.lines().enumerate() {
                    if line.contains(query) {
                        hits.push(format!(
                            "{}:{}:{}",
                            path.display(),
                            index + 1,
                            line.chars().take(500).collect::<String>()
                        ));
                        if hits.len() >= 200 {
                            break;
                        }
                    }
                }
            }
        }
    }
    let mut output = hits.join("\n");
    if examined >= 5000 || hits.len() >= 200 || budget == 0 {
        output.push_str("\n[Search limit reached; narrow the path or query]");
    }
    if output.is_empty() {
        output = "No matches".into();
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_tool_escape_and_ambiguous_edit_are_rejected() {
        let d = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        assert!(execute(d.path(), "read", &json!({"path":"../outside"}), &cancel).is_err());
        std::fs::write(d.path().join("a"), "same same").unwrap();
        assert!(
            execute(
                d.path(),
                "edit",
                &json!({"path":"a","old_text":"same","new_text":"new"}),
                &cancel
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(d.path().join("a")).unwrap(),
            "same same"
        );
    }
}
