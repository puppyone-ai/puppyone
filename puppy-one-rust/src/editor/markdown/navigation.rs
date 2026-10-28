//! Rendered Markdown link activation and pane-local heading targets. The view
//! handles pointer gestures; this format owns syntax, reveal and URL policy.
use super::{
    MarkdownExtension,
    core::{links, syntax::Kind},
};
use crate::editor::{
    navigation,
    text::state::EditorState,
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
        let element = syntax.elements.iter().find(|element| {
            matches!(element.kind, Kind::Link | Kind::WikiLink)
                && element
                    .content
                    .as_ref()
                    .is_some_and(|range| range.contains(&offset))
                && (release || self.preview.reveal.as_ref() != Some(&element.range))
        })?;
        let source = state.doc.slice(element.range.clone());
        let wiki = element.kind == Kind::WikiLink;
        let target = if wiki {
            links::find_wiki_links(source).first()?.target.clone()
        } else {
            links::find_links(source)
                .first()
                .map(|link| link.href.clone())
                .or_else(|| {
                    source.starts_with('<').then(|| {
                        state
                            .doc
                            .slice(element.content.clone().unwrap())
                            .trim()
                            .to_owned()
                    })
                })?
        };
        let target = target.trim();
        let key = format!("{}:{target}", if wiki { "wiki" } else { "href" });
        let href = if wiki {
            target.to_owned()
        } else {
            safe_href(target)?
        };
        let action = if href.starts_with('#') {
            LinkAction::Position(self.parsed.as_ref()?.headings.get(&href)?)
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
                LinkAction::Position(self.parsed.as_ref()?.headings.get(fragment)?)
            } else {
                LinkAction::Workspace(resolved.candidates)
            }
        };
        Some(LinkActivation {
            key,
            action,
            label: element.content.clone()?,
        })
    }
}

/// `getSafeMarkdownHref`: validate the canonical value that will be opened.
fn safe_href(value: &str) -> Option<String> {
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

pub(super) struct Headings(HashMap<String, usize>);
impl Headings {
    pub fn new(source: &str) -> Self {
        static ATX: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^\s{0,3}#{1,6}(?:[ \t]+|$)(.*)$").unwrap());
        static TRAILING: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"[ \t]+#+[ \t]*$").unwrap());
        static SETEXT: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^\s{0,3}(?:=+|-+)\s*$").unwrap());
        static IMAGE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\([^)]*\)").unwrap());
        static LINK: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\[([^\]]+)\]\([^)]*\)").unwrap());
        static PUNCTUATION: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"[^\p{Letter}\p{Number}\p{Mark}\s_-]").unwrap());
        static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
        let mut positions = HashMap::new();
        let mut counts: HashMap<String, usize> = HashMap::new();
        let mut lines = source.split('\n').peekable();
        let mut start = 0;
        while let Some(line) = lines.next() {
            let atx = ATX
                .captures(line)
                .map(|c| TRAILING.replace(&c[1], "").trim().to_owned())
                .filter(|s| !s.is_empty());
            let text = atx
                .or_else(|| {
                    lines
                        .peek()
                        .filter(|next| SETEXT.is_match(next))
                        .map(|_| line.trim().to_owned())
                })
                .filter(|s| !s.is_empty());
            if let Some(text) = text {
                let position = start + line.find(&text).unwrap_or(0);
                let plain = IMAGE.replace_all(&text, "$1");
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
            start += line.len() + 1;
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
    #[test]
    fn actual_ts_heading_targets_and_url_policy() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/editor/navigation.json")).unwrap();
        for case in fixture["headings"].as_array().unwrap() {
            let headings = Headings::new(case["source"].as_str().unwrap());
            let expected: HashMap<String, usize> =
                serde_json::from_value::<Vec<(String, usize)>>(case["positions"].clone())
                    .unwrap()
                    .into_iter()
                    .collect();
            assert_eq!(headings.0, expected, "{}", case["source"]);
        }
        for case in fixture["urls"].as_array().unwrap() {
            assert_eq!(
                serde_json::to_value(safe_href(case["value"].as_str().unwrap())).unwrap(),
                case["expected"],
                "{case}"
            );
        }
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
}
