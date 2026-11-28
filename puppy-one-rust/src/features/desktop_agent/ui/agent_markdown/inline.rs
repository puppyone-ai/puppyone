//! Inline content flattened into one `RichText` run: emphasis, code chips
//! and links, with their ranges.
use super::*;

#[derive(Clone, Copy)]
pub(super) struct Palette {
    pub(super) text: Rgba,
    pub(super) strong: Rgba,
}

/// Flattened inline text: content, styled runs, code-chip ranges and links.
pub(super) type Flattened = (
    String,
    Vec<TextRun>,
    Vec<Range<usize>>,
    Vec<(Range<usize>, SharedString)>,
);

/// Flattens inlines into text, runs, chip and link ranges (`white-space` per block).
pub(super) fn flatten(
    inlines: &[Inline],
    preserve: bool,
    palette: Palette,
    out: &mut Flattened,
    style: (FontWeight, bool, bool, Option<SharedString>),
) {
    let (weight, italic, strike, link) = style.clone();
    // The message language's script faces (`lang`) behind the face.
    let font = |family: &str, weight: FontWeight| Font {
        family: family.to_owned().into(),
        weight,
        style: if italic {
            FontStyle::Italic
        } else {
            FontStyle::Normal
        },
        fallbacks: Some(crate::ui::fonts::fallbacks(
            if family == crate::theme::mono() {
                crate::typography::fonts::Category::Monospace
            } else {
                crate::typography::fonts::Category::Sans
            },
        )),
        ..Font::default()
    };
    let push = |out: &mut Flattened, text: &str, f: Font, color: Rgba| {
        if text.is_empty() {
            return;
        }
        let start = out.0.len();
        out.0.push_str(text);
        out.1.push(TextRun {
            len: text.len(),
            font: f,
            color: color.into(),
            background_color: None,
            underline: link.as_ref().map(|_| UnderlineStyle {
                thickness: px(1.),
                color: Some(color.into()),
                wavy: false,
            }),
            strikethrough: strike.then(|| StrikethroughStyle {
                thickness: px(1.),
                color: Some(color.into()),
            }),
        });
        if let Some(url) = &link {
            out.3.push((start..out.0.len(), url.clone()));
        }
    };
    let color = if weight.0 >= 600. {
        palette.strong
    } else {
        palette.text
    };
    for inline in inlines {
        match inline {
            Inline::Text(t) => {
                let text = if preserve {
                    t.clone()
                } else {
                    t.split_whitespace().collect::<Vec<_>>().join(" ")
                        + if t.ends_with(char::is_whitespace) && !t.trim().is_empty() {
                            " "
                        } else {
                            ""
                        }
                };
                let text =
                    if !preserve && t.starts_with(char::is_whitespace) && !t.trim().is_empty() {
                        format!(" {text}")
                    } else {
                        text
                    };
                push(out, &text, font(crate::theme::sans(), weight), color)
            }
            Inline::Code(code) => {
                let start = out.0.len();
                let pad = CODE_PAD.to_string();
                push(out, &pad, font(crate::theme::sans(), weight), palette.text);
                push(
                    out,
                    code,
                    font(crate::theme::mono(), FontWeight::NORMAL),
                    palette.text,
                );
                push(out, &pad, font(crate::theme::sans(), weight), palette.text);
                out.2.push(start..out.0.len());
            }
            Inline::Image(alt) => push(out, alt, font(crate::theme::sans(), weight), color),
            // `<sup>`: the footnote's number, raised.
            Inline::FootnoteRef(number) => {
                let raised: String = number
                    .chars()
                    .map(|c| match c.to_digit(10) {
                        Some(d) => ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'][d as usize],
                        None => c,
                    })
                    .collect();
                push(out, &raised, font(crate::theme::sans(), weight), color)
            }
            Inline::SoftBreak => push(
                out,
                if preserve { "\n" } else { " " },
                font(crate::theme::sans(), weight),
                color,
            ),
            Inline::HardBreak => push(out, "\n", font(crate::theme::sans(), weight), color),
            Inline::Strong(children) => flatten(
                children,
                preserve,
                palette,
                out,
                (FontWeight::SEMIBOLD, italic, strike, link.clone()),
            ),
            Inline::Emphasis(children) => flatten(
                children,
                preserve,
                palette,
                out,
                (weight, true, strike, link.clone()),
            ),
            Inline::Strike(children) => flatten(
                children,
                preserve,
                palette,
                out,
                (weight, italic, true, link.clone()),
            ),
            Inline::Link(url, children) => flatten(
                children,
                preserve,
                palette,
                out,
                (weight, italic, strike, safe_href(url).or(link.clone())),
            ),
        }
    }
}
