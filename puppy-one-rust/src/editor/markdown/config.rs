//! Markdown configuration `StateEffect`s and formatting command helpers (`TA-21`).
use super::{
    core::{
        commands::FormatCommand,
        links::{find_links, find_wiki_links},
        plans::Plan,
        syntax::{Kind, Syntax},
    },
    shared,
};
use crate::{
    editor::{
        navigation::{ReferenceContext, Resolution},
        registry::DocumentAssets,
        text::buffer::Buffer,
        view::command::Command,
    },
    formats::markdown::MarkdownDialect,
};
use std::{
    collections::{HashSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
};

pub const FORMAT_FEATURE_ID: &str = "markdown.format";

/// Typed configuration `StateEffect`: set live-preview (`true`) vs source mode (`false`) (`TA-21`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetLivePreview(pub bool);

#[derive(Clone, Debug)]
pub struct SetDialect(pub MarkdownDialect);

/// Typed configuration `StateEffect`: toggle live-preview vs source mode (`TA-21`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ToggleLivePreview;

/// Typed configuration `StateEffect`: update workspace link-graph context (`TA-21`).
#[derive(Clone)]
pub struct SetReferences(pub Option<ReferenceContext>);

/// Typed configuration `StateEffect`: update document media asset resolver (`TA-21`).
#[derive(Clone)]
pub struct SetAssets(pub Option<DocumentAssets>);

pub fn format_command(cmd: FormatCommand) -> Command {
    Command::new(FORMAT_FEATURE_ID, cmd)
}

pub(super) fn parse_format_command(cmd: &Command) -> Option<FormatCommand> {
    (cmd.feature() == FORMAT_FEATURE_ID)
        .then(|| cmd.payload::<FormatCommand>().copied())
        .flatten()
}

/// Semantic fingerprint of how `refs` resolves every link and embed currently
/// present in `doc` (including inside block widgets such as tables and MDX
/// Tabs). Unrelated workspace folder loads leave this fingerprint unchanged,
/// avoiding unnecessary decoration invalidation and widget remounts.
pub(super) fn references_fingerprint(
    doc: &Buffer,
    syntax: &Syntax,
    plans: &[Plan],
    refs: Option<&ReferenceContext>,
) -> u64 {
    let hash_resolution = |h: &mut DefaultHasher, res: Option<Resolution>| {
        res.is_some().hash(h);
        if let Some(r) = res {
            (r.exists, r.ambiguous, r.path, r.candidates).hash(h);
        }
    };
    let mut h = DefaultHasher::new();
    let mut entity_lines: HashSet<usize> = HashSet::new();
    for e in &syntax.elements {
        match e.kind {
            Kind::WikiLink | Kind::ImageEmbed | Kind::VideoEmbed => {
                if let Some(target) = e.href.as_deref() {
                    (0u8, e.range.start, e.range.end).hash(&mut h);
                    hash_resolution(&mut h, refs.map(|r| r.resolve(target)));
                }
            }
            Kind::Link => {
                if let Some(href) = e.href.as_deref() {
                    (1u8, e.range.start, e.range.end).hash(&mut h);
                    hash_resolution(&mut h, refs.and_then(|r| r.markdown(href)));
                }
            }
            Kind::InlineHtml | Kind::Entity => {
                let line = doc.line_index(e.range.start.min(doc.len()));
                if entity_lines.insert(line) {
                    let lr = doc.line_range(line);
                    let raw = doc.slice_cow(lr.clone());
                    if raw.contains('&') {
                        let decoded = shared::dom::decode_entities(&raw);
                        for w in find_wiki_links(&decoded) {
                            (4u8, lr.start, w.range.start, w.target.as_str()).hash(&mut h);
                            hash_resolution(&mut h, refs.map(|r| r.resolve(&w.target)));
                        }
                        for l in find_links(&decoded) {
                            (5u8, lr.start, l.range.start, l.href.as_str()).hash(&mut h);
                            hash_resolution(&mut h, refs.and_then(|r| r.markdown(&l.href)));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    for plan in plans {
        if plan.embed().is_some() {
            let slice = doc.slice_cow(plan.source.clone());
            for w in find_wiki_links(&slice) {
                (2u8, plan.source.start + w.range.start, w.target.as_str()).hash(&mut h);
                hash_resolution(&mut h, refs.map(|r| r.resolve(&w.target)));
            }
            for l in find_links(&slice) {
                (3u8, plan.source.start + l.range.start, l.href.as_str()).hash(&mut h);
                hash_resolution(&mut h, refs.and_then(|r| r.markdown(&l.href)));
            }
            if slice.contains('&') {
                let decoded = shared::dom::decode_entities(&slice);
                for w in find_wiki_links(&decoded) {
                    (6u8, plan.source.start, w.range.start, w.target.as_str()).hash(&mut h);
                    hash_resolution(&mut h, refs.map(|r| r.resolve(&w.target)));
                }
                for l in find_links(&decoded) {
                    (7u8, plan.source.start, l.range.start, l.href.as_str()).hash(&mut h);
                    hash_resolution(&mut h, refs.and_then(|r| r.markdown(&l.href)));
                }
            }
        }
    }
    h.finish()
}
