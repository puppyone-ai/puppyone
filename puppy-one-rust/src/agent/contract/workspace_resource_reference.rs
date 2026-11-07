//! `shared/workspace-resource-reference.mjs`: the local provider transport
//! identity of a workspace entry. This is neither a filesystem path nor a
//! grant.
use super::js;
use super::validation::{Contract, type_error};
use crate::text;

const PREFIX: &str = "puppyone-local://workspace/";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceResource {
    pub folder_id: String,
    pub relative_path: String,
}

fn unsafe_segment(segment: &str) -> bool {
    segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment
            .chars()
            .any(|c| c == '/' || c == '\\' || c <= '\u{1f}' || c == '\u{7f}')
}

/// `parseWorkspaceResourceReference(value)`.
pub fn parse_workspace_resource_reference(value: &str) -> Contract<WorkspaceResource> {
    if text::len16(value) > 16_384 || !value.starts_with(PREFIX) {
        return Err(type_error("A local workspace resource URI is required."));
    }
    let mut segments = Vec::new();
    for segment in value[PREFIX.len()..].split('/') {
        let decoded =
            js::decode_uri_component(segment).ok_or_else(|| type_error("URI malformed"))?;
        if unsafe_segment(&decoded) {
            return Err(type_error("Invalid workspace resource segment."));
        }
        segments.push(decoded);
    }
    let folder_id = segments.remove(0);
    let relative_path = if segments.is_empty() {
        ".".to_string()
    } else {
        segments.join("/")
    };
    Ok(WorkspaceResource {
        folder_id,
        relative_path,
    })
}

/// `isWorkspaceResourceReference(value)`.
pub fn is_workspace_resource_reference(value: &str) -> bool {
    value.starts_with(PREFIX)
}

#[cfg(test)]
/// `createWorkspaceResourceReference(folderId, relativePath)`.
pub fn create_workspace_resource_reference(
    folder_id: &str,
    relative_path: &str,
) -> Contract<String> {
    let mut segments = vec![folder_id];
    if relative_path != "." {
        segments.extend(relative_path.split('/'));
    }
    let uri = format!(
        "{PREFIX}{}",
        segments
            .iter()
            .map(|s| js::encode_uri_component(s))
            .collect::<Vec<_>>()
            .join("/")
    );
    parse_workspace_resource_reference(&uri)?;
    Ok(uri)
}

#[cfg(test)]
fn is_absolute_root(root: &str) -> bool {
    let bytes = root.as_bytes();
    root.starts_with('/')
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || (root.starts_with("\\\\")
            && root[2..].split('\\').next().is_some_and(|h| !h.is_empty())
            && root[2..].contains('\\'))
}

#[cfg(test)]
/// `projectLocalResourcePath(rootPath, relativePath)`: synchronous
/// display/export projection; native consumers must reauthorize it.
pub fn project_local_resource_path(root_path: &str, relative_path: &str) -> Contract<String> {
    if !is_absolute_root(root_path) || root_path.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}') {
        return Err(type_error("An absolute local root is required."));
    }
    if relative_path == "." || relative_path.is_empty() {
        return Ok(root_path.to_string());
    }
    let segments: Vec<&str> = relative_path.split('/').collect();
    if segments.iter().any(|s| {
        s.is_empty()
            || *s == "."
            || *s == ".."
            || s.chars()
                .any(|c| c == '\\' || c <= '\u{1f}' || c == '\u{7f}')
    }) {
        return Err(type_error("A provider-relative path is required."));
    }
    let bytes = root_path.as_bytes();
    let windows = (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'\\')
        || root_path.starts_with("\\\\");
    let separator = if windows { "\\" } else { "/" };
    Ok(format!(
        "{}{separator}{}",
        root_path.trim_end_matches(['/', '\\']),
        segments.join(separator)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn resource_references_round_trip() {
        let uri = create_workspace_resource_reference("folder-1", "docs/a b.md").unwrap();
        assert_eq!(uri, "puppyone-local://workspace/folder-1/docs/a%20b.md");
        let resource = parse_workspace_resource_reference(&uri).unwrap();
        assert_eq!(resource.folder_id, "folder-1");
        assert_eq!(resource.relative_path, "docs/a b.md");
        assert_eq!(
            parse_workspace_resource_reference("puppyone-local://workspace/f")
                .unwrap()
                .relative_path,
            "."
        );
        assert!(parse_workspace_resource_reference("puppyone-local://workspace/f/%2E%2E").is_err());
        assert_eq!(
            project_local_resource_path("/root/", "a/b").unwrap(),
            "/root/a/b"
        );
        assert!(project_local_resource_path("relative", "a").is_err());
    }
}
