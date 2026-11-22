//! Rendered Markdown link interaction policy
//! (product `core/state/markdownLinkInteraction.ts`).
use super::{model::find_links, references::resolve_reference, wiki::find_wiki_links};
use crate::editor::{
    markdown::{
        core::syntax::{Kind, Syntax},
        platform::brokers::link::safe_href,
    },
    navigation::{self, ReferenceContext},
    text::buffer::Buffer,
    view::extension::{LinkAction, LinkActivation},
};
use std::ops::Range;

/// Decide whether clicking at `offset` activates a rendered link, wiki link,
/// inline HTML anchor, or bidirectional footnote marker.
pub fn link_activation(
    doc: &Buffer,
    syntax: &Syntax,
    reveal: Option<&Range<usize>>,
    references: Option<&ReferenceContext>,
    offset: usize,
    release: bool,
    mut heading_position: impl FnMut(&str) -> Option<usize>,
) -> Option<LinkActivation> {
    // Elements are sorted by `range.start`; inspect only candidates starting
    // at or before `offset`.
    let upper = syntax.elements.partition_point(|e| e.range.start <= offset);
    // A footnote marker jumps to its definition, and a definition to its
    // first reference (FootnoteMarkerWidget).
    if let Some(note) = syntax.elements[..upper].iter().rev().find(|e| {
        matches!(e.kind, Kind::FootnoteReference | Kind::FootnoteDefinition)
            && e.range.contains(&offset)
            && (release || reveal != Some(&e.range))
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
            && (release || reveal != Some(&element.range))
    })?;
    let source_cow = doc.slice_cow(element.range.clone());
    let source = source_cow.as_ref();
    let wiki = element.kind == Kind::WikiLink;
    let target = if wiki {
        find_wiki_links(source).first()?.target.clone()
    } else if element.kind == Kind::InlineHtml {
        element.href.clone()?
    } else {
        find_links(source)
            .first()
            .map(|link| link.href.clone())
            .or_else(|| {
                source.starts_with('<').then(|| {
                    doc.slice_cow(element.content.clone().unwrap())
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
        action: resolve_link_action(references, target, wiki, &mut heading_position)?,
        label: element.content.clone()?,
    })
}

/// Classify where an authored link target leads (in-document heading,
/// external URL, or workspace document) through the canonical URL policy.
pub fn resolve_link_action(
    references: Option<&ReferenceContext>,
    target: &str,
    wiki: bool,
    mut heading_position: impl FnMut(&str) -> Option<usize>,
) -> Option<LinkAction> {
    let href = if wiki {
        target.to_owned()
    } else {
        safe_href(target)?
    };
    let action = if href.starts_with('#') {
        LinkAction::Position(heading_position(&href)?)
    } else if !wiki && url::Url::parse(&href).is_ok() {
        LinkAction::External(href)
    } else {
        let context = references?;
        let resolved = resolve_reference(context, &href, wiki)?;
        if !resolved.exists {
            return None;
        }
        if !wiki
            && resolved.path.as_deref() == Some(&context.source)
            && let Some((_, fragment)) = navigation::markdown_target(&href)?.split_once('#')
            && !fragment.is_empty()
        {
            LinkAction::Position(heading_position(fragment)?)
        } else {
            LinkAction::Workspace(resolved.candidates)
        }
    };
    Some(action)
}

#[cfg(test)]
mod tests {
    use super::super::headings::Headings;
    use crate::{
        editor::{
            markdown::{MarkdownExtension, composition::FEATURES, core::syntax::Syntax},
            navigation::{Document, ReferenceContext, ReferenceIndex},
            text::{
                buffer::Buffer,
                change::ChangeSet,
                selection::Selection,
                state::{EditorState, Transaction, UserEvent},
            },
            view::extension::{EditorExtension, LinkAction},
        },
        typography::Scale,
    };

    #[test]
    fn markdown_navigation_uses_syntax_and_reveal_state() {
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
            let mut keys: Vec<_> = Headings::from_syntax(doc, syntax)
                .entries()
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect();
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
