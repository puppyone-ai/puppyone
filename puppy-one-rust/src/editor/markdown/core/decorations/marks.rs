//! Inline marks: class spans and syntax-highlight classes resolved, per line
//! and in that line's inline context, into the Kit marks the view draws.
use super::builder::Builder;
use crate::editor::{
    markdown::{core::classes::Class, style::marks as mark_style},
    view::decoration::Mark,
};
use gpui::SharedString;

impl Builder<'_> {
    /// Resolve class spans and highlight classes into Kit marks, per line.
    pub fn marks(&mut self) -> Vec<Mark> {
        let cx = self.cx;
        self.spans.sort_by_key(|s| s.range.start);
        let mut out: Vec<Mark> = Vec::new();
        for (line, context) in self.contexts.iter().enumerate() {
            let Some(context) = context else { continue };
            let range = cx.doc.line_range(line);
            if range.is_empty() {
                continue;
            }
            let hl = cx.syntax.highlights_in(range.clone());
            let first = self
                .spans
                .partition_point(|s| s.range.start < range.start)
                .saturating_sub(64);
            let spans: Vec<&super::builder::ClassSpan> = self.spans[first..]
                .iter()
                .take_while(|s| s.range.start < range.end)
                .filter(|s| s.range.end > range.start && s.range.start < range.end)
                .collect();
            let mut cuts = vec![range.start, range.end];
            for s in &spans {
                cuts.extend([s.range.start, s.range.end]);
            }
            for (r, _) in hl {
                cuts.extend([r.start, r.end]);
            }
            cuts.retain(|c| *c >= range.start && *c <= range.end);
            cuts.sort_unstable();
            cuts.dedup();
            for pair in cuts.windows(2) {
                let seg = pair[0]..pair[1];
                let mut classes = Class::NONE;
                let mut href = None;
                for s in spans
                    .iter()
                    .filter(|s| s.range.start <= seg.start && s.range.end >= seg.end)
                {
                    classes |= s.classes;
                    if href.is_none() {
                        href = s.href.clone();
                    }
                }
                for (r, h) in hl
                    .iter()
                    .filter(|(r, _)| r.start <= seg.start && r.end >= seg.end)
                {
                    let _ = r;
                    classes |= Class::from_hl(*h);
                }
                if classes.has(Class::SYNTAX_LINK) && href.is_none() {
                    href = Some(SharedString::from(cx.doc.slice(seg.clone()).to_owned()));
                }
                let style = mark_style::marks(cx.theme, classes, context, href.as_ref(), cx.live);
                if style.is_plain() {
                    continue;
                }
                match out.last_mut() {
                    Some(last) if last.range.end == seg.start && last.style == style => {
                        last.range.end = seg.end
                    }
                    _ => out.push(Mark { range: seg, style }),
                }
            }
        }
        out
    }
}
