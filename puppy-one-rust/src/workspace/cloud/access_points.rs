//! `access-points/model`: what the Access pages list, derived from the
//! Project's targets and its persisted Access resources. Ordinary reads never
//! yield a runnable credential; one-time issuance is a separate action.
use super::services::{Identity, McpEndpoint, Scope, Surface, Target};

/// `AccessPointCatalogKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Catalog {
    All,
    Cli,
    Git,
    Mcp,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Cli,
    Git,
    Mcp,
}
/// `AccessPointStatusKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Ready,
    Syncing,
    Missing,
    Error,
}
/// `normalizeAccessPointStatus`.
pub fn status(code: Option<&str>) -> Status {
    let code = code.map(|c| c.trim().to_lowercase()).unwrap_or_default();
    match code.as_str() {
        "error" | "failed" => Status::Error,
        "syncing" | "pending" | "connecting" => Status::Syncing,
        "active" | "ready" => Status::Ready,
        _ => Status::Missing,
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandId {
    Explore,
    ExistingFolder,
    Clone,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Command {
    pub id: CommandId,
    pub value: String,
    pub disabled: bool,
}
/// A repository view: the Project root, or one real path Scope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct View {
    pub id: String,
    pub target: Target,
    pub name: Option<String>,
    pub path: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Point {
    pub id: String,
    pub kind: Kind,
    pub view: View,
    /// Provider-owned name; first-party names are localized by the view.
    pub title: String,
    pub subtitle: String,
    pub status: Status,
    pub status_code: String,
    /// The persisted Access resource, absent for an unconfigured placeholder.
    pub surface: Option<String>,
    pub key_hint: Option<String>,
    pub placeholder: bool,
    pub commands: Vec<Command>,
}

fn normalized_path(path: &str) -> &str {
    path.trim_matches('/')
}
/// `getScopePathLabel`.
pub fn path_label(path: &str) -> String {
    format!("/{}", normalized_path(path))
}
/// `shellQuote`.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
/// `profileSlug`.
pub fn profile_slug(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    let mut slug = String::new();
    let mut gap = false;
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
            slug.push(c);
            gap = false;
        } else if !gap {
            slug.push('-');
            gap = true;
        }
    }
    let slug = slug.trim_matches('-').to_owned();
    if slug.is_empty() { "root".into() } else { slug }
}
/// `getScopeIdentifierName`.
fn identifier(view: &View) -> String {
    if let Some(name) = view
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        return name.to_owned();
    }
    normalized_path(&view.path)
        .rsplit('/')
        .find(|p| !p.is_empty())
        .unwrap_or("root")
        .to_owned()
}
/// `getCanonicalGitUrlForView`: the identity's own URL, never one guessed
/// for a Scope it does not list.
fn git_url(identity: Option<&Identity>, view: &View) -> String {
    let Some(identity) = identity else {
        return String::new();
    };
    match &view.target {
        Target::ProjectRoot { .. } => identity.url.clone(),
        Target::Scope { .. } => identity
            .scopes
            .iter()
            .find(|s| s.id == view.id)
            .map(|s| s.git_url.clone())
            .unwrap_or_default(),
    }
}
/// `getCloudScopeRows`.
pub fn views(project: &str, scopes: &[Scope]) -> Vec<View> {
    let mut views = vec![View {
        id: project.to_owned(),
        target: Target::ProjectRoot {
            project_id: project.to_owned(),
        },
        name: None,
        path: String::new(),
    }];
    views.extend(scopes.iter().map(|scope| View {
        id: scope.id.clone(),
        target: Target::Scope {
            project_id: scope.project_id.clone(),
            scope_id: scope.id.clone(),
        },
        name: Some(scope.name.clone()),
        path: scope.path.clone(),
    }));
    views
}
/// `buildAccessPointsForScope`: CLI and Git are built in, one per target;
/// MCP rows exist per persisted surface, joined to their endpoint by id.
fn points(
    view: &View,
    surfaces: &[Surface],
    endpoints: &[McpEndpoint],
    identity: Option<&Identity>,
    catalog: Catalog,
) -> Vec<Point> {
    let here: Vec<&Surface> = surfaces
        .iter()
        .filter(|s| s.target == view.target)
        .collect();
    let name = identifier(view);
    let profile = shell_quote(&profile_slug(&name));
    let url = git_url(identity, view);
    let remote = if url.is_empty() {
        "<git-url>"
    } else {
        url.as_str()
    };
    let built_in =
        |kind: Kind, surface: Option<&&Surface>, id: String, commands: Vec<Command>| Point {
            id,
            kind,
            view: view.clone(),
            title: String::new(),
            subtitle: String::new(),
            status: status(surface.map(|s| s.status.as_str())),
            status_code: surface.map_or("missing".into(), |s| s.status.clone()),
            surface: surface.map(|s| s.id.clone()),
            key_hint: surface.and_then(|s| s.key_last4.clone()),
            placeholder: surface.is_none(),
            commands,
        };
    let cli = here.iter().find(|s| s.kind == "cli");
    let git = here.iter().find(|s| s.kind == "git_remote");
    let mut out = vec![
        built_in(
            Kind::Cli,
            cli,
            format!("builtin:cli:{}", view.id),
            vec![Command {
                id: CommandId::Explore,
                value: format!(
                    "puppyone fs tree / --profile {profile}\npuppyone fs ls / --profile {profile}"
                ),
                // The login command comes with a one-time credential only.
                disabled: true,
            }],
        ),
        built_in(
            Kind::Git,
            git,
            format!("builtin:git:{}", view.id),
            vec![
                Command {
                    id: CommandId::ExistingFolder,
                    value: format!("git remote add puppyone {remote}\ngit fetch puppyone"),
                    disabled: url.is_empty(),
                },
                Command {
                    id: CommandId::Clone,
                    value: format!("git clone {remote} {}", shell_quote(&name)),
                    disabled: url.is_empty(),
                },
            ],
        ),
    ];
    for surface in here
        .iter()
        .filter(|s| matches!(s.kind.as_str(), "mcp" | "mcp_endpoint"))
    {
        let endpoint = endpoints
            .iter()
            .find(|e| e.id == surface.id && e.project_id == surface.project_id);
        out.push(Point {
            id: format!("mcp:{}", surface.id),
            kind: Kind::Mcp,
            view: view.clone(),
            title: surface
                .name
                .clone()
                .or_else(|| endpoint.map(|e| e.name.clone()))
                .unwrap_or_default(),
            subtitle: path_label(&view.path),
            status: status(Some(&surface.status)),
            status_code: surface.status.clone(),
            surface: Some(surface.id.clone()),
            key_hint: endpoint
                .and_then(|e| e.api_key_hint.clone())
                .or_else(|| surface.key_last4.clone()),
            placeholder: false,
            commands: vec![],
        });
    }
    if catalog == Catalog::Mcp && !out.iter().any(|p| p.kind == Kind::Mcp) {
        out.push(Point {
            id: format!("placeholder:mcp:{}", view.id),
            kind: Kind::Mcp,
            view: view.clone(),
            title: String::new(),
            subtitle: path_label(&view.path),
            status: Status::Missing,
            status_code: "missing".into(),
            surface: None,
            key_hint: None,
            placeholder: true,
            commands: vec![],
        });
    }
    out
}
/// `buildAccessPointRows` narrowed to a catalog.
pub fn rows(
    project: &str,
    scopes: &[Scope],
    surfaces: &[Surface],
    endpoints: &[McpEndpoint],
    identity: Option<&Identity>,
    catalog: Catalog,
) -> Vec<Point> {
    views(project, scopes)
        .iter()
        .flat_map(|view| points(view, surfaces, endpoints, identity, catalog))
        .filter(|p| match catalog {
            Catalog::All => true,
            Catalog::Cli => p.kind == Kind::Cli,
            Catalog::Git => p.kind == Kind::Git,
            Catalog::Mcp => p.kind == Kind::Mcp,
        })
        .collect()
}
/// `getCloudOverviewMetrics`: configured access points, and the ready ones.
pub fn metrics(rows: &[Point]) -> (usize, usize) {
    let configured: Vec<_> = rows.iter().filter(|p| !p.placeholder).collect();
    let ready = configured
        .iter()
        .filter(|p| p.status == Status::Ready)
        .count();
    (configured.len(), ready)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::{Value, json};

    fn surface(id: &str, kind: &str, status: &str) -> Surface {
        Surface {
            id: id.into(),
            project_id: "p".into(),
            target: Target::ProjectRoot {
                project_id: "p".into(),
            },
            kind: kind.into(),
            name: None,
            status: status.into(),
            config: Value::Null,
            last_activity_at: None,
            error_message: None,
            has_key: None,
            key_last4: None,
        }
    }
    fn identity() -> Identity {
        serde_json::from_value(json!({"project_id": "p", "url": "https://api/git/p.git",
            "scopes": [{"id": "s", "name": "Docs", "path": "docs", "git_url": "https://api/git/p/scopes/s.git"}]}))
        .unwrap()
    }
    fn scope() -> Scope {
        Scope {
            id: "s".into(),
            project_id: "p".into(),
            name: "Docs & notes".into(),
            path: "/docs/".into(),
            exclude: vec![],
            max_mode: "r".into(),
        }
    }

    #[test]
    fn statuses_follow_the_product_groups() {
        assert_eq!(status(Some(" Failed ")), Status::Error);
        assert_eq!(status(Some("connecting")), Status::Syncing);
        assert_eq!(status(Some("ready")), Status::Ready);
        assert_eq!(status(Some("paused")), Status::Missing);
        assert_eq!(status(None), Status::Missing);
    }

    #[test]
    fn built_ins_exist_per_target_and_mcp_per_surface() {
        let identity = identity();
        let surfaces = [surface("c", "cli", "active"), surface("m", "mcp", "paused")];
        let rows = rows(
            "p",
            &[scope()],
            &surfaces,
            &[],
            Some(&identity),
            Catalog::All,
        );
        // Root: CLI, Git, one MCP. Scope: CLI, Git placeholders.
        assert_eq!(rows.len(), 5);
        assert_eq!(metrics(&rows), (2, 1));
        assert!(!rows[0].placeholder);
        assert!(rows[1].placeholder);
        let git = &rows[1].commands;
        assert!(
            git[0]
                .value
                .contains("git remote add puppyone https://api/git/p.git")
        );
        assert!(!git[0].disabled);
        // The Scope's own URL, and a quoted, slugged name.
        let scoped = rows.iter().find(|r| r.id == "builtin:git:s").unwrap();
        assert!(
            scoped.commands[1]
                .value
                .contains("/scopes/s.git 'Docs & notes'")
        );
        let cli = rows.iter().find(|r| r.id == "builtin:cli:s").unwrap();
        assert!(cli.commands[0].value.contains("--profile 'docs-notes'"));
    }

    #[test]
    fn without_an_identity_git_commands_stay_disabled_and_an_empty_mcp_catalog_has_a_placeholder() {
        let git = rows("p", &[], &[], &[], None, Catalog::Git);
        assert_eq!(git.len(), 1);
        assert!(git[0].commands.iter().all(|c| c.disabled));
        assert!(git[0].commands[0].value.contains("<git-url>"));
        let mcp = rows("p", &[], &[], &[], None, Catalog::Mcp);
        assert_eq!(mcp.len(), 1);
        assert!(mcp[0].placeholder);
    }

    #[test]
    fn names_and_quotes_are_safe_for_a_shell() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(profile_slug("  My Notes!! "), "my-notes");
        assert_eq!(profile_slug("中文"), "root");
        assert_eq!(path_label("/docs/"), "/docs");
        assert_eq!(path_label(""), "/");
    }
}
