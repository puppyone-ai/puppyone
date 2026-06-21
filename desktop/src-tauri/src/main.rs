use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

const MAX_ENTRIES_PER_FOLDER: usize = 500;
const MAX_PREVIEW_BYTES: u64 = 4096;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileNode {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
    size: Option<String>,
    modified: Option<String>,
    preview: Option<String>,
    content: Option<String>,
    children: Option<Vec<LocalFileNode>>,
}

#[tauri::command]
fn list_folder_children(
    root_path: String,
    folder_path: Option<String>,
) -> Result<Vec<LocalFileNode>, String> {
    let root = PathBuf::from(root_path);
    let folder = resolve_folder_path(&root, folder_path.as_deref())?;

    let metadata = fs::metadata(&folder)
        .map_err(|err| format!("Unable to read folder metadata: {err}"))?;
    if !metadata.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let parent_relative = folder_path.unwrap_or_default();
    let mut entries = fs::read_dir(&folder)
        .map_err(|err| format!("Unable to read folder: {err}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| node_from_entry(entry, &parent_relative))
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| match (a.kind.as_str() == "folder", b.kind.as_str() == "folder") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    if entries.len() > MAX_ENTRIES_PER_FOLDER {
        entries.truncate(MAX_ENTRIES_PER_FOLDER);
    }

    Ok(entries)
}

fn resolve_folder_path(root: &Path, folder_path: Option<&str>) -> Result<PathBuf, String> {
    let Some(relative) = folder_path.filter(|value| !value.is_empty()) else {
        return Ok(root.to_path_buf());
    };

    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Folder path is outside the selected workspace.".to_string());
    }

    Ok(root.join(relative_path))
}

fn node_from_entry(entry: fs::DirEntry, parent_relative: &str) -> Option<LocalFileNode> {
    let file_name = entry.file_name().to_string_lossy().to_string();
    let file_type = entry.file_type().ok()?;
    let path = join_relative_path(parent_relative, &file_name);
    let metadata = entry.metadata().ok();
    let is_folder = file_type.is_dir();
    let kind = if is_folder {
        "folder".to_string()
    } else {
        classify_file(&file_name)
    };

    let (preview, content) = if !is_folder {
        read_preview(&entry.path(), metadata.as_ref().map(|meta| meta.len()))
    } else {
        (None, None)
    };

    Some(LocalFileNode {
        id: path.clone(),
        name: file_name,
        path,
        kind,
        size: metadata
            .as_ref()
            .filter(|_| !is_folder)
            .map(|meta| format_file_size(meta.len())),
        modified: metadata
            .and_then(|meta| meta.modified().ok())
            .and_then(system_time_to_unix_seconds),
        preview,
        content,
        children: None,
    })
}

fn join_relative_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn classify_file(name: &str) -> String {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase();

    match extension.as_str() {
        "json" | "jsonl" => "json",
        "md" | "mdx" | "markdown" => "markdown",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "avif" | "heic" => "image",
        "pdf" => "pdf",
        "mp4" | "mov" | "webm" | "avi" | "mkv" => "video",
        _ => "file",
    }
    .to_string()
}

fn read_preview(path: &Path, size: Option<u64>) -> (Option<String>, Option<String>) {
    if size.is_some_and(|bytes| bytes > MAX_PREVIEW_BYTES) || !is_previewable(path) {
        return (None, None);
    }

    let Ok(bytes) = fs::read(path) else {
        return (None, None);
    };
    if bytes.iter().any(|byte| *byte == 0) {
        return (None, None);
    }

    let content = String::from_utf8_lossy(&bytes)
        .chars()
        .take(1600)
        .collect::<String>();
    let preview = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("\n");

    (
        (!preview.is_empty()).then_some(preview),
        (!content.is_empty()).then_some(content),
    )
}

fn is_previewable(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };
    matches!(
        extension.to_lowercase().as_str(),
        "c" | "cpp"
            | "css"
            | "go"
            | "h"
            | "html"
            | "java"
            | "js"
            | "json"
            | "jsonl"
            | "jsx"
            | "log"
            | "md"
            | "mdx"
            | "py"
            | "rb"
            | "rs"
            | "scss"
            | "sh"
            | "toml"
            | "ts"
            | "tsx"
            | "txt"
            | "xml"
            | "yaml"
            | "yml"
    )
}

fn format_file_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let bytes_float = bytes as f64;

    if bytes_float >= GB {
        format!("{:.1} GB", bytes_float / GB)
    } else if bytes_float >= MB {
        format!("{:.1} MB", bytes_float / MB)
    } else if bytes_float >= KB {
        format!("{:.1} KB", bytes_float / KB)
    } else {
        format!("{bytes} B")
    }
}

fn system_time_to_unix_seconds(time: SystemTime) -> Option<String> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_folder_children])
        .run(tauri::generate_context!())
        .expect("failed to run puppyone");
}
