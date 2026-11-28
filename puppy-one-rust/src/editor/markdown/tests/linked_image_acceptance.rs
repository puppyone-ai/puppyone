//! Nested labels, real image projection and native link activation.
use crate::editor::{
    markdown::{MarkdownExtension, SetAssets, core::links::find_links},
    registry::DocumentAssets,
    text::state::EditorState,
    view::{
        EditorView,
        decoration::Block,
        extension::{EditorExtension, LinkAction, config_transaction},
    },
};
use crate::typography::Scale;
use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};
use std::{
    io::Cursor,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const LINK: &str = "https://example.com/page";

#[test]
fn link_labels_pair_nested_images_recover_stray_openers_and_respect_line_escapes() {
    for (source, start, label) in [
        (format!("[![badge](a.png)]({LINK})"), 0, "![badge](a.png)"),
        (format!("[a[b]({LINK})"), 2, "b"),
        (format!("[a\\]b]({LINK})"), 0, "a\\]b"),
        (
            format!("[中文 ![图](a.png)]({LINK})"),
            0,
            "中文 ![图](a.png)",
        ),
    ] {
        let tokens = find_links(&source);
        assert_eq!(tokens.len(), 1, "{source}");
        assert_eq!(tokens[0].range, start..source.len(), "{source}");
        assert_eq!(&source[tokens[0].label.clone()], label);
        assert_eq!(tokens[0].href, LINK);
    }
    assert!(find_links(&format!("[a\nb]({LINK})")).is_empty());
}

#[test]
fn malformed_link_labels_remain_bounded_for_two_hundred_thousand_openers() {
    let source = "[".repeat(200_000);
    let start = Instant::now();
    assert!(find_links(&source).is_empty());
    assert!(start.elapsed() < Duration::from_secs(1));
}

// Observe dispatch while delegating all document rendering and link policy to
// the actual Markdown extension. This observer never resolves an href itself.
struct LinkObserver {
    markdown: MarkdownExtension,
    opened: Arc<Mutex<Vec<String>>>,
}
impl EditorExtension for LinkObserver {
    fn supports_layered_decorations(&self) -> bool {
        true
    }
    fn document_decoration_key(&self) -> u64 {
        self.markdown.document_decoration_key()
    }
    fn reveal_decoration_key(&self) -> u64 {
        self.markdown.reveal_decoration_key()
    }
    fn decorate_document(
        &self,
        state: &EditorState,
        dark: bool,
    ) -> std::rc::Rc<crate::editor::view::decoration::Decorations> {
        self.markdown.decorate_document(state, dark)
    }
    fn decorate_reveal(
        &self,
        input: &crate::editor::view::extension::DecorateInput,
        document: &crate::editor::view::decoration::Decorations,
    ) -> std::rc::Rc<crate::editor::view::decoration::RevealLayer> {
        self.markdown.decorate_reveal(input, document)
    }
    fn apply_effects(
        &mut self,
        effects: &[crate::editor::text::state::StateEffect],
        state: &EditorState,
        read_only: bool,
    ) -> bool {
        self.markdown.apply_effects(effects, state, read_only)
    }
    fn selection_changed(&mut self, state: &EditorState, focused: bool, pointer_selecting: bool) {
        self.markdown
            .selection_changed(state, focused, pointer_selecting)
    }
    fn link_target(&mut self, state: &EditorState, href: &str) -> Option<LinkAction> {
        self.opened.lock().unwrap().push(href.to_owned());
        self.markdown.link_target(state, href)
    }
    fn link_at(
        &mut self,
        state: &EditorState,
        offset: usize,
        release: bool,
    ) -> Option<crate::editor::view::extension::LinkActivation> {
        self.markdown.link_at(state, offset, release)
    }
}

fn mount<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
    scope: &str,
    opened: Arc<Mutex<Vec<String>>>,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
    });
    let source = source.to_owned();
    let (view, visual) = cx.add_window_view(move |_, cx| {
        EditorView::new(
            &source,
            Box::new(LinkObserver {
                markdown: MarkdownExtension::new(true, Scale::Medium),
                opened,
            }),
            cx,
        )
    });
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(24, 12)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let png = png.into_inner();
    view.update(visual, |v, cx| {
        v.set_read_only(true, cx);
        v.dispatch(
            config_transaction(SetAssets(Some(DocumentAssets {
                workspace: scope.into(),
                document: "note.md".into(),
                read: Arc::new(move |path| {
                    assert_eq!(path, std::path::Path::new("a.png"));
                    Some(png.clone())
                }),
            }))),
            cx,
        );
    });
    draw(visual);
    (view, visual)
}
fn draw(cx: &mut VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

#[gpui::test]
fn linked_badges_hide_syntax_keep_independent_targets_and_open_once_in_read_only(
    cx: &mut TestAppContext,
) {
    for count in [1, 2] {
        let source = (0..count)
            .map(|i| format!("[![badge](a.png)]({LINK}{i})"))
            .collect::<Vec<_>>()
            .join(" ");
        let opened = Arc::new(Mutex::new(Vec::new()));
        let (view, visual) = mount(
            cx,
            &source,
            &format!("linked-badges-{count}"),
            opened.clone(),
        );
        view.read_with(visual, |v, _| {
            assert_eq!(
                v.decorations()
                    .blocks
                    .iter()
                    .filter(|b| matches!(b,Block::Line {style,..} if style.embed.is_some()))
                    .count(),
                1
            );
            assert!(
                v.layout()
                    .unwrap()
                    .leaves
                    .iter()
                    .all(|l| l.entry.text.text.trim().is_empty())
            );
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
        for (i, selector) in ["md-image-0", "md-image-1"].iter().take(count).enumerate() {
            let bounds = visual.debug_bounds(selector).expect("painted badge");
            assert_eq!(
                (f32::from(bounds.size.width), f32::from(bounds.size.height)),
                (24., 12.)
            );
            visual.simulate_click(bounds.center(), Modifiers::none());
            draw(visual);
            assert_eq!(visual.opened_url(), Some(format!("{LINK}{i}")));
            assert_eq!(
                *opened.lock().unwrap(),
                (0..=i).map(|n| format!("{LINK}{n}")).collect::<Vec<_>>()
            );
        }
        view.read_with(visual, |v, _| {
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[gpui::test]
fn linked_image_labels_keep_mixed_text_and_do_not_capture_adjacent_images(cx: &mut TestAppContext) {
    for (index, source, expected, linked) in [
        (
            0,
            format!("[see ![badge](a.png) here]({LINK})"),
            "seehere",
            true,
        ),
        (1, format!("![badge](a.png) [text]({LINK})"), "text", false),
    ] {
        let (view, visual) = mount(cx, &source, &format!("mixed-image-{index}"), Arc::default());
        let painted = visual
            .debug_bounds("editor-inline-image")
            .expect("image painted inside text");
        assert_eq!(f32::from(painted.size.width), 24.);
        view.read_with(visual, |v, _| {
            let widgets = &v.decorations().inline_widgets;
            let images: Vec<_> = widgets.iter().filter(|w| w.as_image().is_some()).collect();
            assert_eq!(images.len(), 1);
            let range = &images[0].range;
            assert_eq!(
                v.decorations()
                    .marks
                    .iter()
                    .any(|m| m.style.link.as_deref() == Some(LINK)
                        && m.range.start <= range.start
                        && m.range.end >= range.end),
                linked
            );
            let visible: String = v
                .layout()
                .unwrap()
                .leaves
                .iter()
                .flat_map(|l| l.entry.text.text.chars())
                .filter(|c| !c.is_whitespace())
                .collect();
            assert_eq!(visible, expected);
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[gpui::test]
fn image_sizes_change_painted_dimensions_without_corrupting_alt_text(cx: &mut TestAppContext) {
    for (index, syntax, alt, width, height) in [
        (0, "![alt|100](a.png)", "alt", 100., 50.),
        (1, "![alt|100x50](a.png)", "alt", 100., 50.),
        (2, "![[a.png|100]]", "a.png", 100., 50.),
        (3, "![a|b](a.png)", "a|b", 24., 12.),
    ] {
        let source = format!("before {syntax} after");
        let (view, visual) = mount(cx, &source, &format!("image-sizes-{index}"), Arc::default());
        let bounds = visual
            .debug_bounds("editor-inline-image")
            .expect("sized image painted");
        assert_eq!(
            (f32::from(bounds.size.width), f32::from(bounds.size.height)),
            (width, height)
        );
        view.read_with(visual, |v, _| {
            let decorations = v.decorations();
            let images: Vec<_> = decorations
                .inline_widgets
                .iter()
                .filter_map(|w| w.as_image())
                .collect();
            assert_eq!(images.len(), 1);
            assert_eq!(images[0].0.as_ref(), alt);
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}
