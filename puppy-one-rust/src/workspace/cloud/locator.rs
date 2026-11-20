//! Local repository ↔ Cloud identity hints and human resource links.
//!
//! - `parsePuppyoneRemoteInfo` / `readWorkspacePuppyoneRemoteMetadata`: a
//!   canonical, secret-free Project-root or Scope locator from actual Git
//!   remotes; access-point URLs never count, and ambiguity yields none.
//! - `isTrustedCloudGitOrigin` / `isTrustedCloudProjectLocator`: only the
//!   configured API's origin (plus an explicit HTTPS hosted Git origin in
//!   loopback development, and the legacy official HTTP locator normalized in
//!   memory) may identify a Project. Names never prove association.
//! - `workspaceResourceUrl`: `{web-origin}/{workspace-id}/{path}`; folders end
//!   with `/`, files do not; each segment is encoded. A URL grants nothing.
// Consumed by the Cloud navigation surface (Homepage catalog, Header switch,
// Share), which stays behind the Cloud experiment until its UI lands.

/// One parsed Puppyone Git remote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RemoteInfo {
    Project {
        origin: String,
        project: String,
    },
    Scope {
        origin: String,
        project: String,
        scope: String,
    },
    AccessPoint {
        origin: String,
    },
}
/// `puppyoneGitRemote`: the single canonical locator of a checkout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Locator {
    pub origin: String,
    pub project: String,
    pub scope: Option<String>,
}

fn is_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 200
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
}

/// `parsePuppyoneRemoteInfo`.
pub fn parse_remote(raw: &str) -> Option<RemoteInfo> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none_or(str::is_empty)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let origin = url.origin().ascii_serialization().to_lowercase();
    let path = url.path();
    if let Some(rest) = path.strip_prefix("/git/ap/")
        && rest.ends_with(".git")
        && !rest[..rest.len() - 4].contains('/')
    {
        return Some(RemoteInfo::AccessPoint { origin });
    }
    let body = path.strip_prefix("/git/")?.strip_suffix(".git")?;
    match body.split('/').collect::<Vec<_>>().as_slice() {
        [project] if is_id(project) => Some(RemoteInfo::Project {
            origin,
            project: (*project).into(),
        }),
        [project, "scopes", scope] if is_id(project) && is_id(scope) => Some(RemoteInfo::Scope {
            origin,
            project: (*project).into(),
            scope: (*scope).into(),
        }),
        _ => None,
    }
}

/// `readWorkspacePuppyoneRemoteMetadata`: fetch and push URLs of every
/// remote; exactly one canonical identity or none.
pub fn canonical_locator<'a>(urls: impl IntoIterator<Item = &'a str>) -> Option<Locator> {
    let mut identities = std::collections::BTreeSet::new();
    for info in urls.into_iter().filter_map(parse_remote) {
        match info {
            RemoteInfo::Project { origin, project } => {
                identities.insert((origin, project, None));
            }
            RemoteInfo::Scope {
                origin,
                project,
                scope,
            } => {
                identities.insert((origin, project, Some(scope)));
            }
            RemoteInfo::AccessPoint { .. } => {}
        }
    }
    if identities.len() != 1 {
        return None;
    }
    let (origin, project, scope) = identities.into_iter().next()?;
    Some(Locator {
        origin,
        project,
        scope,
    })
}

/// `cloudOriginFromApiBase`.
pub fn origin_of(api_base: &str) -> Option<String> {
    let url = url::Url::parse(api_base).ok()?;
    matches!(url.scheme(), "http" | "https")
        .then(|| url.origin().ascii_serialization().to_lowercase())
}
fn same_origin(left: &str, right: &str) -> bool {
    matches!((origin_of(left), origin_of(right)), (Some(a), Some(b)) if a == b)
}
fn is_loopback(value: &str) -> bool {
    url::Url::parse(value)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .is_some_and(|h| matches!(h.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "::1"))
}
/// `isTrustedCloudGitOrigin`; `hosted_git_origin` is the explicitly
/// configured development mapping (`VITE_DESKTOP_CLOUD_GIT_ORIGIN`).
pub fn is_trusted_git_origin(
    remote: &str,
    api_base: &str,
    hosted_git_origin: Option<&str>,
) -> bool {
    if same_origin(remote, api_base) {
        return true;
    }
    if !is_loopback(api_base) {
        return false;
    }
    hosted_git_origin.is_some_and(|configured| {
        same_origin(remote, configured)
            && origin_of(configured).is_some_and(|o| o.starts_with("https://"))
    })
}
/// `isTrustedCloudProjectLocator`: the legacy official
/// `http://api.puppyone.ai` form is an identity hint, normalized to HTTPS in
/// memory only; credentials are never sent to the old URL.
pub fn is_trusted_project_locator(
    remote: &str,
    api_base: Option<&str>,
    hosted_git_origin: Option<&str>,
) -> bool {
    let Some(api_base) = api_base else {
        return false;
    };
    if is_trusted_git_origin(remote, api_base, hosted_git_origin) {
        return true;
    }
    let Ok(url) = url::Url::parse(remote) else {
        return false;
    };
    if url.scheme() != "http"
        || url.host_str() != Some("api.puppyone.ai")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    is_trusted_git_origin("https://api.puppyone.ai", api_base, hosted_git_origin)
}

/// `isWorkspaceId`: a Project UUID.
pub fn is_workspace_id(value: &str) -> bool {
    let groups: Vec<&str> = value.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(g, n)| g.len() == n && g.bytes().all(|b| b.is_ascii_hexdigit()))
}
/// `workspaceResourcePath`.
pub fn resource_path(project: &str, path: &str, directory: bool) -> Result<String, &'static str> {
    if !is_workspace_id(project) {
        return Err("Invalid workspace ID");
    }
    let segments: Vec<&str> = if path.is_empty() {
        vec![]
    } else {
        path.split('/').collect()
    };
    if segments.iter().any(|s| {
        s.is_empty() || *s == "." || *s == ".." || s.chars().any(|c| c.is_control() || c == '\\')
    }) {
        return Err("Invalid workspace path");
    }
    let encoded: Vec<String> = segments.iter().map(|s| encode_component(s)).collect();
    let encoded = encoded.join("/");
    Ok(format!(
        "/{}/{}{}",
        project.to_lowercase(),
        encoded,
        if directory && !encoded.is_empty() {
            "/"
        } else {
            ""
        }
    ))
}
/// `workspaceResourceUrl`.
pub fn resource_url(
    web_origin: &str,
    project: &str,
    path: &str,
    directory: bool,
) -> Result<String, &'static str> {
    let base = url::Url::parse(web_origin).map_err(|_| "Invalid workspace website origin")?;
    if !matches!(base.scheme(), "http" | "https")
        || !base.username().is_empty()
        || base.password().is_some()
    {
        return Err("Invalid workspace website origin");
    }
    Ok(format!(
        "{}{}",
        base.origin().ascii_serialization(),
        resource_path(project, path, directory)?
    ))
}
/// `encodeURIComponent`.
fn encode_component(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "0D3B7A4E-1F2A-4B5C-8D9E-0123456789AB";

    #[test]
    fn remotes_parse_projects_scopes_and_ignore_access_points() {
        assert_eq!(
            parse_remote("https://API.puppyone.ai/git/p1.git"),
            Some(RemoteInfo::Project {
                origin: "https://api.puppyone.ai".into(),
                project: "p1".into()
            })
        );
        assert_eq!(
            parse_remote("https://api.puppyone.ai/git/p1/scopes/s_2.git"),
            Some(RemoteInfo::Scope {
                origin: "https://api.puppyone.ai".into(),
                project: "p1".into(),
                scope: "s_2".into()
            })
        );
        assert!(matches!(
            parse_remote("https://h/git/ap/secret.git"),
            Some(RemoteInfo::AccessPoint { .. })
        ));
        for bad in [
            "https://user:pw@h/git/p.git",
            "https://h/git/p.git?x=1",
            "ssh://h/git/p.git",
            "https://h/git/-p.git",
            "https://h/other/p.git",
        ] {
            assert_eq!(parse_remote(bad), None, "{bad}");
        }
    }

    #[test]
    fn exactly_one_canonical_identity_or_none() {
        let one = canonical_locator([
            "https://h/git/p.git",
            "https://h/git/p.git",
            "https://h/git/ap/k.git",
        ]);
        assert_eq!(
            one,
            Some(Locator {
                origin: "https://h".into(),
                project: "p".into(),
                scope: None
            })
        );
        assert_eq!(
            canonical_locator(["https://h/git/p.git", "https://h/git/q.git"]),
            None
        );
        assert_eq!(canonical_locator(["https://github.com/a/b.git"]), None);
    }

    #[test]
    fn only_the_configured_origin_or_explicit_hosted_mapping_is_trusted() {
        assert!(is_trusted_git_origin(
            "https://api.puppyone.ai/git/p.git",
            "https://api.puppyone.ai/api/v1",
            None
        ));
        assert!(!is_trusted_git_origin(
            "https://evil.example/git/p.git",
            "https://api.puppyone.ai/api/v1",
            None
        ));
        let local = "http://127.0.0.1:8000/api/v1";
        assert!(!is_trusted_git_origin(
            "https://api.puppyone.ai/git/p.git",
            local,
            None
        ));
        assert!(is_trusted_git_origin(
            "https://api.puppyone.ai/git/p.git",
            local,
            Some("https://api.puppyone.ai")
        ));
        assert!(!is_trusted_git_origin(
            "http://git.example/git/p.git",
            local,
            Some("http://git.example")
        ));
        // Legacy official HTTP locator: identity hint only.
        assert!(is_trusted_project_locator(
            "http://api.puppyone.ai/git/p.git",
            Some("https://api.puppyone.ai/api/v1"),
            None
        ));
        assert!(!is_trusted_project_locator(
            "http://api.puppyone.ai:8080/git/p.git",
            Some("https://api.puppyone.ai/api/v1"),
            None
        ));
        assert!(!is_trusted_project_locator(
            "http://api.puppyone.ai/git/p.git",
            None,
            None
        ));
    }

    /// `cloudRepositoryContextResolver`: the legacy official HTTP locator is
    /// an identity hint only, never a Git transport; anything else (another
    /// host or port, credentials, a query or fragment, another environment,
    /// or a development mapping that is not exactly the HTTPS hosted origin)
    /// is not this Cloud's Project.
    #[test]
    fn legacy_locators_are_identity_hints_for_their_own_environment_only() {
        let api = "https://api.puppyone.ai/api/v1";
        let legacy = "http://api.puppyone.ai/git/project-1.git";
        assert!(is_trusted_project_locator(legacy, Some(api), None));
        assert!(!is_trusted_git_origin(legacy, api, None));
        for locator in [
            "http://other.puppyone.ai/git/project-1.git",
            "http://api.puppyone.ai:9000/git/project-1.git",
            "http://user:secret@api.puppyone.ai/git/project-1.git",
            "http://api.puppyone.ai/git/project-1.git?token=secret",
            "http://api.puppyone.ai/git/project-1.git#secret",
        ] {
            assert!(
                !is_trusted_project_locator(locator, Some(api), None),
                "{locator}"
            );
            assert!(
                !is_trusted_project_locator(
                    locator,
                    Some("http://localhost:9090/api/v1"),
                    Some("https://api.puppyone.ai")
                ),
                "{locator}"
            );
        }
        // Development and production stay distinct.
        assert!(!is_trusted_project_locator(
            legacy,
            Some("http://localhost:8000/api/v1"),
            None
        ));
        for local in [
            "http://localhost:9090/api/v1",
            "http://127.0.0.1:9090/api/v1",
        ] {
            let hosted = Some("https://api.puppyone.ai");
            assert!(
                is_trusted_project_locator(legacy, Some(local), hosted),
                "{local}"
            );
            assert!(!is_trusted_git_origin(legacy, local, hosted), "{local}");
        }
        for configured in [
            "https://other.puppyone.ai",
            "http://api.puppyone.ai",
            "https://api.puppyone.ai:9000",
        ] {
            let local = "http://localhost:9090/api/v1";
            assert!(
                !is_trusted_project_locator(legacy, Some(local), Some(configured)),
                "{configured}"
            );
            assert!(
                !is_trusted_git_origin(legacy, local, Some(configured)),
                "{configured}"
            );
        }
        // The development mapping never binds a different hosted API.
        assert!(!is_trusted_project_locator(
            legacy,
            Some("https://other.puppyone.ai/api/v1"),
            Some("https://api.puppyone.ai")
        ));
    }

    #[test]
    fn resource_links_encode_segments_and_mark_folders() {
        assert_eq!(
            resource_url("https://app.puppyone.ai/x", ID, "docs/My Plan.md", false).unwrap(),
            format!(
                "https://app.puppyone.ai/{}/docs/My%20Plan.md",
                ID.to_lowercase()
            )
        );
        assert_eq!(
            resource_url("https://app.puppyone.ai", ID, "docs", true).unwrap(),
            format!("https://app.puppyone.ai/{}/docs/", ID.to_lowercase())
        );
        assert_eq!(
            resource_path(ID, "", true).unwrap(),
            format!("/{}/", ID.to_lowercase())
        );
        assert!(resource_path("not-a-uuid", "a", false).is_err());
        assert!(resource_path(ID, "a/../b", false).is_err());
        assert!(resource_url("ftp://x", ID, "", false).is_err());
        assert_eq!(encode_component("中"), "%E4%B8%AD");
    }

    /// `workspaceResourceUrl`: every path segment survives the website
    /// locator exactly, with nothing in a query or fragment; a path that
    /// cannot be a safe locator, a missing Project id and a non-web or
    /// credential-bearing origin are refused.
    #[test]
    fn resource_locators_keep_every_segment_and_refuse_unsafe_paths() {
        const PROJECT: &str = "01926faa-7ed1-7000-a000-000000000001";
        let decode = |segment: &str| {
            let bytes = segment.as_bytes();
            let mut out = Vec::new();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i] == b'%' {
                    out.push(u8::from_str_radix(&segment[i + 1..i + 3], 16).unwrap());
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            String::from_utf8(out).unwrap()
        };
        assert_eq!(
            resource_url("https://app.example/settings", PROJECT, "", true).unwrap(),
            format!("https://app.example/{PROJECT}/")
        );
        assert_eq!(
            resource_path(PROJECT, "notes/nested", true).unwrap(),
            format!("/{PROJECT}/notes/nested/")
        );
        for path in [
            "docs/笔记 #1?.md",
            "100%/literal%2F.md",
            "emoji/🐶.txt",
            "a+b/space here.md",
        ] {
            let url = url::Url::parse(
                &resource_url("https://app.example", PROJECT, path, false).unwrap(),
            )
            .unwrap();
            assert_eq!((url.query(), url.fragment()), (None, None), "{path}");
            let segments: Vec<String> = url.path_segments().unwrap().skip(1).map(decode).collect();
            assert_eq!(segments.join("/"), path);
        }
        for path in [
            "../secret",
            "/notes",
            "notes/",
            "a//b",
            "a/../b",
            "a\\b",
            "a\u{0}b",
            "a\nb",
        ] {
            assert!(resource_path(PROJECT, path, false).is_err(), "{path:?}");
        }
        assert!(resource_path("project", "", true).is_err());
        assert!(resource_url("file:///tmp", PROJECT, "", true).is_err());
        assert!(resource_url("https://user:password@app.example", PROJECT, "", true).is_err());
    }
}
