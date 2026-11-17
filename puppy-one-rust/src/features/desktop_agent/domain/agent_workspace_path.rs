//! `domain/agent-workspace-path.ts`: compatibility adapter for persisted
//! runtime events created before Main normalized harness paths. It never
//! guesses across Workspace Folder roots.

fn windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/'
}

/// `resolveAgentWorkspaceProviderPath(workspaceRootPath, candidatePath)`.
pub fn resolve_agent_workspace_provider_path(
    workspace_root_path: &str,
    candidate_path: &str,
) -> Option<String> {
    let root = normalize_filesystem_path(workspace_root_path);
    let candidate = normalize_filesystem_path(candidate_path);
    if root.is_empty() || candidate.is_empty() || candidate.contains("://") {
        return None;
    }
    let windows_style = windows_drive_path(&root) || root.starts_with("//");
    let absolute =
        candidate.starts_with('/') || windows_drive_path(&candidate) || candidate.starts_with("//");
    if !absolute {
        return normalize_provider_path(&candidate);
    }
    let (comparable_root, comparable_candidate) = if windows_style {
        (root.to_lowercase(), candidate.to_lowercase())
    } else {
        (root.clone(), candidate.clone())
    };
    if comparable_candidate == comparable_root
        || !comparable_candidate.starts_with(&format!("{comparable_root}/"))
    {
        return None;
    }
    normalize_provider_path(&candidate[root.len() + 1..])
}

fn normalize_filesystem_path(value: &str) -> String {
    let input = crate::text::trim(value).replace('\\', "/");
    if input.is_empty() {
        return String::new();
    }
    let prefix = if windows_drive_path(&input) {
        input[..3].to_string()
    } else if input.starts_with("//") {
        "//".into()
    } else if input.starts_with('/') {
        "/".into()
    } else {
        String::new()
    };
    let mut segments: Vec<&str> = Vec::new();
    for segment in input[prefix.len()..].split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return String::new();
                }
            }
            segment => segments.push(segment),
        }
    }
    let normalized = format!("{prefix}{}", segments.join("/"));
    if normalized.len() > 1 {
        normalized
            .strip_suffix('/')
            .map(str::to_string)
            .unwrap_or(normalized)
    } else {
        normalized
    }
}

fn normalize_provider_path(value: &str) -> Option<String> {
    let mut segments: Vec<&str> = Vec::new();
    let value = value.replace('\\', "/");
    for segment in value.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            segment => segments.push(segment),
        }
    }
    Some(segments.join("/")).filter(|path| !path.is_empty())
}
