//! Pulldown-cmark adapter with editable source fallback.
use crate::native_editor::core::{
    document::{Block, Document, Item, Kind, Style},
    text::{Mark, Text},
};
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
impl Document {
    pub fn parse(source: &str, markdown: bool) -> Self {
        if !markdown {
            return Self::raw(source);
        }
        if source.is_empty() {
            let kind = Kind::Text(Style::Paragraph, Text::default());
            return Self {
                blocks: vec![Block {
                    leading: String::new(),
                    original: String::new(),
                    initial: kind.clone(),
                    kind,
                }],
                trailing: String::new(),
            };
        }
        let events: Vec<_> = Parser::new_ext(
            source,
            Options::ENABLE_TABLES
                | Options::ENABLE_TASKLISTS
                | Options::ENABLE_STRIKETHROUGH
                | Options::ENABLE_FOOTNOTES
                | Options::ENABLE_MATH,
        )
        .into_offset_iter()
        .collect();
        let mut blocks = Vec::new();
        let mut i = 0;
        let mut cursor = 0;
        while i < events.len() {
            let start = i;
            let from = events[i].1.start;
            if matches!(events[i].0, Event::Start(_)) {
                let mut depth = 1;
                i += 1;
                while i < events.len() && depth > 0 {
                    match events[i].0 {
                        Event::Start(_) => depth += 1,
                        Event::End(_) => depth -= 1,
                        _ => {}
                    }
                    i += 1;
                }
            } else {
                i += 1;
            }
            let to = events[i - 1].1.end;
            if from < cursor || to < from {
                continue;
            }
            let original = source[from..to].to_string();
            let slice: Vec<_> = events[start..i].iter().map(|(e, _)| e.clone()).collect();
            let kind = parse_kind(&slice).unwrap_or_else(|| Kind::Raw(Text::plain(&original)));
            blocks.push(Block {
                leading: source[cursor..from].into(),
                original,
                initial: kind.clone(),
                kind,
            });
            cursor = to;
            if blocks.iter().map(|b| b.kind.texts().len()).sum::<usize>() > 512 {
                return Self::raw(source);
            }
        }
        if blocks.is_empty() {
            return Self::raw(source);
        }
        Self {
            blocks,
            trailing: source[cursor..].into(),
        }
    }
}
fn inline(events: &[Event<'_>]) -> Option<Text> {
    let mut out = Text::default();
    let mut bold = 0;
    let mut italic = 0;
    let mut html = Vec::new();
    for event in events {
        match event {
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold -= 1,
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic -= 1,
            Event::Text(s) => out.push(
                s,
                Mark {
                    bold: bold > 0,
                    italic: italic > 0,
                },
            ),
            Event::SoftBreak | Event::HardBreak => out.push("\n", Mark::default()),
            Event::InlineHtml(s) => match s.as_ref() {
                "<strong>" => {
                    bold += 1;
                    html.push("strong");
                }
                "<em>" => {
                    italic += 1;
                    html.push("em");
                }
                "</strong>" if html.pop() == Some("strong") => bold -= 1,
                "</em>" if html.pop() == Some("em") => italic -= 1,
                "<br>" | "<br/>" | "<br />" => out.push(
                    "\n",
                    Mark {
                        bold: bold > 0,
                        italic: italic > 0,
                    },
                ),
                _ => return None,
            },
            _ => return None,
        }
    }
    (html.is_empty() && bold == 0 && italic == 0).then_some(out)
}
pub(super) fn parse_kind(events: &[Event<'_>]) -> Option<Kind> {
    let inner = events.get(1..events.len().checked_sub(1)?)?;
    match events.first()? {
        Event::Start(Tag::Paragraph) => Some(Kind::Text(Style::Paragraph, inline(inner)?)),
        Event::Start(Tag::Heading { level, .. }) => {
            Some(Kind::Text(Style::Heading(*level as u8), inline(inner)?))
        }
        Event::Start(Tag::BlockQuote(_))
            if matches!(inner.first(), Some(Event::Start(Tag::Paragraph)))
                && matches!(inner.last(), Some(Event::End(TagEnd::Paragraph))) =>
        {
            Some(Kind::Text(
                Style::Quote,
                inline(&inner[1..inner.len() - 1])?,
            ))
        }
        Event::Start(Tag::CodeBlock(kind)) => {
            let mut text = String::new();
            for event in inner {
                if let Event::Text(s) = event {
                    text.push_str(s)
                } else {
                    return None;
                }
            }
            let language = match kind {
                CodeBlockKind::Fenced(s) if !s.contains('`') => s.to_string(),
                CodeBlockKind::Indented => String::new(),
                _ => return None,
            };
            Some(Kind::Code {
                language,
                text: Text::plain(text),
            })
        }
        Event::Start(Tag::List(start)) => {
            let mut items = Vec::new();
            let mut i = 0;
            while i < inner.len() {
                if inner[i] != Event::Start(Tag::Item) {
                    return None;
                }
                i += 1;
                let end = inner[i..]
                    .iter()
                    .position(|e| *e == Event::End(TagEnd::Item))?
                    + i;
                let mut slice = &inner[i..end];
                if matches!(slice.first(), Some(Event::Start(Tag::Paragraph)))
                    && matches!(slice.last(), Some(Event::End(TagEnd::Paragraph)))
                {
                    slice = &slice[1..slice.len() - 1];
                }
                let checked = if let Some(Event::TaskListMarker(v)) = slice.first() {
                    let v = *v;
                    slice = &slice[1..];
                    Some(v)
                } else {
                    None
                };
                items.push(Item {
                    checked,
                    text: inline(slice)?,
                });
                i = end + 1;
            }
            (!items.is_empty()).then_some(Kind::List {
                start: *start,
                items,
            })
        }
        Event::Start(Tag::Table(alignment)) => {
            let align = alignment
                .iter()
                .map(|a| {
                    match a {
                        pulldown_cmark::Alignment::Left => ":---",
                        pulldown_cmark::Alignment::Center => ":---:",
                        pulldown_cmark::Alignment::Right => "---:",
                        _ => "---",
                    }
                    .into()
                })
                .collect::<Vec<_>>();
            let mut rows = Vec::new();
            let mut row = Vec::new();
            let mut i = 0;
            while i < inner.len() {
                match &inner[i] {
                    Event::Start(Tag::TableHead | Tag::TableRow) => row = Vec::new(),
                    Event::End(TagEnd::TableHead | TagEnd::TableRow) => {
                        if row.len() != align.len() {
                            return None;
                        }
                        rows.push(std::mem::take(&mut row));
                    }
                    Event::Start(Tag::TableCell) => {
                        i += 1;
                        let end = inner[i..]
                            .iter()
                            .position(|e| *e == Event::End(TagEnd::TableCell))?
                            + i;
                        row.push(inline(&inner[i..end])?);
                        i = end;
                    }
                    _ => return None,
                }
                i += 1;
            }
            (!rows.is_empty() && !align.is_empty()).then_some(Kind::Table { align, rows })
        }
        _ => None,
    }
}
