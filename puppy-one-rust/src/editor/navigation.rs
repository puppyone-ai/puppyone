//! Document references (editor/navigation/documentNavigation.ts): the
//! format-neutral recognition of a whole value as a link. Viewers submit the
//! raw value; external URLs are admitted only for http(s) with a host and no
//! credentials, or mailto; anything else that looks like a link is denied and
//! stays text. Workspace targets are resolved by the host.
use crate::editor::markdown::core::links::{find_links, find_wiki_links};

mod index;
pub use index::{Document, ReferenceContext, ReferenceIndex};
pub(crate) use index::{markdown_target, percent_decode};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Syntax {
    Url,
    MarkdownLink,
    WikiLink,
    WorkspacePath,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Resolved,
    Ambiguous,
    Missing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Denial {
    ControlCharacter,
    Credentials,
    InvalidUrl,
    UnsafeProtocol,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Reference {
    External {
        syntax: Syntax,
        raw: String,
        label: String,
        href: String,
    },
    Workspace {
        syntax: Syntax,
        raw: String,
        label: String,
        target: String,
        status: Status,
        path: Option<String>,
        candidates: Vec<String>,
    },
    Denied {
        syntax: Syntax,
        raw: String,
        label: String,
        reason: Denial,
    },
}

impl Reference {
    pub fn label(&self) -> &str {
        match self {
            Self::External { label, .. }
            | Self::Workspace { label, .. }
            | Self::Denied { label, .. } => label,
        }
    }
}

/// What the host knows about a workspace target
/// (`WorkspaceDocumentReferenceResolution`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Resolution {
    pub exists: bool,
    pub ambiguous: bool,
    pub path: Option<String>,
    pub candidates: Vec<String>,
}

/// An unresolved recognition (`ParsedReferenceIntent`).
#[derive(Clone, Debug, PartialEq)]
pub enum Intent {
    External {
        syntax: Syntax,
        raw: String,
        label: String,
        href: String,
    },
    Workspace {
        syntax: Syntax,
        raw: String,
        label: String,
        target: String,
    },
    Denied {
        syntax: Syntax,
        raw: String,
        label: String,
        reason: Denial,
    },
}

/// `^[a-z][a-z0-9+.-]*:`.
fn has_scheme(value: &str) -> bool {
    value.split_once(':').is_some_and(|(scheme, _)| {
        scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    })
}

/// `%00`–`%1f` and `%7f` escapes.
fn has_escaped_control(value: &str) -> bool {
    let b = value.as_bytes();
    b.windows(3).any(|w| {
        w[0] == b'%' && {
            let hex = std::str::from_utf8(&w[1..])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok());
            hex.is_some_and(|v| v <= 0x1f || v == 0x7f)
        }
    })
}

/// `parseDocumentReferenceIntent`: full-value recognition only.
pub fn parse_intent(raw: &str) -> Option<Intent> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    if raw.chars().any(|c| (c as u32) <= 0x1f || c as u32 == 0x7f) || has_escaped_control(value) {
        return Some(Intent::Denied {
            syntax: Syntax::Url,
            raw: raw.into(),
            label: raw.into(),
            reason: Denial::ControlCharacter,
        });
    }
    if let Some(wiki) = find_wiki_links(value)
        .into_iter()
        .next()
        .filter(|t| t.range.start == 0 && t.range.end == value.len())
    {
        return Some(Intent::Workspace {
            syntax: Syntax::WikiLink,
            raw: raw.into(),
            label: value[wiki.visible.clone()].trim().to_owned(),
            target: wiki.target,
        });
    }
    if let Some(link) = find_links(value)
        .into_iter()
        .next()
        .filter(|t| t.range.start == 0 && t.range.end == value.len())
    {
        return Some(classify(
            raw,
            &value[link.label.clone()],
            &link.href,
            Syntax::MarkdownLink,
            true,
        ));
    }
    if value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with(".\\")
        || value.starts_with("..\\")
        || value.starts_with('/')
        || value.starts_with('\\')
    {
        return Some(Intent::Workspace {
            syntax: Syntax::WorkspacePath,
            raw: raw.into(),
            label: value.into(),
            target: value.into(),
        });
    }
    if has_scheme(value) || value.starts_with("//") {
        return Some(classify(raw, value, value, Syntax::Url, false));
    }
    None
}

/// `classifyTarget`.
fn classify(
    raw: &str,
    label: &str,
    target: &str,
    syntax: Syntax,
    relative_is_workspace: bool,
) -> Intent {
    let denied = |reason| Intent::Denied {
        syntax,
        raw: raw.into(),
        label: label.into(),
        reason,
    };
    if !has_scheme(target) && !target.starts_with("//") {
        return if relative_is_workspace {
            Intent::Workspace {
                syntax,
                raw: raw.into(),
                label: label.into(),
                target: target.into(),
            }
        } else {
            denied(Denial::InvalidUrl)
        };
    }
    let Ok(url) = url::Url::parse(target) else {
        return denied(Denial::InvalidUrl);
    };
    match url.scheme() {
        "http" | "https" => {
            if !url.username().is_empty() || url.password().is_some() {
                return denied(Denial::Credentials);
            }
            if url.host_str().is_none_or(str::is_empty) {
                return denied(Denial::InvalidUrl);
            }
        }
        "mailto" => {
            if url.path().is_empty() {
                return denied(Denial::InvalidUrl);
            }
        }
        _ => return denied(Denial::UnsafeProtocol),
    }
    Intent::External {
        syntax,
        raw: raw.into(),
        label: label.into(),
        href: url.to_string(),
    }
}

/// The host's lookup of a workspace reference.
pub type Resolve = dyn Fn(&str) -> Option<Resolution>;

/// `resolveReference`: workspace intents take the host's resolution
/// (missing without one).
pub fn resolve(raw: &str, resolver: Option<&Resolve>) -> Option<Reference> {
    Some(match parse_intent(raw)? {
        Intent::External {
            syntax,
            raw,
            label,
            href,
        } => Reference::External {
            syntax,
            raw,
            label,
            href,
        },
        Intent::Denied {
            syntax,
            raw,
            label,
            reason,
        } => Reference::Denied {
            syntax,
            raw,
            label,
            reason,
        },
        Intent::Workspace {
            syntax,
            raw,
            label,
            target,
        } => {
            let resolution = resolver.and_then(|r| r(&target)).unwrap_or_default();
            let mut candidates: Vec<String> = resolution
                .path
                .iter()
                .cloned()
                .chain(resolution.candidates.iter().cloned())
                .filter(|p| !p.is_empty())
                .collect();
            let mut seen = std::collections::HashSet::new();
            candidates.retain(|p| seen.insert(p.clone()));
            let status = if resolution.ambiguous {
                Status::Ambiguous
            } else if resolution.exists && resolution.path.is_some() {
                Status::Resolved
            } else {
                Status::Missing
            };
            Reference::Workspace {
                syntax,
                raw,
                label,
                target,
                status,
                path: resolution.path,
                candidates,
            }
        }
    })
}

/// `canOpenReference` (given an opener): external links, and workspace
/// references with somewhere to go.
pub fn can_open(reference: &Reference) -> bool {
    match reference {
        Reference::External { .. } => true,
        Reference::Workspace {
            status, candidates, ..
        } => *status != Status::Missing && !candidates.is_empty(),
        Reference::Denied { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(raw: &str) -> String {
        match parse_intent(raw) {
            None => "text".into(),
            Some(Intent::External { href, label, .. }) => format!("external {label} {href}"),
            Some(Intent::Workspace {
                target,
                label,
                syntax,
                ..
            }) => format!("workspace {syntax:?} {label} {target}"),
            Some(Intent::Denied { reason, .. }) => format!("denied {reason:?}"),
        }
    }

    #[test]
    fn whole_values_are_recognised_like_the_product() {
        assert_eq!(kind("plain text"), "text");
        assert_eq!(kind("see https://example.com"), "text");
        assert_eq!(
            kind(" https://example.com/a?b=1 "),
            "external https://example.com/a?b=1 https://example.com/a?b=1"
        );
        assert_eq!(
            kind("HTTPS://Example.com"),
            "external HTTPS://Example.com https://example.com/"
        );
        assert_eq!(kind("mailto:a@b.c"), "external mailto:a@b.c mailto:a@b.c");
        assert_eq!(
            kind("[Docs](https://example.com/docs)"),
            "external Docs https://example.com/docs"
        );
        assert_eq!(
            kind("[Notes](notes/today.md)"),
            "workspace MarkdownLink Notes notes/today.md"
        );
        assert_eq!(
            kind("[[Roadmap|the plan]]"),
            "workspace WikiLink the plan Roadmap"
        );
        assert_eq!(
            kind("./data/q3.csv"),
            "workspace WorkspacePath ./data/q3.csv ./data/q3.csv"
        );
        assert_eq!(kind("javascript:alert(1)"), "denied UnsafeProtocol");
        assert_eq!(kind("https://user:pw@example.com"), "denied Credentials");
        // A leading slash is a workspace path before it could be a URL.
        assert_eq!(
            kind("//example.com"),
            "workspace WorkspacePath //example.com //example.com"
        );
        assert_eq!(kind("[x](//example.com)"), "denied InvalidUrl");
        assert_eq!(kind("https://example.com/%0a"), "denied ControlCharacter");
        assert_eq!(kind("a\u{7}b"), "denied ControlCharacter");
        // Times and ratios are not schemes.
        assert_eq!(kind("12:30"), "text");
    }

    #[test]
    fn workspace_references_take_the_host_resolution() {
        let resolver = |target: &str| {
            (target == "Roadmap").then(|| Resolution {
                exists: true,
                ambiguous: false,
                path: Some("docs/Roadmap.md".into()),
                candidates: vec!["docs/Roadmap.md".into()],
            })
        };
        let found = resolve("[[Roadmap]]", Some(&resolver)).unwrap();
        assert!(
            matches!(&found, Reference::Workspace { status: Status::Resolved, candidates, .. } if candidates == &vec!["docs/Roadmap.md".to_string()])
        );
        assert!(can_open(&found));
        let missing = resolve("[[Elsewhere]]", Some(&resolver)).unwrap();
        assert!(matches!(
            missing,
            Reference::Workspace {
                status: Status::Missing,
                ..
            }
        ));
        assert!(!can_open(&missing));
    }
}
