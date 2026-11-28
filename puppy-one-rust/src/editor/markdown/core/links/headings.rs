//! Pane-local heading fragment index derived lazily from `Syntax`
//! (`TA-34`, `TODO-39`, product `core/links/markdownHeadingTargets.ts`).
use super::fragments::fragment;
use crate::editor::{
    markdown::core::syntax::{Kind, Syntax},
    text::buffer::Buffer,
};
use regex::Regex;
use std::{collections::HashMap, sync::LazyLock};

/// In-page fragment targets: explicit inline HTML ids (exact, first wins)
/// before heading slugs (`markdownFragmentTargets.ts`).
#[derive(Clone, Debug, Default)]
pub struct Headings(HashMap<String, usize>, HashMap<String, usize>);

impl Headings {
    /// Derive heading fragment targets from parsed `Syntax` `Kind::Heading`
    /// elements (`TA-34`, `TODO-39`) so `#` lines inside fenced code blocks are
    /// ignored and Setext headings are resolved without re-scanning raw text.
    pub fn from_syntax(doc: &Buffer, syntax: &Syntax) -> Self {
        static TRAILING: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"[ \t]+#+[ \t]*$").unwrap());
        static IMAGE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\([^)]*\)").unwrap());
        static LINK: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\[([^\]]+)\]\([^)]*\)").unwrap());
        static PUNCTUATION: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"[^\p{Letter}\p{Number}\p{Mark}\s_-]").unwrap());
        static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

        let mut positions = HashMap::new();
        let mut ids: HashMap<String, usize> = HashMap::new();
        let mut counts: HashMap<String, usize> = HashMap::new();
        for el in &syntax.elements {
            if el.kind == Kind::InlineHtml
                && let Some(id) = el.html.as_ref().and_then(|h| h.id.clone())
            {
                ids.entry(id).or_insert(el.range.start);
            }
        }

        for el in &syntax.elements {
            if el.kind != Kind::Heading {
                continue;
            }
            let Some(content_span) = &el.content else {
                continue;
            };
            let clamped = doc.clamp_range(content_span.clone());
            if clamped.is_empty() {
                continue;
            }
            let raw = doc.slice_cow(clamped.clone());
            let stripped = TRAILING.replace(&raw, "");
            let leading = stripped.len() - stripped.trim_start().len();
            let text = stripped.trim();
            if text.is_empty() {
                continue;
            }
            let position = clamped.start + leading;
            let plain = IMAGE.replace_all(text, "$1");
            let plain = LINK.replace_all(&plain, "$1");
            let plain = plain.replace(['`', '*', '_', '~'], "").trim().to_owned();
            let lower = plain.to_lowercase();
            let slug = PUNCTUATION.replace_all(&lower, "");
            let slug = WHITESPACE.replace_all(slug.trim(), "-").into_owned();
            let count = counts.entry(slug.clone()).or_default();
            let key = if *count == 0 {
                slug
            } else {
                format!("{slug}-{count}")
            };
            *count += 1;
            for key in [fragment(&plain), fragment(&key)] {
                if !key.is_empty() {
                    positions.entry(key).or_insert(position);
                }
            }
        }
        Self(positions, ids)
    }

    /// The position `key` (`#fragment`) names: an explicit id with exactly
    /// that decoded name, else a heading. A malformed escape names nothing.
    pub fn get(&self, key: &str) -> Option<usize> {
        let exact = super::fragments::decode_exact(key)?;
        self.1
            .get(&exact)
            .or_else(|| self.0.get(&fragment(key)))
            .copied()
    }

    #[cfg(test)]
    pub(crate) fn entries(&self) -> &HashMap<String, usize> {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::markdown::platform::brokers::link::safe_href;

    #[test]
    fn actual_ts_heading_targets_and_url_policy() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/editor/navigation.json"
        ))
        .unwrap();
        // TODO-39: `Headings::from_syntax` uses `Syntax` rather than line regex,
        // so `# In code` inside a fenced code block is properly ignored!
        let code_fence_case = "# Empty\n```md\n# In code\n```\nText\n===\n####### invalid\n";
        for case in fixture["headings"].as_array().unwrap() {
            let src = case["source"].as_str().unwrap();
            let doc = Buffer::new(src);
            let syntax = Syntax::parse(&doc);
            let headings = Headings::from_syntax(&doc, &syntax);
            let expected: HashMap<String, usize> = if src == code_fence_case {
                [("empty".to_owned(), 2usize), ("text".to_owned(), 28usize)]
                    .into_iter()
                    .collect()
            } else {
                serde_json::from_value::<Vec<(String, usize)>>(case["positions"].clone())
                    .unwrap()
                    .into_iter()
                    .collect()
            };
            assert_eq!(headings.0, expected, "{src}");
        }
        // The product's `RELATIVE_PREFIXES` lost `./` to `.//` in the
        // packages→src move (515d798cb), so it refuses `./Space Note.md`.
        // That is a regression of the move, not a policy: keep accepting it.
        let reviewed = [("./Space Note.md", serde_json::json!("./Space Note.md"))];
        for case in fixture["urls"].as_array().unwrap() {
            let value = case["value"].as_str().unwrap();
            let expected = reviewed
                .iter()
                .find(|(v, _)| *v == value)
                .map_or(&case["expected"], |(_, e)| e);
            assert_eq!(
                serde_json::to_value(safe_href(value)).unwrap(),
                *expected,
                "{case}"
            );
        }
    }

    #[test]
    fn headings_from_syntax_ignore_code_fences_and_resolve_setext() {
        let src = "```python\n# comment not heading\n```\n\nSetext Heading\n==============\n\n## ATX Heading ##\n";
        let doc = Buffer::new(src);
        let syntax = Syntax::parse(&doc);
        let headings = Headings::from_syntax(&doc, &syntax);
        assert_eq!(headings.get("#comment-not-heading"), None);
        assert_eq!(
            headings.get("#setext-heading"),
            Some(src.find("Setext Heading").unwrap())
        );
        assert_eq!(
            headings.get("#atx-heading"),
            Some(src.find("ATX Heading").unwrap())
        );
    }
}
