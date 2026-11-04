//! Inline decorations (inlineDecorations.ts `addInlineMarkdownDecorations`):
//! the plans of one line become hidden delimiters (or revealed source) and
//! class spans, by decoration priority.
use super::builder::{Builder, ClassSpan};
use crate::editor::markdown::core::{
    classes::{Class, SourceSyntax},
    links,
    plans::{Atom, Plan, Presentation},
    syntax::{Element, Kind},
};
use gpui::SharedString;
use std::ops::Range;

impl Builder<'_> {
    /// `addInlineMarkdownDecorations` for the plans intersecting one line.
    pub fn inline(&mut self, line: usize, plans: &[&Plan], occupied: Vec<Range<usize>>) {
        let cx = self.cx;
        let range = cx.doc.line_range(line);
        let text = cx.doc.line(line);
        let mut entries: Vec<(&Plan, &Element)> = plans
            .iter()
            .filter_map(|p| Some((*p, &cx.syntax.elements[p.element?])))
            .filter(|(_, e)| {
                e.kind.inline() && e.range.start <= range.end && e.range.end >= range.start
            })
            .collect();
        entries.sort_by(|a, b| {
            a.1.kind
                .priority()
                .cmp(&b.1.kind.priority())
                .then(a.1.range.start.cmp(&b.1.range.start))
                .then(b.1.range.end.cmp(&a.1.range.end))
        });
        let link_tokens = links::find_links(text);
        let wiki_tokens = links::find_wiki_links(text);
        for (plan, e) in entries {
            if occupied
                .iter()
                .any(|o| e.range.start < o.end && e.range.end > o.start)
            {
                continue;
            }
            let reveal = cx.preview.reveal.as_ref() == Some(&e.range);
            match e.kind {
                Kind::WikiLink => {
                    let token = wiki_tokens.iter().find(|t| {
                        range.start + t.range.start == e.range.start
                            && range.start + t.range.end == e.range.end
                    });
                    let (Some(token), Some(content)) =
                        (token, e.content.clone().filter(|c| c.start < c.end))
                    else {
                        continue;
                    };
                    self.hide(e.range.start..content.start, SourceSyntax::WikiLink, reveal);
                    self.hide(content.end..e.range.end, SourceSyntax::WikiLink, reveal);
                    let href = Some(SharedString::from(token.target.clone()));
                    self.spans.push(ClassSpan {
                        range: content,
                        classes: Class::SYNTAX_LINK | Class::WIKI_LINK_LABEL,
                        href,
                    });
                }
                Kind::Link => {
                    let Some(content) = e.content.clone().filter(|c| c.start < c.end) else {
                        continue;
                    };
                    let token = link_tokens.iter().find(|t| {
                        range.start + t.range.start == e.range.start
                            && range.start + t.range.end == e.range.end
                    });
                    let href = e
                        .href
                        .clone()
                        .or_else(|| token.map(|t| t.href.clone()))
                        .or_else(|| {
                            (cx.doc.as_str().as_bytes()[e.range.start] == b'<')
                                .then(|| cx.doc.slice(content.clone()).trim().to_owned())
                                .filter(|h| !h.is_empty())
                        });
                    let Some(href) = href else { continue };
                    let mut classes = Class::SYNTAX_LINK | Class::LINK_LABEL;
                    if is_external(&href) {
                        classes |= Class::IS_EXTERNAL;
                    }
                    let href = SharedString::from(href);
                    for marker in [e.range.start..content.start, content.end..e.range.end] {
                        if reveal {
                            self.spans.push(ClassSpan {
                                range: marker.clone(),
                                classes: SourceSyntax::Link.revealed(),
                                href: Some(href.clone()),
                            });
                        }
                        self.hide(marker, SourceSyntax::Link, reveal);
                    }
                    self.spans.push(ClassSpan {
                        range: content,
                        classes,
                        href: Some(href),
                    });
                }
                Kind::Strong | Kind::Emphasis | Kind::InlineCode | Kind::Strike => {
                    let Presentation::InlineMark { content, markers } = &plan.presentation else {
                        continue;
                    };
                    for m in markers {
                        self.hide(m.clone(), SourceSyntax::Delimiter, reveal);
                    }
                    let class = match e.kind {
                        Kind::Strong => Class::SYNTAX_STRONG,
                        Kind::Emphasis => Class::SYNTAX_EMPHASIS,
                        Kind::InlineCode => Class::SYNTAX_MONOSPACE,
                        _ => Class::SYNTAX_STRIKE,
                    };
                    self.spans.push(ClassSpan {
                        range: content.clone(),
                        classes: class,
                        href: None,
                    });
                }
                Kind::Escape => {
                    for m in &e.markers {
                        self.hide(m.clone(), SourceSyntax::Escape, false);
                    }
                }
                Kind::Highlight | Kind::LinkDefinition | Kind::Comment => {
                    let Presentation::InlineMark { content, markers } = &plan.presentation else {
                        continue;
                    };
                    for m in markers {
                        self.hide(m.clone(), SourceSyntax::Delimiter, reveal);
                    }
                    self.spans.push(ClassSpan {
                        range: content.clone(),
                        classes: match e.kind {
                            Kind::Highlight => Class::SYNTAX_HIGHLIGHT,
                            Kind::LinkDefinition => Class::LINK_DEFINITION,
                            _ => Class::COMMENT,
                        },
                        href: None,
                    });
                }
                Kind::InlineHtml => self.inline_html(plan, e, reveal),
                Kind::Emoji
                | Kind::Entity
                | Kind::MathInline
                | Kind::FootnoteReference
                | Kind::FootnoteDefinition => {
                    if let Presentation::InlineAtom(Atom::Text(text)) = &plan.presentation
                        && !reveal
                    {
                        // `.cm-md-footnote-definition`: margin-right 0.5em
                        // (an en space).
                        let shown = if e.kind == Kind::FootnoteDefinition {
                            format!("{text}\u{2002}")
                        } else {
                            text.clone()
                        };
                        let shown = SharedString::from(shown);
                        self.replaced.push((e.range.clone(), shown.clone()));
                        // `.cm-md-footnote-reference`: a `<sup>` at the meta
                        // size in the link colour.
                        if e.kind == Kind::FootnoteReference {
                            self.superscripts
                                .push(crate::editor::view::decoration::Superscript {
                                    range: e.range.clone(),
                                    text: shown,
                                    size: Some(crate::theme::ty().ui.meta),
                                    color: Some(self.cx.theme.inline.link_color),
                                    lower: false,
                                });
                        }
                        let classes = match e.kind {
                            Kind::MathInline => Some(Class::MATH),
                            Kind::FootnoteReference => Some(Class::FOOTNOTE_REFERENCE),
                            Kind::FootnoteDefinition => Some(Class::FOOTNOTE),
                            _ => None,
                        };
                        if let Some(classes) = classes {
                            self.spans.push(ClassSpan {
                                range: e.range.clone(),
                                classes,
                                href: None,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

impl Builder<'_> {
    /// `applyInlineHtmlPlan`: the tags hide like delimiters (a `q`'s show as
    /// its quotation marks) and the content takes the element's default
    /// presentation: weight, slant, rules, monospace, `mark`'s system
    /// colours, a shifted size, and the colours of its `style`.
    fn inline_html(&mut self, plan: &Plan, e: &Element, reveal: bool) {
        let (Presentation::InlineMark { content, markers }, Some(tag)) =
            (&plan.presentation, e.html.as_deref())
        else {
            return;
        };
        if tag.name == "q" && !reveal {
            for (marker, quote) in markers.iter().zip(["\u{201c}", "\u{201d}"]) {
                self.replaced
                    .push((marker.clone(), SharedString::from(quote)));
            }
        } else {
            for m in markers {
                self.hide(m.clone(), SourceSyntax::Delimiter, reveal);
            }
        }
        let classes = match tag.name.as_str() {
            "b" | "strong" => Class::SYNTAX_STRONG,
            "i" | "em" | "cite" | "var" | "dfn" => Class::SYNTAX_EMPHASIS,
            "s" | "del" | "strike" => Class::SYNTAX_STRIKE,
            "u" | "ins" => Class::HTML_UNDERLINE,
            "code" | "kbd" | "samp" | "tt" => Class::SYNTAX_MONOSPACE,
            "mark" => Class::HTML_MARK,
            // `.cm-md-inline-html[data-md-href]`: the text's own colour, a
            // transparent underline; it still follows its link.
            "sup" | "sub" if !reveal => {
                self.superscripts
                    .push(crate::editor::view::decoration::Superscript {
                        range: content.clone(),
                        text: SharedString::from(self.cx.doc.slice(content.clone()).to_owned()),
                        size: None,
                        color: None,
                        lower: tag.name == "sub",
                    });
                Class::HTML_SHIFTED
            }
            _ => Class::NONE,
        };
        if classes != Class::NONE {
            self.spans.push(ClassSpan {
                range: content.clone(),
                classes,
                href: None,
            });
        }
        let css = |value: &Option<String>| {
            value
                .as_deref()
                .and_then(crate::editor::tokens::parse_css_color)
                .map(crate::editor::view::decoration::packed)
        };
        let (color, background) = (css(&tag.color), css(&tag.background));
        if color.is_some() || background.is_some() {
            self.colors.push((content.clone(), color, background));
        }
    }
}

fn is_external(href: &str) -> bool {
    // `/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i` (and a safe scheme).
    let lower = href.trim().to_ascii_lowercase();
    lower.starts_with("//")
        || lower.split_once(':').is_some_and(|(scheme, _)| {
            scheme
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic())
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
        })
}
