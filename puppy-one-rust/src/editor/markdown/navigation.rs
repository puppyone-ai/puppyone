//! Rendered Markdown link activation and pane-local heading targets.
//! - `Headings::from_syntax` (`TA-34`, `TODO-39`): derives heading targets
//!   lazily from `Syntax` `Kind::Heading` elements (ATX and Setext), never
//!   running a full-document regex scan on keystrokes and never matching `#`
//!   comments inside fenced code blocks.
use super::{
    MarkdownExtension,
    core::{
        links,
        syntax::{Kind, Syntax},
    },
};
use crate::editor::{
    navigation,
    text::{buffer::Buffer, state::EditorState},
    view::extension::{LinkAction, LinkActivation},
};
use regex::Regex;
use std::{collections::HashMap, sync::LazyLock};

impl MarkdownExtension {
    pub(super) fn link_activation(
        &mut self,
        state: &EditorState,
        offset: usize,
        release: bool,
    ) -> Option<LinkActivation> {
        if !self.live || self.read_only {
            return None;
        }
        let (syntax, _) = self.parse(state);
        // Elements are sorted by `range.start`; inspect only candidates starting
        // at or before `offset`.
        let upper = syntax.elements.partition_point(|e| e.range.start <= offset);
        // A footnote marker jumps to its definition, and a definition to its
        // first reference (FootnoteMarkerWidget).
        if let Some(note) = syntax.elements[..upper].iter().rev().find(|e| {
            matches!(e.kind, Kind::FootnoteReference | Kind::FootnoteDefinition)
                && e.range.contains(&offset)
                && (release || self.preview.reveal.as_ref() != Some(&e.range))
        }) {
            return Some(LinkActivation {
                label: note.range.clone(),
                key: format!("footnote:{:?}:{}", note.kind, note.href.as_deref()?),
                action: LinkAction::Position(syntax.footnotes.target(note)?),
            });
        }
        let element = syntax.elements[..upper].iter().rev().find(|element| {
            (matches!(element.kind, Kind::Link | Kind::WikiLink)
                || element.kind == Kind::InlineHtml && element.href.is_some())
                && element
                    .content
                    .as_ref()
                    .is_some_and(|range| range.contains(&offset))
                && (release || self.preview.reveal.as_ref() != Some(&element.range))
        })?;
        let source_cow = state.doc.slice_cow(element.range.clone());
        let source = source_cow.as_ref();
        let wiki = element.kind == Kind::WikiLink;
        let target = if wiki {
            links::find_wiki_links(source).first()?.target.clone()
        } else if element.kind == Kind::InlineHtml {
            element.href.clone()?
        } else {
            links::find_links(source)
                .first()
                .map(|link| link.href.clone())
                .or_else(|| {
                    source.starts_with('<').then(|| {
                        state
                            .doc
                            .slice_cow(element.content.clone().unwrap())
                            .trim()
                            .to_owned()
                    })
                })
                // A bare URL, or a reference link's definition.
                .or_else(|| element.href.clone())?
        };
        let target = target.trim();
        let key = format!("{}:{target}", if wiki { "wiki" } else { "href" });
        Some(LinkActivation {
            key,
            action: self.link_action(state, target, wiki)?,
            label: element.content.clone()?,
        })
    }

    /// Where an authored link target leads (a wiki target, or an href
    /// through the URL policy).
    pub(super) fn link_action(
        &mut self,
        state: &EditorState,
        target: &str,
        wiki: bool,
    ) -> Option<LinkAction> {
        let href = if wiki {
            target.to_owned()
        } else {
            safe_href(target)?
        };
        let action = if href.starts_with('#') {
            LinkAction::Position(self.heading_position(state, &href)?)
        } else if !wiki && url::Url::parse(&href).is_ok() {
            LinkAction::External(href)
        } else {
            let context = self.references.as_ref()?;
            let resolved = if wiki {
                context.resolve(&href)
            } else {
                context.markdown(&href)?
            };
            if !resolved.exists {
                return None;
            }
            if !wiki
                && resolved.path.as_deref() == Some(&context.source)
                && let Some((_, fragment)) = navigation::markdown_target(&href)?.split_once('#')
                && !fragment.is_empty()
            {
                LinkAction::Position(self.heading_position(state, fragment)?)
            } else {
                LinkAction::Workspace(resolved.candidates)
            }
        };
        Some(action)
    }
}

/// `getSafeMarkdownHref`: validate the canonical value that will be opened.
pub(crate) fn safe_href(value: &str) -> Option<String> {
    static ENTITY: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));").unwrap());
    static CONTROLS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)[\x00-\x1f\x7f]|%(?:0[0-9a-f]|1[0-9a-f]|7f)").unwrap());
    static SCHEME: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*:").unwrap());
    static SMUGGLING: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*\s*:").unwrap());
    let decoded = ENTITY.replace_all(value, |c: &regex::Captures| {
        if let Some(name) = c.get(3) {
            return match name.as_str().to_ascii_lowercase().as_str() {
                "amp" => "&",
                "apos" => "'",
                "gt" => ">",
                "lt" => "<",
                "nbsp" => "\u{a0}",
                "quot" => "\"",
                _ => &c[0],
            }
            .to_owned();
        }
        let (digits, radix) = c
            .get(1)
            .map(|m| (m.as_str(), 10))
            .unwrap_or_else(|| (c.get(2).unwrap().as_str(), 16));
        u32::from_str_radix(digits, radix)
            .ok()
            .filter(|&n| n != 0)
            .and_then(char::from_u32)
            .unwrap_or('\u{fffd}')
            .to_string()
    });
    if CONTROLS.is_match(&decoded) {
        return None;
    }
    let value = decoded.trim();
    if value.is_empty() || value.starts_with("//") {
        return None;
    }
    if ["#", "/", "./", "../"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
    {
        return Some(value.into());
    }
    if !SCHEME.is_match(value) {
        return (!SMUGGLING.is_match(value)
            && !value
                .chars()
                .any(|c| c.is_whitespace() || "<>\"'`".contains(c)))
        .then(|| value.into());
    }
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "mailto")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.into())
}

#[derive(Clone, Debug, Default)]
pub(super) struct Headings(HashMap<String, usize>);

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
        let mut counts: HashMap<String, usize> = HashMap::new();

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
        Self(positions)
    }

    pub fn get(&self, key: &str) -> Option<usize> {
        self.0.get(&fragment(key)).copied()
    }
}

fn fragment(value: &str) -> String {
    navigation::percent_decode(value.trim().strip_prefix('#').unwrap_or(value.trim()))
        .trim()
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn actual_ts_heading_targets_and_url_policy() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/editor/navigation.json")).unwrap();
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

    /// `markdownUrlPolicy.test.ts`: control characters (raw, entity-encoded
    /// or percent-encoded), `javascript:` behind an entity colon,
    /// `vbscript:` and `data:` schemes, scheme-relative URLs and credentials
    /// are refused; https, relative paths and fragments open, a URL in its
    /// canonical form.
    #[test]
    fn the_url_policy_refuses_obfuscated_and_unsafe_targets() {
        for refused in [
            "java\nscript:alert(1)",
            "java\tscript:alert(1)",
            "java&#10;script:alert(1)",
            "javascript&#58;alert(1)",
            "vbscript:msgbox(1)",
            "data:text/html,<script>alert(1)</script>",
            "//evil.example/path",
            "https://example.com/%0aheader",
            "https://user:pass@example.com/path",
        ] {
            assert_eq!(safe_href(refused), None, "{refused:?}");
        }
        for (allowed, opens) in [
            ("https://example.com/a", "https://example.com/a"),
            ("./note.md", "./note.md"),
            ("#section", "#section"),
            ("note.md", "note.md"),
            ("HTTPS://EXAMPLE.COM/a", "https://example.com/a"),
        ] {
            assert_eq!(safe_href(allowed).as_deref(), Some(opens), "{allowed:?}");
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

    #[test]
    fn markdown_navigation_uses_syntax_and_reveal_state() {
        use crate::{
            editor::{
                navigation::{Document, ReferenceContext, ReferenceIndex},
                text::selection::Selection,
                view::extension::EditorExtension,
            },
            typography::Scale,
        };
        let text = "# Title\n\n[[Target|alias]] and [page](Target.md)\n\n`[code](Target.md)`\n\n```\n[[Target]]\n```\n\n![image](Target.md)\n";
        let mut state = EditorState::new(text);
        let mut extension = MarkdownExtension::new(true, Scale::Medium);
        extension.references = Some(ReferenceContext {
            source: "dir/source.md".into(),
            index: std::sync::Arc::new(ReferenceIndex::new(vec![Document {
                path: "dir/Target.md".into(),
                name: "Target.md".into(),
            }])),
        });
        let offset = text.find("alias").unwrap();
        assert_eq!(
            extension.link_at(&state, offset, false).unwrap().action,
            LinkAction::Workspace(vec!["dir/Target.md".into()])
        );
        for value in ["code", "image"] {
            assert!(
                extension
                    .link_at(&state, text.find(value).unwrap(), false)
                    .is_none()
            );
        }
        assert!(
            extension
                .link_at(&state, text.rfind("Target]]").unwrap(), false)
                .is_none()
        );
        state.selection = Selection::cursor(offset);
        extension.selection_changed(&state, true, false);
        assert!(
            extension.link_at(&state, offset, false).is_none(),
            "editing the source must not navigate"
        );
        assert!(
            extension.link_at(&state, offset, true).is_some(),
            "release revalidates target even after selection reveal"
        );
        extension.live = false;
        assert!(extension.link_at(&state, offset, true).is_none());
    }

    /// `markdownLinkInteraction.test.ts`: `classifies only executable
    /// destinations as navigation`, `fails closed for missing targets,
    /// unsafe hrefs, and absent host commands` (without a workspace context
    /// a workspace link leads nowhere), `indexes ATX, setext, Unicode, and
    /// duplicate heading fragments`, `keeps the pane-local heading index
    /// exact across incremental edits`.
    #[test]
    fn links_navigate_only_to_executable_targets_and_headings_stay_exact() {
        use crate::{
            editor::{
                markdown::composition::FEATURES,
                navigation::{Document, ReferenceContext, ReferenceIndex},
                text::{
                    change::ChangeSet,
                    state::{Transaction, UserEvent},
                },
            },
            typography::Scale,
        };
        let state = EditorState::new("# Current\n\nText");
        let context = ReferenceContext {
            source: "notes/current.md".into(),
            index: std::sync::Arc::new(ReferenceIndex::new(vec![
                Document {
                    path: "notes/current.md".into(),
                    name: "current.md".into(),
                },
                Document {
                    path: "notes/target.md".into(),
                    name: "target.md".into(),
                },
            ])),
        };
        let mut md = MarkdownExtension::new(true, Scale::Medium);
        md.references = Some(context);
        let mut action = |target: &str, wiki: bool| md.link_action(&state, target, wiki);
        assert_eq!(action("#current", false), Some(LinkAction::Position(2)));
        assert_eq!(
            action("target.md", false),
            Some(LinkAction::Workspace(vec!["notes/target.md".into()]))
        );
        assert_eq!(
            action("https://example.com", false),
            Some(LinkAction::External("https://example.com/".into()))
        );
        for (target, wiki) in [
            ("#missing", false),
            ("javascript:alert(1)", false),
            ("missing", true),
        ] {
            assert_eq!(action(target, wiki), None, "{target}");
        }
        let mut bare = MarkdownExtension::new(true, Scale::Medium);
        assert_eq!(bare.link_action(&state, "target.md", false), None);

        let headings = |doc: &Buffer, syntax: &Syntax| {
            let mut keys: Vec<_> = Headings::from_syntax(doc, syntax).0.into_iter().collect();
            keys.sort();
            keys
        };
        let source = "# Hello **world**\n\n设计哲学\n------\n\n# Repeat\n# Repeat";
        let doc = Buffer::new(source);
        let found = headings(&doc, &Syntax::parse(&doc));
        for name in ["hello-world", "设计哲学", "repeat", "repeat-1"] {
            assert!(found.iter().any(|(k, _)| k == name), "{name}");
        }

        let mut state = EditorState::new("# First\n\n设计哲学\n------\n\n# Repeat\n# Repeat");
        let mut syntax = Syntax::parse_with(&state.doc, FEATURES);
        for edit in [
            |t: &str| {
                (
                    t.find("First").unwrap()..t.find("First").unwrap() + 5,
                    "Renamed",
                )
            },
            |t: &str| {
                (
                    t.find("------").unwrap()..t.find("------").unwrap() + 6,
                    "ordinary",
                )
            },
            |t: &str| {
                (
                    t.rfind("# Repeat").unwrap()..t.rfind("# Repeat").unwrap(),
                    "## Inserted\n",
                )
            },
        ] {
            let (range, text) = edit(state.doc.as_str());
            let applied = state
                .apply(Transaction::edit(
                    ChangeSet::replace(range, text),
                    None,
                    UserEvent::Input,
                ))
                .unwrap();
            syntax = Syntax::try_parse_incremental(
                &state.doc,
                &applied.before_doc,
                &syntax,
                &applied.changes,
                FEATURES,
            )
            .map_or_else(|| Syntax::parse_with(&state.doc, FEATURES), |(s, _)| s);
            assert_eq!(
                headings(&state.doc, &syntax),
                headings(&state.doc, &Syntax::parse_with(&state.doc, FEATURES))
            );
        }
        assert!(
            Headings::from_syntax(&state.doc, &syntax)
                .get("#repeat-1")
                .is_some()
        );
    }
}
