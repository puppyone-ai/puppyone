//! Which surface renders a document once Viewer Packs are installed: the
//! deterministic route of `viewerCapability.ts` (`findPackCandidates`,
//! `resolveViewerRoute`) and `viewerPackAdapter.tsx`. Pure.
use super::manifest::{PackFormat, PackViewer};
use crate::editor::registry::{
    contribution::{EditorDocument, SourceKind},
    manifest::Capability,
};

/// `ViewerPackContribution`: one enabled pack in a registry snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackContribution {
    pub plugin_id: String,
    pub publisher: String,
    pub version: String,
    /// The display name: the first format's label (`deriveContributionLabel`).
    pub label: String,
    pub enabled: bool,
    pub content_hash: String,
    pub viewer: PackViewer,
    pub formats: Vec<PackFormat>,
}
/// `ViewerPackContributionSnapshot`: the installed, enabled packs.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub sequence: u64,
    pub contributions: Vec<PackContribution>,
}

/// Why a placeholder-grade document has no pack surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unsupported {
    CloudSource,
    NoMatch,
}

/// `ViewerRouteResult`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route<'a> {
    /// A preset viewer renders it.
    Core {
        viewer: &'static str,
        capability: Capability,
    },
    Plugin(&'a PackContribution),
    /// Several packs match equally: the user picks.
    Chooser(Vec<&'a PackContribution>),
    Unsupported(Unsupported),
}

fn normalize_extension(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    if lower.is_empty() || lower.starts_with('.') {
        lower
    } else {
        format!(".{lower}")
    }
}
fn normalize_mime(value: &str) -> String {
    value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase()
}

/// `findPackCandidates`: the enabled packs declaring the longest matching
/// extension (or, failing that, the MIME type), ordered by id.
pub fn find_candidates<'a>(
    extensions: &[String],
    mimes: &[String],
    snapshot: &'a Snapshot,
) -> Vec<&'a PackContribution> {
    let wanted: Vec<String> = extensions
        .iter()
        .map(|e| normalize_extension(e))
        .filter(|e| !e.is_empty())
        .collect();
    let mimes: Vec<String> = mimes
        .iter()
        .map(|m| normalize_mime(m))
        .filter(|m| !m.is_empty())
        .collect();
    let scored: Vec<(&PackContribution, usize)> = snapshot
        .contributions
        .iter()
        .filter(|c| c.enabled)
        .map(|c| {
            let score = c
                .formats
                .iter()
                .map(|format| {
                    let longest = format
                        .extensions
                        .iter()
                        .map(|e| normalize_extension(e))
                        .filter(|e| wanted.contains(e))
                        .map(|e| e.len())
                        .max();
                    match longest {
                        Some(length) => 1_000 + length,
                        None if format
                            .mime_types
                            .iter()
                            .any(|m| mimes.contains(&normalize_mime(m))) =>
                        {
                            100
                        }
                        None => 0,
                    }
                })
                .max()
                .unwrap_or(0);
            (c, score)
        })
        .collect();
    let best = scored.iter().map(|(_, s)| *s).max().unwrap_or(0);
    let mut matches: Vec<&PackContribution> = scored
        .into_iter()
        .filter(|(_, s)| *s > 0 && *s == best)
        .map(|(c, _)| c)
        .collect();
    matches.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
    matches
}

/// `resolveViewerRoute`: only placeholder-grade documents reach packs, only
/// local ones, and a remembered choice wins among equal candidates.
pub fn resolve<'a>(
    core_viewer: &'static str,
    capability: Capability,
    extensions: &[String],
    mimes: &[String],
    snapshot: &'a Snapshot,
    source: SourceKind,
    preferred: Option<&str>,
) -> Route<'a> {
    if capability != Capability::Placeholder {
        return Route::Core {
            viewer: core_viewer,
            capability,
        };
    }
    // Cloud and unknown sources fail closed before any activation.
    if source != SourceKind::Local {
        return Route::Unsupported(Unsupported::CloudSource);
    }
    let matches = find_candidates(extensions, mimes, snapshot);
    if let Some(preferred) = preferred
        && let Some(choice) = matches.iter().find(|c| c.plugin_id == preferred)
    {
        return Route::Plugin(choice);
    }
    match matches.len() {
        0 => Route::Unsupported(Unsupported::NoMatch),
        1 => Route::Plugin(matches[0]),
        _ => Route::Chooser(matches),
    }
}

/// `candidateExtensions`: every dotted suffix of the name, longest first
/// (`.tar.gz`, `.gz`).
pub fn candidate_extensions(name: &str) -> Vec<String> {
    let base = name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let mut extensions: Vec<String> = base
        .match_indices('.')
        .map(|(i, _)| i)
        .filter(|&i| i < base.len() - 1)
        .map(|i| base[i..].to_owned())
        .collect();
    extensions.sort_by_key(|e| std::cmp::Reverse(e.len()));
    extensions.dedup();
    extensions
}

/// `resolveViewerRouteForDocument`.
pub fn route_for_document<'a>(document: &EditorDocument, snapshot: &'a Snapshot) -> Route<'a> {
    let resolved = crate::editor::registry::resolve(document);
    let mut extensions = candidate_extensions(&document.name);
    if let Some(extension) = &resolved.resolved_extension {
        extensions.push(format!(".{extension}"));
    }
    let mimes: Vec<String> = document.mime.iter().cloned().collect();
    resolve(
        resolved.viewer.id,
        resolved.viewer.capability(),
        &extensions,
        &mimes,
        snapshot,
        document.source_kind,
        None,
    )
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use core::prelude::v1::test;

    pub(crate) fn pack(id: &str, extensions: &[&str], mimes: &[&str]) -> PackContribution {
        PackContribution {
            plugin_id: id.into(),
            publisher: "test".into(),
            version: "1.0.0".into(),
            label: format!("{id} viewer"),
            enabled: true,
            content_hash: "0".repeat(64),
            viewer: PackViewer {
                entry: "viewer.html".into(),
                source: "range-resource".into(),
                runtime: vec![],
            },
            formats: vec![PackFormat {
                id: "f".into(),
                label: format!("{id} viewer"),
                extensions: extensions.iter().map(|e| e.to_string()).collect(),
                mime_types: mimes.iter().map(|m| m.to_string()).collect(),
                category: "binary".into(),
                default_viewer: format!("plugin:{id}"),
            }],
        }
    }

    #[test]
    fn only_local_placeholder_documents_reach_packs() {
        let snapshot = Snapshot {
            sequence: 1,
            contributions: vec![pack("a.glb", &[".glb"], &[])],
        };
        let local = EditorDocument::local("scene/model.glb");
        assert!(
            matches!(route_for_document(&local, &snapshot), Route::Plugin(c) if c.plugin_id == "a.glb")
        );
        let cloud = EditorDocument {
            source_kind: SourceKind::Cloud,
            ..local.clone()
        };
        assert_eq!(
            route_for_document(&cloud, &snapshot),
            Route::Unsupported(Unsupported::CloudSource)
        );
        // A format with a preset viewer never routes to a pack.
        let png = EditorDocument::local("a.png");
        let snapshot = Snapshot {
            sequence: 2,
            contributions: vec![pack("a.png", &[".png"], &[])],
        };
        assert!(matches!(
            route_for_document(&png, &snapshot),
            Route::Core {
                viewer: "image-preview",
                ..
            }
        ));
        assert_eq!(
            route_for_document(&local, &Snapshot::default()),
            Route::Unsupported(Unsupported::NoMatch)
        );
    }

    #[test]
    fn the_longest_extension_wins_and_ties_ask_the_user() {
        let snapshot = Snapshot {
            sequence: 1,
            contributions: vec![
                pack("b.gz", &[".gz"], &[]),
                pack("a.targz", &[".tar.gz"], &[]),
                pack("c.targz", &[".tar.gz"], &[]),
                pack("d.mime", &[".zzz"], &["application/x-thing"]),
            ],
        };
        let candidates = find_candidates(&candidate_extensions("x.tar.gz"), &[], &snapshot);
        assert_eq!(
            candidates
                .iter()
                .map(|c| c.plugin_id.as_str())
                .collect::<Vec<_>>(),
            ["a.targz", "c.targz"]
        );
        let route = resolve(
            "document-placeholder",
            Capability::Placeholder,
            &candidate_extensions("x.tar.gz"),
            &[],
            &snapshot,
            SourceKind::Local,
            None,
        );
        assert!(matches!(route, Route::Chooser(ref c) if c.len() == 2));
        let chosen = resolve(
            "document-placeholder",
            Capability::Placeholder,
            &candidate_extensions("x.tar.gz"),
            &[],
            &snapshot,
            SourceKind::Local,
            Some("c.targz"),
        );
        assert!(matches!(chosen, Route::Plugin(c) if c.plugin_id == "c.targz"));
        let by_mime = find_candidates(
            &[".bin".into()],
            &["Application/X-Thing; v=1".into()],
            &snapshot,
        );
        assert_eq!(by_mime.len(), 1);
        assert_eq!(
            candidate_extensions("Archive.TAR.GZ"),
            vec![".tar.gz", ".gz"]
        );
    }
}
