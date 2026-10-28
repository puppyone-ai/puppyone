//! Input method scenarios (GPUI test platform), driven through the
//! `NSTextInputClient` calls GPUI forwards: the sequences macOS input methods
//! send for Chinese, Japanese, Korean, dead keys and press-and-hold accents,
//! and every way a composition can end. Each runs on plain text and on the
//! Markdown live preview (the CSV cell and the host have their own tests).
use super::{
    EditorView, bind_keys,
    editor::EditorEvent,
    extension::{EditorExtension, PlainText},
    style::{self, LineHeight, LineStyle, TextStyle},
};
use crate::{
    editor::{
        markdown::MarkdownExtension,
        text::{selection::Selection, state::UserEvent},
    },
    typography::Scale,
};
use gpui::{
    ClipboardItem, Entity, EntityInputHandler, Modifiers, TestAppContext, VisualTestContext, px,
    rgba,
};
use std::{cell::RefCell, ops::Range, rc::Rc, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Format {
    Plain,
    Markdown,
}

fn extension(format: Format) -> Box<dyn EditorExtension> {
    match format {
        Format::Markdown => Box::new(MarkdownExtension::new(true, Scale::Medium)),
        Format::Plain => {
            let text = TextStyle {
                size: 15.,
                weight: 500.,
                italic: false,
                mono: false,
                color: rgba(0xfafafaff),
                tabular: false,
                line_height: LineHeight::Factor(1.75),
            };
            Box::new(PlainText {
                line: Rc::new(LineStyle::new(text)),
                decorations: Default::default(),
            })
        }
    }
}

/// An editor and the input method talking to it.
struct Ime<'a> {
    view: Entity<EditorView>,
    cx: &'a mut VisualTestContext,
    events: Rc<RefCell<Vec<EditorEvent>>>,
}

fn open<'a>(cx: &'a mut TestAppContext, format: Format, text: &str, caret: usize) -> Ime<'a> {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
            crate::ui::ime::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| EditorView::new(&text, extension(format), cx));
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(caret), cx);
    });
    let events: Rc<RefCell<Vec<EditorEvent>>> = Rc::default();
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, e: &EditorEvent, _| {
            sink.borrow_mut().push(e.clone())
        })
        .detach()
    });
    let mut ime = Ime { view, cx, events };
    ime.draw();
    ime
}

impl Ime<'_> {
    fn draw(&mut self) {
        self.cx.run_until_parked();
        self.cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
    /// `setMarkedText:selectedRange:replacementRange:` (UTF-16 ranges).
    fn mark_at(
        &mut self,
        replace: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
    ) {
        let text = text.to_owned();
        self.view.update_in(self.cx, |v, w, cx| {
            v.replace_and_mark_text_in_range(replace, &text, selected, w, cx)
        });
        self.draw();
    }
    /// Marked text with the caret at its end (pinyin, kana, jamo).
    fn mark(&mut self, text: &str) {
        let end = text.encode_utf16().count();
        self.mark_at(None, text, Some(end..end));
    }
    /// `insertText:replacementRange:`.
    fn insert_at(&mut self, replace: Option<Range<usize>>, text: &str) {
        let text = text.to_owned();
        self.view.update_in(self.cx, |v, w, cx| {
            v.replace_text_in_range(replace, &text, w, cx)
        });
        self.draw();
    }
    fn insert(&mut self, text: &str) {
        self.insert_at(None, text);
    }
    fn unmark(&mut self) {
        self.view
            .update_in(self.cx, |v, w, cx| v.unmark_text(w, cx));
        self.draw();
    }
    fn text(&mut self) -> String {
        self.view.update(self.cx, |v, _| v.text().to_owned())
    }
    /// `markedRange` (UTF-16).
    fn marked(&mut self) -> Option<Range<usize>> {
        self.view
            .update_in(self.cx, |v, w, cx| v.marked_text_range(w, cx))
    }
    /// `selectedRange` (UTF-16).
    fn selected(&mut self) -> Range<usize> {
        self.view
            .update_in(self.cx, |v, w, cx| v.selected_text_range(false, w, cx))
            .expect("editable")
            .range
    }
    fn undo(&mut self, redo: bool) -> String {
        self.view.update_in(self.cx, |v, _, cx| v.undo(redo, cx));
        self.text()
    }
    fn composing(&mut self) -> bool {
        self.view.update(self.cx, |v, _| v.composing())
    }
    fn discards(&mut self) -> usize {
        self.view.update(self.cx, |v, _| v.discard_requests)
    }
    fn changes(&self) -> usize {
        self.events
            .borrow()
            .iter()
            .filter(|e| matches!(e, EditorEvent::Changed(_)))
            .count()
    }
    fn take_events(&self) -> Vec<EditorEvent> {
        std::mem::take(&mut *self.events.borrow_mut())
    }
}

fn each_format(
    cx: &mut TestAppContext,
    text: &str,
    caret: usize,
    scenario: impl Fn(&mut Ime, Format),
) {
    for format in [Format::Plain, Format::Markdown] {
        let mut ime = open(cx, format, text, caret);
        scenario(&mut ime, format);
    }
}

// --- Chinese ------------------------------------------------------------------

#[gpui::test]
fn pinyin_commits_once_and_undoes_in_one_step(cx: &mut TestAppContext) {
    each_format(cx, "ab", 2, |ime, format| {
        for (i, preedit) in ["n", "ni", "nih", "niha", "nihao"].into_iter().enumerate() {
            ime.mark(preedit);
            assert_eq!(
                ime.text(),
                format!("ab{preedit}"),
                "{format:?}: the preedit replaces itself"
            );
            assert_eq!(
                ime.marked(),
                Some(2..2 + preedit.len()),
                "{format:?}: the whole preedit is marked"
            );
            assert_eq!(
                ime.selected(),
                2 + preedit.len()..2 + preedit.len(),
                "{format:?}: caret at the preedit end"
            );
            if i == 1 && format == Format::Plain {
                // A human pace (beyond the typing group delay) changes nothing.
                std::thread::sleep(Duration::from_millis(550));
            }
        }
        assert_eq!(
            ime.changes(),
            0,
            "{format:?}: provisional text is not a document change"
        );
        ime.insert("你好");
        assert_eq!(
            (ime.text().as_str(), ime.marked(), ime.composing()),
            ("ab你好", None, false),
            "{format:?}"
        );
        assert_eq!(
            ime.take_events(),
            vec![EditorEvent::Changed(UserEvent::Input)],
            "{format:?}: reported once"
        );
        assert_eq!(
            ime.undo(false),
            "ab",
            "{format:?}: one undo step, no pinyin"
        );
        assert_eq!(ime.selected(), 2..2);
        assert_eq!(ime.undo(true), "ab你好", "{format:?}");
    });
}

#[gpui::test]
fn consecutive_phrases_are_separate_steps_and_do_not_join_typing(cx: &mut TestAppContext) {
    each_format(cx, "", 0, |ime, format| {
        ime.mark("wo");
        ime.insert("我");
        ime.mark("hao");
        ime.insert("好");
        ime.insert("!");
        assert_eq!(ime.text(), "我好!");
        assert_eq!(ime.undo(false), "我好", "{format:?}");
        assert_eq!(ime.undo(false), "我", "{format:?}");
        assert_eq!(ime.undo(false), "", "{format:?}");
    });
}

#[gpui::test]
fn a_cancelled_composition_changes_nothing_but_reports_its_end(cx: &mut TestAppContext) {
    each_format(cx, "ab", 2, |ime, format| {
        ime.mark("ni");
        ime.mark_at(None, "", Some(0..0));
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("ab", false),
            "{format:?}"
        );
        assert_eq!(
            ime.take_events(),
            vec![EditorEvent::CompositionEnded],
            "{format:?}"
        );
        assert!(
            !ime.view.update(ime.cx, |v, _| v.can_undo()),
            "{format:?}: no history step"
        );
    });
}

#[gpui::test]
fn unmark_keeps_the_marked_text_as_typed(cx: &mut TestAppContext) {
    each_format(cx, "", 0, |ime, format| {
        ime.mark("ni");
        ime.unmark();
        assert_eq!(
            (ime.text().as_str(), ime.composing(), ime.changes()),
            ("ni", false, 1),
            "{format:?}"
        );
        // The input method ended it itself: nothing to discard.
        assert_eq!(ime.discards(), 0);
        assert_eq!(ime.undo(false), "", "{format:?}");
    });
}

// --- Japanese -----------------------------------------------------------------

#[gpui::test]
fn japanese_conversion_shows_the_clause_being_converted(cx: &mut TestAppContext) {
    each_format(cx, "x", 1, |ime, format| {
        ime.mark("にほんご");
        // Space converts; the input method selects the first clause.
        ime.mark_at(None, "日本語", Some(0..2));
        assert_eq!(ime.marked(), Some(1..4), "{format:?}");
        assert_eq!(
            ime.selected(),
            1..3,
            "{format:?}: the clause is the selection"
        );
        let clause = ime.view.update(ime.cx, |v, _| v.composition_clause());
        assert_eq!(clause, Some("x".len().."x日本".len()), "{format:?}");
        // Moving to the next clause.
        ime.mark_at(None, "日本語", Some(2..3));
        assert_eq!(ime.selected(), 3..4);
        ime.insert("日本語");
        assert_eq!(
            (ime.text().as_str(), ime.selected()),
            ("x日本語", 4..4),
            "{format:?}"
        );
        assert_eq!(ime.undo(false), "x", "{format:?}");
    });
}

#[gpui::test]
fn japanese_reconversion_replaces_committed_text(cx: &mut TestAppContext) {
    each_format(cx, "日本です", 0, |ime, format| {
        // The input method reads the selection and marks it for reconversion.
        let read = ime.view.update_in(ime.cx, |v, w, cx| {
            let mut actual = None;
            v.text_for_range(0..2, &mut actual, w, cx)
        });
        assert_eq!(read.as_deref(), Some("日本"));
        ime.mark_at(Some(0..2), "にほん", Some(3..3));
        assert_eq!(
            (ime.text().as_str(), ime.marked()),
            ("にほんです", Some(0..3)),
            "{format:?}"
        );
        ime.insert("二本");
        assert_eq!(ime.text(), "二本です", "{format:?}");
        assert_eq!(
            ime.undo(false),
            "日本です",
            "{format:?}: one step back to the original"
        );
    });
}

// --- Korean -------------------------------------------------------------------

#[gpui::test]
fn korean_syllables_commit_one_by_one(cx: &mut TestAppContext) {
    each_format(cx, "", 0, |ime, format| {
        for jamo in ["ㅎ", "하", "한"] {
            ime.mark(jamo);
        }
        // The next consonant starts a syllable: commit, then mark it.
        ime.insert("한");
        ime.mark("ㄱ");
        ime.mark("가");
        ime.mark("간");
        // A vowel moves the final consonant to a new syllable: the commit
        // differs from the marked text.
        ime.insert("가");
        ime.mark("나");
        assert_eq!(
            (ime.text().as_str(), ime.marked()),
            ("한가나", Some(2..3)),
            "{format:?}"
        );
        ime.insert("나");
        assert_eq!(ime.undo(false), "한가", "{format:?}");
        assert_eq!(ime.undo(false), "한", "{format:?}");
        assert_eq!(ime.undo(false), "", "{format:?}");
    });
}

// --- Latin input methods --------------------------------------------------------

#[gpui::test]
fn dead_keys_and_press_and_hold_accents(cx: &mut TestAppContext) {
    each_format(cx, "", 0, |ime, format| {
        // ⌥E then E.
        ime.mark("´");
        assert_eq!(ime.marked(), Some(0..1));
        ime.insert("é");
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("é", false),
            "{format:?}"
        );
        // Holding A, then picking an accent: the typed letter is replaced.
        ime.insert("a");
        ime.insert_at(Some(1..2), "à");
        assert_eq!(ime.text(), "éà", "{format:?}");
        assert_eq!(ime.selected(), 2..2);
    });
}

#[gpui::test]
fn utf16_ranges_around_emoji_and_cjk(cx: &mut TestAppContext) {
    each_format(cx, "😀中", "😀中".len(), |ime, format| {
        assert_eq!(ime.selected(), 3..3, "{format:?}: 😀 is two UTF-16 units");
        ime.mark_at(None, "a👍🏽", Some(5..5));
        assert_eq!(ime.marked(), Some(3..8), "{format:?}");
        let marked = ime.view.update_in(ime.cx, |v, w, cx| {
            let mut actual = None;
            v.text_for_range(3..8, &mut actual, w, cx)
        });
        assert_eq!(marked.as_deref(), Some("a👍🏽"));
        // A range ending inside a surrogate pair rounds to its character.
        ime.mark_at(None, "a👍🏽", Some(2..2));
        assert_eq!(ime.selected(), 6..6, "{format:?}");
        ime.insert("好");
        assert_eq!(ime.text(), "😀中好", "{format:?}");
    });
}

// --- Interruptions --------------------------------------------------------------

#[gpui::test]
fn a_selection_change_commits_and_discards_the_composition(cx: &mut TestAppContext) {
    each_format(cx, "hello world", 5, |ime, format| {
        ime.mark("ni");
        ime.view
            .update_in(ime.cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("helloni world", false),
            "{format:?}"
        );
        assert_eq!((ime.discards(), ime.changes()), (1, 1), "{format:?}");
        // The input method starts over at the new caret.
        ime.mark("a");
        assert_eq!(ime.marked(), Some(0..1), "{format:?}");
        ime.insert("啊");
        assert_eq!(ime.text(), "啊helloni world", "{format:?}");
    });
}

#[gpui::test]
fn a_click_commits_the_composition(cx: &mut TestAppContext) {
    each_format(cx, "hello world", 5, |ime, format| {
        ime.mark("ni");
        let start = ime.view.update(ime.cx, |v, _| {
            let c = v.layout().unwrap().caret(0, false);
            gpui::point(c.x + px(1.), c.top + c.height / 2.)
        });
        ime.cx.simulate_click(start, Modifiers::none());
        ime.draw();
        assert_eq!(
            (ime.text().as_str(), ime.composing(), ime.discards()),
            ("helloni world", false, 1),
            "{format:?}"
        );
        assert!(
            ime.selected().start <= 1,
            "{format:?}: the click placed the caret"
        );
    });
}

#[gpui::test]
fn focus_loss_commits_the_composition(cx: &mut TestAppContext) {
    each_format(cx, "", 0, |ime, format| {
        // GPUI reports focus changes of the active window.
        ime.cx.update(|w, _| w.activate_window());
        ime.draw();
        ime.mark("ka");
        ime.cx.update(|w, cx| w.blur(cx));
        ime.draw();
        assert_eq!(
            (ime.text().as_str(), ime.composing(), ime.discards()),
            ("ka", false, 1),
            "{format:?}"
        );
        // Switching away from the window commits too (as a browser blur).
        ime.view.update_in(ime.cx, |v, w, cx| v.focus(w, cx));
        ime.draw();
        ime.mark("sa");
        ime.cx.deactivate_window();
        ime.draw();
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("kasa", false),
            "{format:?}"
        );
    });
}

#[gpui::test]
fn read_only_commits_and_turns_text_input_off(cx: &mut TestAppContext) {
    each_format(cx, "", 0, |ime, format| {
        ime.mark("ni");
        ime.view
            .update_in(ime.cx, |v, _, cx| v.set_read_only(true, cx));
        assert_eq!(
            (ime.text().as_str(), ime.composing(), ime.discards()),
            ("ni", false, 1),
            "{format:?}"
        );
        let (accepts, offered, forced) = ime.view.update_in(ime.cx, |v, w, cx| {
            (
                v.accepts_text_input(w, cx),
                v.selected_text_range(false, w, cx),
                v.selected_text_range(true, w, cx),
            )
        });
        assert!(
            !accepts && offered.is_none() && forced.is_some(),
            "{format:?}"
        );
        ime.mark("x");
        ime.insert("y");
        assert_eq!(ime.text(), "ni", "{format:?}: no input while read-only");
    });
}

#[gpui::test]
fn replacing_the_document_abandons_the_composition(cx: &mut TestAppContext) {
    each_format(cx, "draft", 5, |ime, format| {
        ime.mark("ni");
        ime.view
            .update_in(ime.cx, |v, _, cx| v.replace_text("from disk", cx));
        assert_eq!(
            (ime.text().as_str(), ime.composing(), ime.discards()),
            ("from disk", false, 1),
            "{format:?}"
        );
        assert_eq!(
            ime.changes(),
            0,
            "{format:?}: nothing reported for the abandoned text"
        );
        assert!(!ime.view.update(ime.cx, |v, _| v.can_undo()), "{format:?}");
    });
}

#[gpui::test]
fn keys_handed_back_by_the_input_method_commit_first(cx: &mut TestAppContext) {
    each_format(cx, "ab", 2, |ime, format| {
        ime.mark("´");
        // The input method passes ← back (`doCommandBySelector:`).
        ime.cx.simulate_keystrokes("left");
        ime.draw();
        assert_eq!(
            (ime.text().as_str(), ime.composing(), ime.selected()),
            ("ab´", false, 2..2),
            "{format:?}"
        );
        // Undo is never handled during a composition.
        ime.mark("ni");
        ime.cx.simulate_keystrokes("cmd-z");
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("abni´", true),
            "{format:?}"
        );
        // Paste commits the marked text and inserts after it.
        ime.cx
            .write_to_clipboard(ClipboardItem::new_string("X".into()));
        ime.cx.simulate_keystrokes("cmd-v");
        ime.draw();
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("abniX´", false),
            "{format:?}"
        );
    });
}

#[gpui::test]
fn an_empty_insert_outside_a_composition_keeps_the_selection(cx: &mut TestAppContext) {
    each_format(cx, "abc", 0, |ime, format| {
        ime.view.update_in(ime.cx, |v, _, cx| {
            v.set_selection(Selection::range(0, 3), cx)
        });
        ime.insert("");
        ime.mark_at(None, "", Some(0..0));
        assert_eq!(
            (ime.text().as_str(), ime.changes()),
            ("abc", 0),
            "{format:?}"
        );
    });
}

// --- Candidate window ----------------------------------------------------------

#[gpui::test]
fn the_candidate_window_anchors_on_the_marked_text(cx: &mut TestAppContext) {
    each_format(cx, "first line\nsecond", 17, |ime, format| {
        ime.mark("nihao");
        let (bounds, caret, element) = ime.view.update_in(ime.cx, |v, w, cx| {
            let marked = v.marked_text_range(w, cx).unwrap();
            let element = v.bounds.unwrap();
            let caret = v.layout().unwrap().caret(17, false);
            (
                v.bounds_for_range(marked, element, w, cx).unwrap(),
                caret,
                element,
            )
        });
        assert_eq!(
            bounds.origin.x, caret.x,
            "{format:?}: starts at the marked text"
        );
        assert_eq!(bounds.origin.y, caret.row_top, "{format:?}: on its row");
        assert!(
            bounds.size.width > px(10.),
            "{format:?}: spans the marked text once laid out"
        );
        assert!(element.contains(&bounds.origin), "{format:?}");
    });
}

// --- Markdown -----------------------------------------------------------------

#[gpui::test]
fn markdown_keeps_its_rules_around_a_composition(cx: &mut TestAppContext) {
    let mut ime = open(
        cx,
        Format::Markdown,
        "# Title\n- item",
        "# Title\n- item".len(),
    );
    ime.mark("ni");
    // The caret stays in the marked text; markers stay hidden.
    assert_eq!(ime.selected(), 16..16);
    let hidden = ime
        .view
        .update(ime.cx, |v, _| v.decorations().hidden.clone());
    assert!(
        hidden.contains(&(0..2)) && hidden.contains(&(8..10)),
        "{hidden:?}"
    );
    ime.insert("你");
    // After the commit, Markdown's Enter continues the list as usual.
    ime.cx.simulate_keystrokes("enter");
    assert_eq!(ime.text(), "# Title\n- item你\n- ");
}

// --- Function keys as text (Sogou Pinyin and similar) ---------------------------

#[gpui::test]
fn function_key_text_from_an_input_method_moves_instead_of_inserting(cx: &mut TestAppContext) {
    each_format(cx, "ab\ncd", 5, |ime, format| {
        // The input method swallows ↑ and inserts NSUpArrowFunctionKey.
        ime.insert("\u{F700}");
        assert_eq!(ime.text(), "ab\ncd", "{format:?}: never document text");
        assert!(
            ime.selected().start <= 2,
            "{format:?}: the caret went up, at {:?}",
            ime.selected()
        );
        ime.insert("\u{F703}");
        let at = ime.selected().start;
        // Shift held: the replayed key extends the selection.
        ime.cx.simulate_modifiers_change(Modifiers::shift());
        ime.insert("\u{F703}");
        ime.cx.simulate_modifiers_change(Modifiers::none());
        assert_eq!(ime.selected(), at..at + 1, "{format:?}");
        // As marked text it is ignored too.
        ime.mark("\u{F701}");
        assert_eq!(
            (ime.text().as_str(), ime.composing()),
            ("ab\ncd", false),
            "{format:?}"
        );
        assert_eq!(ime.changes(), 0, "{format:?}");
    });
}

#[gpui::test]
fn a_function_key_the_platform_delivers_is_not_replayed(cx: &mut TestAppContext) {
    each_format(cx, "abcd", 4, |ime, format| {
        // The input method inserted the character but also handed the key
        // back: GPUI dispatches it, the replay must not move a second time.
        ime.view.update_in(ime.cx, |v, w, cx| {
            v.replace_text_in_range(None, "\u{F702}", w, cx)
        });
        ime.cx.simulate_keystrokes("left");
        ime.draw();
        assert_eq!(
            (ime.text().as_str(), ime.selected()),
            ("abcd", 3..3),
            "{format:?}"
        );
    });
}
