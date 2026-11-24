//! Markdown configuration `StateEffect`s, action/keymap registration, and
//! formatting command helpers (`TA-21`).
use super::{
    composition::MDX_FEATURES,
    core::{
        commands::FormatCommand,
        links::{find_links, find_wiki_links},
        plans::Plan,
        syntax::{Kind, Syntax},
    },
    features, shared,
};
use crate::{
    editor::{
        navigation::{ReferenceContext, Resolution},
        registry::DocumentAssets,
        text::{
            buffer::Buffer,
            change::ChangeSet,
            selection::Selection,
            state::{EditorState, Transaction},
        },
        view::{EditorView, command::Command},
    },
    formats::markdown::MarkdownDialect,
};
use gpui::{Action, App, Context, Div, KeyBinding, actions, prelude::*};
use std::{
    collections::{HashSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
};

pub const FORMAT_FEATURE_ID: &str = "markdown.format";
pub const KEY_CONTEXT: &str = "MarkdownEditor";

actions!(
    markdown_editor,
    [
        ToggleBold,
        ToggleItalic,
        ToggleStrike,
        ToggleCode,
        ToggleUnderline,
        InsertLink,
        Heading0,
        Heading1,
        Heading2,
        Heading3,
        Heading4,
        Heading5,
        Heading6,
        ToggleBulletList,
        ToggleOrderedList,
        ToggleTaskList,
        ToggleQuote,
    ]
);

#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
struct RunFeatureKeybinding {
    feature_index: usize,
    binding_index: usize,
}

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

pub(super) fn register_markdown_keymap(cx: &mut App) {
    let c = Some(KEY_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("secondary-b", ToggleBold, c),
        KeyBinding::new("secondary-i", ToggleItalic, c),
        KeyBinding::new("secondary-shift-x", ToggleStrike, c),
        KeyBinding::new("secondary-d", ToggleStrike, c),
        KeyBinding::new("secondary-e", ToggleCode, c),
        KeyBinding::new("secondary-u", ToggleUnderline, c),
        KeyBinding::new("secondary-k", InsertLink, c),
        KeyBinding::new("secondary-alt-0", Heading0, c),
        KeyBinding::new("secondary-alt-1", Heading1, c),
        KeyBinding::new("secondary-alt-2", Heading2, c),
        KeyBinding::new("secondary-alt-3", Heading3, c),
        KeyBinding::new("secondary-alt-4", Heading4, c),
        KeyBinding::new("secondary-alt-5", Heading5, c),
        KeyBinding::new("secondary-alt-6", Heading6, c),
        KeyBinding::new("secondary-shift-8", ToggleBulletList, c),
        KeyBinding::new("secondary-shift-7", ToggleOrderedList, c),
        KeyBinding::new("secondary-shift-9", ToggleTaskList, c),
        KeyBinding::new("secondary-shift-.", ToggleQuote, c),
    ]);
    for (feature_index, feat) in MDX_FEATURES.iter().enumerate() {
        for (binding_index, kb) in feat.keybindings().iter().enumerate() {
            cx.bind_keys([KeyBinding::new(
                kb.chord,
                RunFeatureKeybinding {
                    feature_index,
                    binding_index,
                },
                c,
            )]);
        }
    }
}

/// `matchMarkdownFormatInput`: the window's format shortcuts, which apply
/// once while held; their auto-repeats do nothing.
fn applies_once_while_held(cmd: FormatCommand) -> bool {
    matches!(
        cmd,
        FormatCommand::Bold
            | FormatCommand::Italic
            | FormatCommand::Underline
            | FormatCommand::Strike
    )
}

pub(super) fn bind_markdown_actions(root: Div, cx: &mut Context<EditorView>) -> Div {
    macro_rules! bind_fmt {
        ($div:expr, $($action:ty => $cmd:expr),* $(,)?) => {{
            let mut d = $div;
            $(
                d = d.on_action(cx.listener(|view, _: &$action, window, cx| {
                    let cmd = $cmd;
                    if applies_once_while_held(cmd) && crate::platform::key_repeat::repeating() {
                        return;
                    }
                    view.run_command(&format_command(cmd), window, cx);
                }));
            )*
            d
        }};
    }
    bind_fmt!(
        root,
        ToggleBold => FormatCommand::Bold,
        ToggleItalic => FormatCommand::Italic,
        ToggleStrike => FormatCommand::Strike,
        ToggleCode => FormatCommand::Code,
        ToggleUnderline => FormatCommand::Underline,
        InsertLink => FormatCommand::Link,
        Heading0 => FormatCommand::Heading(0),
        Heading1 => FormatCommand::Heading(1),
        Heading2 => FormatCommand::Heading(2),
        Heading3 => FormatCommand::Heading(3),
        Heading4 => FormatCommand::Heading(4),
        Heading5 => FormatCommand::Heading(5),
        Heading6 => FormatCommand::Heading(6),
        ToggleBulletList => FormatCommand::BulletList,
        ToggleOrderedList => FormatCommand::OrderedList,
        ToggleTaskList => FormatCommand::TaskList,
        ToggleQuote => FormatCommand::Quote,
    )
    .on_action(
        cx.listener(|view, action: &RunFeatureKeybinding, window, cx| {
            if let Some(feat) = MDX_FEATURES.get(action.feature_index)
                && let Some(kb) = feat.keybindings().get(action.binding_index)
            {
                let cmd = (kb.command)();
                view.run_command(&cmd, window, cx);
            }
        }),
    )
}

/// Rewrite pasted multiline/pipe text inside an editable Markdown table cell
/// so pipe-table syntax stays valid.
pub(super) fn filter_table_cell_paste(tr: &mut Transaction, state: &EditorState, plans: &[Plan]) {
    let changes = tr.changes.changes();
    if changes.len() != 1 {
        return;
    }
    let c = &changes[0];
    let in_table_cell = plans.iter().any(|plan| {
        let Some(embed) = plan.embed().filter(|e| e.feature == features::table::ID) else {
            return false;
        };
        if c.range.start < plan.source.start || c.range.end > plan.source.end {
            return false;
        }
        let check_table = |table: &features::table::model::Table| {
            table.range.start <= c.range.start
                && c.range.end <= table.range.end
                && table.rows.iter().any(|row| {
                    row.cells.iter().any(|cell| {
                        cell.editable
                            && cell.range.start <= c.range.start
                            && c.range.end <= cell.range.end
                    })
                })
        };
        if embed.built_for(&state.doc, plan.source.start)
            && let Some(table) = embed.model::<features::table::model::Table>()
        {
            check_table(table)
        } else {
            features::table::model::table_block(&state.doc, &plan.source)
                .is_some_and(|table| check_table(&table))
        }
    });
    if !in_table_cell {
        return;
    }
    let sanitized = sanitize_table_cell_paste(&c.insert);
    if sanitized != c.insert {
        let range = c.range.clone();
        let cursor = range.start + sanitized.len();
        tr.changes = ChangeSet::replace(range, sanitized);
        tr.selection = Some(Selection::cursor(cursor));
    }
}

/// Sanitize clipboard text pasted directly into an editable Markdown table cell
/// (`tableCommands.ts` `normalizeMarkdownTableCellInput` / `tableModel.ts`
/// `sanitizeMarkdownTableCell`): fold internal line-break runs into a single
/// space and escape unescaped pipes (`|`) as `\|` so the pipe table stays valid.
fn sanitize_table_cell_paste(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim_matches('\n');
    let mut folded = String::with_capacity(trimmed.len());
    let mut in_newline = false;
    for ch in trimmed.chars() {
        if ch == '\n' {
            if !in_newline {
                folded.push(' ');
            }
            in_newline = true;
        } else {
            in_newline = false;
            folded.push(ch);
        }
    }
    let mut out = String::with_capacity(folded.len());
    let mut backslashes = 0usize;
    for ch in folded.chars() {
        if ch == '\\' {
            backslashes += 1;
            out.push(ch);
        } else if ch == '|' {
            if backslashes.is_multiple_of(2) {
                out.push('\\');
            }
            backslashes = 0;
            out.push('|');
        } else {
            backslashes = 0;
            out.push(ch);
        }
    }
    out
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
                        let decoded = shared::token_scan::decode_entities(&raw);
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
                let decoded = shared::token_scan::decode_entities(&slice);
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
