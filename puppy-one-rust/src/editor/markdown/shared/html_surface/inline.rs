//! Inline formatting contexts, text runs, clickable links, and placeholder chips
//! for [`Surface`].
use super::{Inherit, Piece, Surface, style_color};
use crate::editor::{
    markdown::shared::dom::{MAX_HTML_DEPTH, Node},
    view::render::RenderCx,
};
use gpui::{prelude::*, *};

/// Resolves `<b>` / `<strong>` weight inside an HTML surface: never downgrades
/// a heavier inherited container weight (such as `<th>` at `650` or headings).
pub(crate) fn resolved_strong_weight(inherited: f32, strong: f32) -> f32 {
    inherited.max(strong)
}

impl Surface<'_, '_, '_, '_> {
    /// `.cm-md-image-placeholder`: muted meta text in a bordered chip.
    pub(super) fn chip(&mut self, label: &str, inherit: &Inherit) -> AnyElement {
        let t = crate::theme::Theme::new(self.theme.dark);
        let mut meta = inherit.text.clone();
        meta.size = crate::theme::ty().ui.meta;
        meta.color = t.muted;
        let mut chip = div()
            .flex()
            .items_center()
            .min_h(px(22.))
            .px(px(8.))
            .border_1()
            .border_color(t.border_subtle)
            .rounded(px(self.theme.block.radius))
            .bg(crate::theme::mix(
                t.control,
                Rgba { a: 0., ..t.control },
                0.26,
            ));
        meta.apply(chip.style());
        // Named by its subject (an image's alt), without the failure reason.
        let shown = label.split(" · ").next().unwrap_or(label).to_owned();
        div()
            .flex()
            .debug_selector(move || format!("md-html-chip:{shown}"))
            .child(chip.child(SharedString::from(label.to_owned())))
            .into_any_element()
    }

    pub(super) fn inline(
        &mut self,
        node: &Node,
        inherit: &Inherit,
        out: &mut Vec<Piece>,
        available: f32,
        depth: usize,
    ) {
        if depth > MAX_HTML_DEPTH {
            return;
        }
        let e = match node {
            Node::Text(text) => {
                let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
                let lead = text.starts_with(char::is_whitespace) && !collapsed.is_empty();
                let trail = text.ends_with(char::is_whitespace);
                let mut shown = String::new();
                if lead || (collapsed.is_empty() && !text.is_empty()) {
                    shown.push(' ');
                }
                shown.push_str(&collapsed);
                if trail && !collapsed.is_empty() {
                    shown.push(' ');
                }
                if !shown.is_empty() {
                    out.push(Piece::Text(shown, inherit.clone()));
                }
                return;
            }
            Node::Element(e) => e,
        };
        let mut inherit = inherit.clone();
        let t = self.theme;
        match e.tag.as_str() {
            "br" => return out.push(Piece::Break),
            "img" | "picture" | "svg" => {
                let atom = self.image(e, &inherit, available);
                return out.push(Piece::Atom(atom));
            }
            "b" | "strong" => {
                inherit.text.weight =
                    resolved_strong_weight(inherit.text.weight, t.inline.strong_weight);
            }
            "i" | "em" | "cite" | "var" | "dfn" => inherit.text.italic = true,
            "s" | "del" | "strike" => inherit.strike = true,
            "u" | "ins" => inherit.underline = true,
            "code" | "kbd" | "samp" | "tt" => {
                inherit.mono = true;
                inherit.background = Some(t.inline.code_background);
                if let Some(c) = t.inline.code_color {
                    inherit.text.color = c;
                }
            }
            "mark" => {
                let (background, text) = crate::editor::tokens::mark_colors();
                inherit.background = Some(background);
                inherit.text.color = text;
            }
            "a" => {
                if let Some(href) = e.attribute("href") {
                    inherit.link = Some(href.trim().to_owned());
                    inherit.text.color = t.inline.link_color;
                }
            }
            "small" | "sub" | "sup" => inherit.text.size /= 1.2,
            _ => {}
        }
        if let Some(c) = style_color(e, "color") {
            inherit.text.color = c;
        }
        if let Some(c) = style_color(e, "background-color") {
            inherit.background = Some(c);
        }
        if e.tag == "q" {
            out.push(Piece::Text("\u{201c}".into(), inherit.clone()));
        }
        for child in &e.children {
            self.inline(child, &inherit, out, available, depth + 1);
        }
        if e.tag == "q" {
            out.push(Piece::Text("\u{201d}".into(), inherit.clone()));
        }
    }

    pub(super) fn inline_flow(&mut self, pieces: Vec<Piece>, inherit: &Inherit) -> AnyElement {
        let mut segments: Vec<AnyElement> = Vec::new();
        let mut text = String::new();
        let mut runs: Vec<TextRun> = Vec::new();
        let mut links: Vec<(std::ops::Range<usize>, String)> = Vec::new();
        let has_atoms = pieces.iter().any(|p| matches!(p, Piece::Atom(_)));
        let base = inherit.text.clone();
        let flush = |s: &mut Self,
                     text: &mut String,
                     runs: &mut Vec<TextRun>,
                     links: &mut Vec<(std::ops::Range<usize>, String)>,
                     segments: &mut Vec<AnyElement>| {
            if text.trim().is_empty() && segments.is_empty() {
                text.clear();
                runs.clear();
                links.clear();
                return;
            }
            let styled = StyledText::new(SharedString::from(std::mem::take(text)))
                .with_runs(std::mem::take(runs));
            let targets: Vec<String> = links.iter().map(|(_, h)| h.clone()).collect();
            let ranges: Vec<_> = std::mem::take(links).into_iter().map(|(r, _)| r).collect();
            let view = s.view.clone();
            let id = s.id("md-html-text");
            segments.push(
                InteractiveText::new(id, styled)
                    .on_click(ranges, move |i, _, cx| {
                        if let Some(href) = targets.get(i) {
                            let href = href.clone();
                            let _ = view.update(cx, |v, cx| v.follow_href(&href, cx));
                        }
                    })
                    .into_any_element(),
            );
        };
        for piece in pieces {
            match piece {
                Piece::Text(s, style) => {
                    let s = if text.is_empty() || text.ends_with(' ') || text.ends_with('\n') {
                        s.trim_start().to_owned()
                    } else {
                        s
                    };
                    if s.is_empty() {
                        continue;
                    }
                    let start = text.len();
                    text.push_str(&s);
                    let mut font = RenderCx::font(&style.text);
                    if style.mono {
                        font.family = SharedString::from(
                            crate::editor::view::style::inline_code_family(style.text.weight),
                        );
                    }
                    runs.push(TextRun {
                        len: s.len(),
                        font,
                        color: style.text.color.into(),
                        background_color: style.background.map(Into::into),
                        underline: (style.underline || style.link.is_some()).then(|| {
                            UnderlineStyle {
                                thickness: px(1.),
                                color: style.link.is_some().then(|| {
                                    Rgba {
                                        a: 0.,
                                        ..style.text.color
                                    }
                                    .into()
                                }),
                                wavy: false,
                            }
                        }),
                        strikethrough: style.strike.then(|| StrikethroughStyle {
                            thickness: px(1.),
                            color: None,
                        }),
                    });
                    if let Some(href) = style.link {
                        links.push((start..text.len(), href));
                    }
                }
                Piece::Break => {
                    text.push('\n');
                    runs.push(TextRun {
                        len: 1,
                        font: RenderCx::font(&base),
                        color: base.color.into(),
                        background_color: None,
                        underline: None,
                        strikethrough: None,
                    });
                }
                Piece::Atom(atom) => {
                    while text.ends_with(' ') {
                        text.pop();
                        if let Some(last) = runs.last_mut() {
                            last.len -= 1;
                            if last.len == 0 {
                                runs.pop();
                            }
                        }
                    }
                    if !text.is_empty() {
                        flush(self, &mut text, &mut runs, &mut links, &mut segments);
                    }
                    segments.push(atom);
                }
            }
        }
        while text.ends_with(' ') || text.ends_with('\n') {
            text.pop();
            if let Some(last) = runs.last_mut() {
                last.len -= 1;
                if last.len == 0 {
                    runs.pop();
                }
            }
        }
        if !text.is_empty() {
            flush(self, &mut text, &mut runs, &mut links, &mut segments);
        }
        let mut d = div().w_full();
        base.apply(d.style());
        d.style().text.text_align = Some(inherit.align);
        if has_atoms {
            d = d
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(base.size * 0.25));
            d = match inherit.align {
                TextAlign::Center => d.justify_center(),
                TextAlign::Right => d.justify_end(),
                TextAlign::Left => d,
            };
        }
        d.children(segments).into_any_element()
    }
}
