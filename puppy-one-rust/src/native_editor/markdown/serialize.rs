//! Preserve untouched bytes; re-encode only edited semantic nodes.
use super::parse::parse_kind;
use crate::native_editor::core::{
    document::{Block, Document, Kind, Style},
    text::Text,
};
use pulldown_cmark::Parser;
impl Text {
    pub fn markdown(&self) -> String {
        // Prefer ordinary Markdown, then verify its meaning before emitting it.
        // Adjacent mixed marks can make CommonMark delimiter runs ambiguous.
        let chars: Vec<_> = self.text.chars().collect();
        let mut out = String::new();
        let mut i = 0;
        while i < chars.len() {
            let mark = self.marks[i];
            let mut end = i + 1;
            while end < chars.len() && self.marks[end] == mark {
                end += 1;
            }
            let mut first = i;
            let mut last = end;
            while first < last && chars[first].is_whitespace() {
                escape(chars[first], &mut out);
                first += 1;
            }
            while last > first && chars[last - 1].is_whitespace() {
                last -= 1;
            }
            if first < last {
                let delimiter = match (mark.bold, mark.italic) {
                    (true, true) => "***",
                    (true, false) => "**",
                    (false, true) => "*",
                    _ => "",
                };
                out.push_str(delimiter);
                for &c in &chars[first..last] {
                    escape(c, &mut out);
                }
                out.push_str(delimiter);
            }
            for &c in &chars[last..end] {
                escape(c, &mut out);
            }
            i = end;
        }
        let events: Vec<_> = Parser::new(&out).collect();
        if let Some(Kind::Text(_, parsed)) = parse_kind(&events)
            && parsed.text == self.text
            && self
                .text
                .chars()
                .zip(&self.marks)
                .zip(&parsed.marks)
                .all(|((c, a), b)| c.is_whitespace() || a == b)
        {
            return out;
        }
        // Inline HTML is valid Markdown. Only the small safe formatting subset
        // below is imported as rich text; all other HTML stays source.
        out.clear();
        let mut i = 0;
        while i < chars.len() {
            let mark = self.marks[i];
            let mut end = i + 1;
            while end < chars.len() && self.marks[end] == mark {
                end += 1;
            }
            if mark.bold {
                out.push_str("<strong>");
            }
            if mark.italic {
                out.push_str("<em>");
            }
            for &c in &chars[i..end] {
                if c == '\n' {
                    out.push_str("<br>");
                } else if c.is_whitespace() {
                    out.push_str(&format!("&#{};", c as u32));
                } else {
                    escape(c, &mut out);
                }
            }
            if mark.italic {
                out.push_str("</em>");
            }
            if mark.bold {
                out.push_str("</strong>");
            }
            i = end;
        }
        out
    }
}
fn escape(c: char, out: &mut String) {
    match c {
        '\n' => out.push_str("  \n"),
        '&' => out.push_str("&amp;"),
        c if c.is_ascii_punctuation() => {
            out.push('\\');
            out.push(c);
        }
        c => out.push(c),
    }
}
impl Kind {
    fn markdown(&self) -> String {
        match self {
            Self::Raw(t) => t.text.clone(),
            Self::Text(style, t) => {
                let text = t.markdown();
                match style {
                    Style::Paragraph => text,
                    Style::Heading(n) => {
                        format!(
                            "{} {}",
                            "#".repeat(*n as usize),
                            text.replace("  \n", "<br>")
                        )
                    }
                    Style::Quote => text
                        .lines()
                        .map(|l| format!("> {l}"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                }
            }
            Self::List { start, items } => items
                .iter()
                .enumerate()
                .map(|(i, item)| {
                    let prefix = start
                        .map(|n| format!("{}. ", n + i as u64))
                        .unwrap_or_else(|| "- ".into());
                    let task = match item.checked {
                        Some(true) => "[x] ",
                        Some(false) => "[ ] ",
                        None => "",
                    };
                    let indent = " ".repeat(prefix.len());
                    format!(
                        "{prefix}{task}{}",
                        item.text.markdown().replace('\n', &format!("\n{indent}"))
                    )
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Self::Code { language, text } => {
                let fence = "`".repeat(
                    text.text
                        .split(|c| c != '`')
                        .map(str::len)
                        .max()
                        .unwrap_or(0)
                        .max(2)
                        + 1,
                );
                format!(
                    "{fence}{language}\n{}{fence}",
                    if text.text.ends_with('\n') {
                        text.text.clone()
                    } else {
                        format!("{}\n", text.text)
                    }
                )
            }
            Self::Table { align, rows } => {
                let row = |cells: &[Text]| {
                    format!(
                        "| {} |",
                        cells
                            .iter()
                            .map(|t| t.markdown().replace("  \n", "<br>"))
                            .collect::<Vec<_>>()
                            .join(" | ")
                    )
                };
                let mut lines = vec![row(&rows[0]), format!("| {} |", align.join(" | "))];
                lines.extend(rows.iter().skip(1).map(|r| row(r)));
                lines.join("\n")
            }
        }
    }
}
impl Block {
    fn source(&self) -> String {
        if self.kind == self.initial {
            return self.original.clone();
        }
        let mut text = self.kind.markdown();
        if !matches!(self.kind, Kind::Raw(_)) && self.original.ends_with('\n') {
            text.push('\n');
        }
        text
    }
}
impl Document {
    pub fn source(&self) -> String {
        let mut out = String::new();
        for block in &self.blocks {
            out.push_str(&block.leading);
            out.push_str(&block.source());
        }
        out.push_str(&self.trailing);
        out
    }
}
