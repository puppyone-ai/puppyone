//! Metadata half of `markdownLinkGraph.ts`. The host supplies its hydrated
//! Explorer tree, never disk paths or an unbounded recursive filesystem scan.
use super::Resolution;
use std::{collections::HashMap, sync::Arc};

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct Document {
    pub path: String,
    pub name: String,
}

#[derive(Debug)]
pub struct ReferenceIndex {
    documents: Vec<Document>,
    paths: HashMap<String, usize>,
    titles: HashMap<String, Vec<usize>>,
}

#[derive(Clone, Debug)]
pub struct ReferenceContext {
    pub source: String,
    pub index: Arc<ReferenceIndex>,
}
impl PartialEq for ReferenceContext {
    fn eq(&self, other: &Self) -> bool {
        self.source == other.source && Arc::ptr_eq(&self.index, &other.index)
    }
}
impl ReferenceContext {
    pub fn resolve(&self, target: &str) -> Resolution {
        self.index.resolve(&self.source, target)
    }
    pub fn markdown(&self, href: &str) -> Option<Resolution> {
        Some(self.resolve(&markdown_target(href)?))
    }
}

/// The graph normalizes hrefs differently from whole CSV reference values.
pub(crate) fn markdown_target(href: &str) -> Option<String> {
    let value = href.trim();
    if value.is_empty()
        || value.starts_with('#')
        || super::has_scheme(value)
        || value.starts_with("//")
    {
        return None;
    }
    let without_query = value.split('?').next().unwrap_or(value);
    let (path, heading) = without_query.split_once('#').unwrap_or((without_query, ""));
    let path = decode(path);
    let heading = decode(heading);
    if path.is_empty() && heading.is_empty() {
        return None;
    }
    Some(if heading.is_empty() {
        path
    } else {
        format!("{path}#{heading}")
    })
}

impl ReferenceIndex {
    pub fn new(documents: Vec<Document>) -> Self {
        // JS localeCompare uses Unicode collation, not Rust's byte ordering.
        // Root ICU collation matches the product's default en-US oracle.
        let collator = icu_collator::Collator::try_new(Default::default(), Default::default())
            .expect("compiled ICU collation data");
        let mut order: Vec<_> = (0..documents.len()).collect();
        order.sort_by(|&a, &b| collator.compare(&documents[a].path, &documents[b].path));
        let mut paths = HashMap::new();
        let mut titles: HashMap<String, Vec<usize>> = HashMap::new();
        for i in order {
            let document = &documents[i];
            let path = normalize(&document.path).to_lowercase();
            paths.insert(path.clone(), i);
            paths.insert(strip_extension(&path).to_owned(), i);
            let name = if document.name.is_empty() {
                basename(&document.path)
            } else {
                &document.name
            };
            titles
                .entry(normalize(strip_extension(name)).to_lowercase())
                .or_default()
                .push(i);
        }
        Self {
            documents,
            paths,
            titles,
        }
    }

    /// Same metadata means no new context/cache invalidation on disclosure.
    pub fn matches(&self, documents: &[Document]) -> bool {
        self.documents == documents
    }

    pub fn resolve(&self, source: &str, target: &str) -> Resolution {
        let (path, heading) = target.split_once('#').unwrap_or((target, ""));
        let raw = path.trim();
        // This index is scoped to a single Workspace Folder. Qualified resource
        // URIs require the multi-root router and must never become local paths.
        if super::has_scheme(raw) {
            return Resolution::default();
        }
        let path = normalize(raw);
        // Deliberately preserve the TS source lookup's case behavior.
        let source_document = self.paths.get(&normalize(source)).copied();
        let folder = parent(source_document.map_or(source, |i| &self.documents[i].path));
        let resolved = |i: usize, ambiguous| Resolution {
            exists: true,
            ambiguous,
            path: Some(self.documents[i].path.clone()),
            candidates: vec![self.documents[i].path.clone()],
        };
        if path.is_empty()
            && !heading.trim().is_empty()
            && let Some(i) = source_document
        {
            return resolved(i, false);
        }
        for candidate in candidates(raw, folder, false) {
            if let Some(&i) = self.paths.get(&candidate) {
                return resolved(i, false);
            }
        }
        if let Some(matches) = self
            .titles
            .get(&normalize(strip_extension(basename(&path))).to_lowercase())
        {
            // Stable document order breaks ties, exactly as the sorted TS graph.
            let (_, &i) = matches
                .iter()
                .enumerate()
                .max_by_key(|&(rank, &i)| {
                    (
                        proximity(&self.documents[i].path, folder),
                        std::cmp::Reverse(rank),
                    )
                })
                .unwrap();
            return resolved(i, matches.len() > 1);
        }
        Resolution {
            candidates: candidates(raw, folder, true),
            ..Resolution::default()
        }
    }
}

fn proximity(path: &str, folder: &str) -> usize {
    if folder.is_empty() {
        return 0;
    }
    path.split('/')
        .zip(folder.split('/'))
        .take_while(|(a, b)| a == b)
        .count()
}
fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}
fn strip_extension(path: &str) -> &str {
    match path.rsplit_once('.') {
        Some((base, extension)) if !extension.is_empty() && !extension.contains('/') => base,
        _ => path,
    }
}
fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/");
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}
fn candidates(raw: &str, folder: &str, navigation: bool) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    let mut bases = Vec::new();
    if !raw.starts_with('/') && !folder.is_empty() {
        bases.push(normalize(&format!("{folder}/{raw}")));
    }
    bases.push(normalize(raw));
    let mut result: Vec<String> = Vec::new();
    for path in bases {
        if path.is_empty() {
            continue;
        }
        let stem = strip_extension(&path);
        let markdown =
            path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown");
        let mut variants = vec![path.clone()];
        if !navigation {
            variants.push(stem.into());
        }
        if if navigation { stem == path } else { !markdown } {
            variants.extend([format!("{path}.md"), format!("{path}.markdown")]);
        }
        if navigation {
            variants.push(stem.into());
        }
        for variant in variants {
            let variant = normalize(&variant);
            if !variant.is_empty()
                && !result
                    .iter()
                    .any(|v| v.to_lowercase() == variant.to_lowercase())
            {
                result.push(if navigation {
                    variant
                } else {
                    variant.to_lowercase()
                });
            }
        }
    }
    result
}

/// decodeURIComponent: malformed escapes/UTF-8 preserve the entire input.
pub(crate) fn decode(value: &str) -> String {
    let normalized = value.replace('\\', "/").trim().to_owned();
    percent_decode(&normalized)
}

pub(crate) fn percent_decode(value: &str) -> String {
    let normalized = value.to_owned();
    let mut bytes = Vec::new();
    let mut input = normalized.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let Some(a) = input.next().and_then(|b| (b as char).to_digit(16)) else {
                return normalized;
            };
            let Some(b) = input.next().and_then(|b| (b as char).to_digit(16)) else {
                return normalized;
            };
            bytes.push((a * 16 + b) as u8);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).unwrap_or(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_ts_workspace_reference_resolutions() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/editor/navigation.json")).unwrap();
        for graph in fixture["graphs"].as_array().unwrap() {
            let index = Arc::new(ReferenceIndex::new(
                serde_json::from_value(graph["documents"].clone()).unwrap(),
            ));
            for case in graph["cases"].as_array().unwrap() {
                let context = ReferenceContext {
                    source: case["source"].as_str().unwrap().into(),
                    index: index.clone(),
                };
                let target = case["target"].as_str().unwrap();
                let result = if case["kind"] == "wiki" {
                    Some(context.resolve(target))
                } else {
                    context.markdown(target)
                };
                let actual = result.map(|r| serde_json::json!({"exists":r.exists,"ambiguous":r.ambiguous,"path":r.path,"candidates":r.candidates}));
                assert_eq!(
                    serde_json::to_value(actual).unwrap(),
                    case["expected"],
                    "{case}"
                );
            }
        }
    }
    #[test]
    fn qualified_resources_never_fall_back_to_local_paths() {
        let index = ReferenceIndex::new(vec![Document {
            path: "puppyone-local:/foreign/note.md".into(),
            name: "note.md".into(),
        }]);
        assert_eq!(
            index.resolve("source.md", "puppyone-local://foreign/note.md"),
            Resolution::default()
        );
    }
}
