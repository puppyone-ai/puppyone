//! Viewport selection and xterm mouse encoding, independent of GPUI event delivery.
//! Protocol reference: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking
use vt100::{MouseProtocolEncoding as Encoding, MouseProtocolMode as Mode, Screen};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct CellPoint {
    pub row: u16,
    pub col: u16,
}
/// A cell's place in the whole output: its row counted from the first row
/// the main screen ever showed (`Screen::scrolled_rows`), so it stays put
/// while output scrolls and while the view scrolls back (xterm's buffer
/// coordinates).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct Place {
    pub line: i64,
    pub col: u16,
}
impl Place {
    pub fn of(screen: &Screen, point: CellPoint) -> Self {
        Self {
            line: top_line(screen) + i64::from(point.row),
            col: point.col,
        }
    }
}
/// The place of the view's first row.
fn top_line(screen: &Screen) -> i64 {
    screen.scrolled_rows() as i64 - screen.scrollback() as i64
}
/// Where `line` shows in the view, if it does.
fn visible_row(screen: &Screen, line: i64) -> Option<u16> {
    let row = line - top_line(screen);
    (0..i64::from(screen.size().0))
        .contains(&row)
        .then_some(row as u16)
}

/// A selection between two places; it keeps them while the view or the
/// output scrolls, and may run through the scrollback.
#[derive(Clone, Copy, Debug)]
pub struct Selection {
    pub anchor: Place,
    pub head: Place,
}
impl Selection {
    /// From `anchor` to `head` as the view shows them now.
    pub fn at(screen: &Screen, anchor: CellPoint, head: CellPoint) -> Self {
        Self {
            anchor: Place::of(screen, anchor),
            head: Place::of(screen, head),
        }
    }
    /// The ordered ends, widened over a wide character the view shows at
    /// either end.
    pub fn range(self, screen: &Screen) -> (Place, Place) {
        let (mut start, mut end) = if self.anchor <= self.head {
            (self.anchor, self.head)
        } else {
            (self.head, self.anchor)
        };
        if start != end {
            let continuation = |p: Place| {
                visible_row(screen, p.line).is_some_and(|row| {
                    screen
                        .cell(row, p.col)
                        .is_some_and(|c| c.is_wide_continuation())
                })
            };
            if continuation(start) {
                start.col = start.col.saturating_sub(1);
            }
            if continuation(end) {
                end.col += 1;
            }
        }
        (start, end)
    }
    pub fn contains(self, screen: &Screen, row: u16, col: u16) -> bool {
        let (start, end) = self.range(screen);
        let p = Place::of(screen, CellPoint { row, col });
        start <= p && p < end
    }
    /// The selected text, the scrollback's part included (what is left of
    /// it). The view's scroll position is kept.
    pub fn text(self, parser: &mut vt100::Parser) -> String {
        let (start, end) = self.range(parser.screen());
        let at = parser.screen().scrollback();
        let scrolled = parser.screen().scrolled_rows() as i64;
        let cols = parser.screen().size().1;
        let mut text = String::new();
        for line in start.line..=end.line {
            // The scrollback offset that shows `line` first (the live
            // screen's lines show at offset 0).
            parser.set_scrollback((scrolled - line).max(0) as usize);
            let screen = parser.screen();
            let Some(row) = visible_row(screen, line) else {
                // Dropped from the scrollback.
                continue;
            };
            let from = if line == start.line { start.col } else { 0 };
            let to = if line == end.line { end.col } else { cols };
            if from < to {
                text.push_str(
                    &screen
                        .rows(from, to - from)
                        .nth(usize::from(row))
                        .unwrap_or_default(),
                );
            }
            if line < end.line && !screen.row_wrapped(row) {
                text.push('\n');
            }
        }
        parser.set_scrollback(at);
        text
    }
    pub fn word(screen: &Screen, mut point: CellPoint) -> Self {
        let (_, cols) = screen.size();
        point.col = point.col.min(cols - 1);
        if screen
            .cell(point.row, point.col)
            .is_some_and(|c| c.is_wide_continuation())
        {
            point.col = point.col.saturating_sub(1);
        }
        let whitespace = |col| {
            screen.cell(point.row, col).is_none_or(|c| {
                !c.is_wide_continuation() && c.contents().chars().all(char::is_whitespace)
            })
        };
        let class = whitespace(point.col);
        let mut start = point.col;
        let mut end = point.col + 1;
        while start > 0 && whitespace(start - 1) == class {
            start -= 1;
        }
        while end < cols && whitespace(end) == class {
            end += 1;
        }
        Self::at(
            screen,
            CellPoint {
                row: point.row,
                col: start,
            },
            CellPoint {
                row: point.row,
                col: end,
            },
        )
    }
    /// Whether any of it is still in the output (`history` rows of
    /// scrollback are kept).
    pub fn alive(self, screen: &Screen, history: usize) -> bool {
        let (_, end) = self.range(screen);
        end.line >= screen.scrolled_rows() as i64 - history as i64
    }
}

#[derive(Clone, Copy, Debug)]
pub enum MouseAction {
    Press(u8),
    Release(u8),
    Move(Option<u8>),
    Wheel(bool), // true = up
}
#[derive(Clone, Copy, Default)]
pub struct MouseModifiers {
    pub shift: bool,
    pub alt: bool,
    pub control: bool,
}
pub fn key_bytes(key: &str, m: MouseModifiers, application_cursor: bool) -> Option<Vec<u8>> {
    let modifier = 1 + u8::from(m.shift) + 2 * u8::from(m.alt) + 4 * u8::from(m.control);
    let cursor = match key {
        "up" => Some('A'),
        "down" => Some('B'),
        "right" => Some('C'),
        "left" => Some('D'),
        "home" => Some('H'),
        "end" => Some('F'),
        _ => None,
    };
    if let Some(suffix) = cursor {
        return Some(
            if modifier > 1 {
                format!("\x1b[1;{modifier}{suffix}")
            } else if application_cursor {
                format!("\x1bO{suffix}")
            } else {
                format!("\x1b[{suffix}")
            }
            .into_bytes(),
        );
    }
    if let Some(suffix) = match key {
        "f1" => Some('P'),
        "f2" => Some('Q'),
        "f3" => Some('R'),
        "f4" => Some('S'),
        _ => None,
    } {
        return Some(
            if modifier > 1 {
                format!("\x1b[1;{modifier}{suffix}")
            } else {
                format!("\x1bO{suffix}")
            }
            .into_bytes(),
        );
    }
    let number = match key {
        "insert" => Some(2),
        "delete" => Some(3),
        "pageup" => Some(5),
        "pagedown" => Some(6),
        "f5" => Some(15),
        "f6" => Some(17),
        "f7" => Some(18),
        "f8" => Some(19),
        "f9" => Some(20),
        "f10" => Some(21),
        "f11" => Some(23),
        "f12" => Some(24),
        _ => None,
    };
    if let Some(number) = number {
        return Some(
            if modifier > 1 {
                format!("\x1b[{number};{modifier}~")
            } else {
                format!("\x1b[{number}~")
            }
            .into_bytes(),
        );
    }
    let mut bytes = match key {
        "enter" => vec![13],
        "backspace" => vec![127],
        "escape" => vec![27],
        "tab" => {
            if m.shift {
                b"\x1b[Z".to_vec()
            } else {
                vec![9]
            }
        }
        _ if m.control => vec![match key {
            "space" | "2" | "@" | "`" => 0,
            "[" | "3" => 27,
            "\\" | "4" => 28,
            "]" | "5" => 29,
            "^" | "6" => 30,
            "_" | "/" | "-" | "7" => 31,
            "?" | "8" => 127,
            key if key.len() == 1 && key.as_bytes()[0].is_ascii_alphabetic() => {
                key.as_bytes()[0].to_ascii_uppercase() - b'A' + 1
            }
            _ => return None,
        }],
        "space" if m.alt => vec![b' '],
        _ if m.alt && key.chars().count() == 1 => key.as_bytes().to_vec(),
        _ => return None, // Text and IME commits stay with GPUI's input handler.
    };
    if m.alt {
        bytes.insert(0, 27);
    }
    Some(bytes)
}
pub fn mouse_report(
    screen: &Screen,
    action: MouseAction,
    point: CellPoint,
    modifiers: MouseModifiers,
) -> Option<Vec<u8>> {
    let mode = screen.mouse_protocol_mode();
    if mode == Mode::None {
        return None;
    }
    let (mut code, release) = match action {
        MouseAction::Press(button) if button < 3 => (button, false),
        MouseAction::Release(button) if button < 3 && mode != Mode::Press => (button, true),
        MouseAction::Move(button)
            if mode == Mode::AnyMotion || (mode == Mode::ButtonMotion && button.is_some()) =>
        {
            (32 + button.unwrap_or(3).min(3), false)
        }
        MouseAction::Wheel(up) => (if up { 64 } else { 65 }, false),
        _ => return None,
    };
    if release && screen.mouse_protocol_encoding() != Encoding::Sgr {
        code = 3;
    }
    if mode != Mode::Press {
        code |= (u8::from(modifiers.shift) * 4)
            | (u8::from(modifiers.alt) * 8)
            | (u8::from(modifiers.control) * 16);
    }
    let x = u32::from(point.col) + 1;
    let y = u32::from(point.row) + 1;
    match screen.mouse_protocol_encoding() {
        Encoding::Sgr => {
            Some(format!("\x1b[<{code};{x};{y}{}", if release { 'm' } else { 'M' }).into_bytes())
        }
        Encoding::Default if x <= 223 && y <= 223 => {
            Some(vec![27, b'[', b'M', code + 32, x as u8 + 32, y as u8 + 32])
        }
        Encoding::Utf8 if x <= 2015 && y <= 2015 => Some(
            format!(
                "\x1b[M{}{}{}",
                char::from(code + 32),
                char::from_u32(x + 32)?,
                char::from_u32(y + 32)?
            )
            .into_bytes(),
        ),
        _ => None,
    }
}

/// A web link on screen (`WebLinksAddon`): its URL and first and last cells.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Link {
    pub url: String,
    pub start: CellPoint,
    pub end: CellPoint,
}
impl Link {
    pub fn contains(&self, row: u16, col: u16) -> bool {
        (self.start.row, self.start.col) <= (row, col) && (row, col) <= (self.end.row, self.end.col)
    }
}

/// `linkHandler` with `allowNonHttpProtocols: false`: an http(s) URL with a
/// host and no credentials.
fn web_url(candidate: &str) -> bool {
    reqwest::Url::parse(candidate).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

/// The OSC 8 hyperlink under a cell, when it points at the web: the run of
/// cells written under it around the point.
fn hyperlink_at(screen: &Screen, point: CellPoint) -> Option<Link> {
    let (_, cols) = screen.size();
    let id = |p: CellPoint| screen.cell(p.row, p.col).map_or(0, |c| c.hyperlink_id());
    let target = id(point);
    if target == 0 {
        return None;
    }
    let url = screen.hyperlink(point.row, point.col)?;
    if !web_url(url) {
        return None;
    }
    let step = |p: CellPoint, forward: bool| -> Option<CellPoint> {
        let index = u32::from(p.row) * u32::from(cols) + u32::from(p.col);
        let next = if forward {
            index + 1
        } else {
            index.checked_sub(1)?
        };
        let p = CellPoint {
            row: u16::try_from(next / u32::from(cols)).ok()?,
            col: (next % u32::from(cols)) as u16,
        };
        (id(p) == target).then_some(p)
    };
    let (mut start, mut end) = (point, point);
    while let Some(p) = step(start, false) {
        start = p;
    }
    while let Some(p) = step(end, true) {
        end = p;
    }
    Some(Link {
        url: url.to_owned(),
        start,
        end,
    })
}

/// The http(s) link under a cell: activated by the user only, never by
/// output, and never a local file. An OSC 8 hyperlink comes first; plain
/// text that reads as a URL (`WebLinksAddon`) otherwise.
pub fn link_at(screen: &Screen, point: CellPoint) -> Option<Link> {
    if let Some(link) = hyperlink_at(screen, point) {
        return Some(link);
    }
    let (rows, cols) = screen.size();
    let mut start = point.row;
    while start > 0 && screen.row_wrapped(start - 1) {
        start -= 1;
    }
    let mut end = point.row;
    while end + 1 < rows && screen.row_wrapped(end) {
        end += 1;
    }
    let mut text = String::new();
    let mut offset = None;
    // The byte at which each visible cell's text begins.
    let mut cells: Vec<(usize, CellPoint)> = Vec::new();
    for row in start..=end {
        for col in 0..cols {
            let cell = screen.cell(row, col)?;
            if point == (CellPoint { row, col }) {
                offset = Some(if cell.is_wide_continuation() {
                    text.char_indices().last().map_or(0, |(i, _)| i)
                } else {
                    text.len()
                });
            }
            if !cell.is_wide_continuation() {
                cells.push((text.len(), CellPoint { row, col }));
                let value = cell.contents();
                text.push_str(if value.is_empty() { " " } else { &value });
            }
        }
    }
    let offset = offset?;
    let delimiter = |c: char| c.is_whitespace() || matches!(c, '\'' | '"' | '<' | '>');
    let left = text[..offset]
        .char_indices()
        .rev()
        .find(|(_, c)| delimiter(*c))
        .map_or(0, |(i, c)| i + c.len_utf8());
    let right = text[offset..]
        .char_indices()
        .find(|(_, c)| delimiter(*c))
        .map_or(text.len(), |(i, _)| offset + i);
    let opened = text[left..right].trim_start_matches(['(', '[', '{']);
    let begin = right - opened.len();
    let candidate = opened.trim_end_matches(['.', ',', ';', '!', '?']);
    let mut candidate = candidate.to_string();
    for (open, close) in [('(', ')'), ('[', ']'), ('{', '}')] {
        while candidate.ends_with(close)
            && candidate.matches(close).count() > candidate.matches(open).count()
        {
            candidate.pop();
        }
    }
    if !web_url(&candidate) {
        return None;
    }
    let cell_of = |byte: usize| {
        cells
            .iter()
            .rev()
            .find(|(at, _)| *at <= byte)
            .map(|(_, cell)| *cell)
    };
    Some(Link {
        start: cell_of(begin)?,
        end: cell_of(begin + candidate.len() - 1)?,
        url: candidate,
    })
}

/// `quoteTerminalPaths`: dropped paths as literal arguments for the shell,
/// separated by spaces, with no Enter or control bytes. Shells whose quoting
/// cannot be trusted fail closed.
pub fn quote_paths(paths: &[std::path::PathBuf], shell: &str) -> Result<String, &'static str> {
    let name = shell
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    let posix = matches!(name, "sh" | "bash" | "zsh" | "dash" | "ksh" | "fish");
    let powershell = matches!(name, "powershell" | "pwsh");
    if !posix && !powershell && name != "cmd" {
        return Err("The terminal shell does not support path insertion.");
    }
    let mut quoted = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path.to_str().ok_or("A path is not valid text.")?;
        if path.is_empty() || path.chars().any(|c| c.is_control()) {
            return Err("A path contains terminal control characters.");
        }
        quoted.push(if powershell {
            format!("'{}'", path.replace('\'', "''"))
        } else if name == "fish" {
            format!("'{}'", path.replace('\\', "\\\\").replace('\'', "\\'"))
        } else if name == "cmd" {
            if path.contains(['%', '!', '"']) {
                return Err("This path cannot be inserted literally into cmd.");
            }
            format!("\"{path}\"")
        } else if path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c))
        {
            path.to_owned()
        } else {
            format!("'{}'", path.replace('\'', "'\\''"))
        });
    }
    Ok(quoted.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_keys_preserve_navigation_modifiers_and_control_bytes() {
        let plain = MouseModifiers::default();
        let control = MouseModifiers {
            control: true,
            ..plain
        };
        let alt = MouseModifiers { alt: true, ..plain };
        assert_eq!(key_bytes("up", plain, true).unwrap(), b"\x1bOA");
        assert_eq!(key_bytes("left", control, true).unwrap(), b"\x1b[1;5D");
        assert_eq!(key_bytes("f5", alt, false).unwrap(), b"\x1b[15;3~");
        assert_eq!(key_bytes("f1", plain, false).unwrap(), b"\x1bOP");
        assert_eq!(key_bytes("space", control, false).unwrap(), vec![0]);
        assert_eq!(key_bytes("c", control, false).unwrap(), vec![3]);
        assert_eq!(key_bytes("?", control, false).unwrap(), vec![127]);
        assert_eq!(key_bytes("b", alt, false).unwrap(), b"\x1bb");
        assert!(key_bytes("你", plain, false).is_none());
    }
    #[test]
    fn selection_preserves_wide_characters_reverse_drag_and_soft_wrap() {
        let mut parser = vt100::Parser::new(4, 8, 10);
        parser.process("abc你好XYZ\r\nnext".as_bytes());
        let selection = Selection::at(
            parser.screen(),
            CellPoint { row: 1, col: 2 },
            CellPoint { row: 0, col: 4 },
        );
        assert_eq!(selection.text(&mut parser), "你好XYZ");
        assert!(selection.contains(parser.screen(), 0, 3));
        let word = Selection::word(parser.screen(), CellPoint { row: 0, col: 4 });
        assert_eq!(word.text(&mut parser), "abc你好X");
    }
    #[test]
    fn a_selection_keeps_its_text_as_output_and_the_view_scroll() {
        let mut parser = vt100::Parser::new(3, 10, 100);
        parser.process(b"one\r\ntwo\r\nthree");
        // "two" to "three"; three more lines push them into the scrollback.
        let selection = Selection::at(
            parser.screen(),
            CellPoint { row: 1, col: 0 },
            CellPoint { row: 2, col: 5 },
        );
        parser.process(b"\r\nfour\r\nfive\r\nsix");
        assert_eq!(selection.text(&mut parser), "two\nthree");
        assert_eq!(parser.screen().scrollback(), 0, "the view stays live");
        assert!(!selection.contains(parser.screen(), 0, 0));
        // Scrolled back, the view shows it where it now is.
        parser.set_scrollback(3);
        assert!(selection.contains(parser.screen(), 1, 0));
        assert!(selection.contains(parser.screen(), 2, 4));
        assert!(!selection.contains(parser.screen(), 0, 0));
        // Begun in the scrollback, a selection runs on into the live screen.
        let anchor = Place::of(parser.screen(), CellPoint { row: 2, col: 0 });
        parser.set_scrollback(0);
        let head = Place::of(parser.screen(), CellPoint { row: 2, col: 3 });
        let across = Selection { anchor, head };
        assert_eq!(across.text(&mut parser), "three\nfour\nfive\nsix");
        assert!(across.alive(parser.screen(), 3));
        // Once its rows leave the scrollback, nothing of it is left.
        let mut small = vt100::Parser::new(2, 10, 1);
        small.process(b"a\r\nb");
        let gone = Selection::at(
            small.screen(),
            CellPoint { row: 0, col: 0 },
            CellPoint { row: 0, col: 1 },
        );
        small.process(b"\r\nc\r\nd\r\ne");
        assert!(!gone.alive(small.screen(), 1));
        assert_eq!(gone.text(&mut small), "");
    }
    #[test]
    fn negotiated_mouse_modes_encode_release_modifiers_and_large_coordinates() {
        let mut parser = vt100::Parser::new(24, 300, 10);
        let point = CellPoint { row: 2, col: 250 };
        assert!(
            mouse_report(
                parser.screen(),
                MouseAction::Press(0),
                point,
                MouseModifiers::default()
            )
            .is_none()
        );
        parser.process(b"\x1b[?1002h\x1b[?1006h");
        let ctrl = MouseModifiers {
            control: true,
            ..Default::default()
        };
        assert_eq!(
            mouse_report(parser.screen(), MouseAction::Press(0), point, ctrl).unwrap(),
            b"\x1b[<16;251;3M"
        );
        assert_eq!(
            mouse_report(parser.screen(), MouseAction::Release(0), point, ctrl).unwrap(),
            b"\x1b[<16;251;3m"
        );
        assert_eq!(
            mouse_report(parser.screen(), MouseAction::Move(Some(0)), point, ctrl).unwrap(),
            b"\x1b[<48;251;3M"
        );
        assert!(mouse_report(parser.screen(), MouseAction::Move(None), point, ctrl).is_none());
        parser.process(b"\x1b[?1003h");
        assert_eq!(
            mouse_report(
                parser.screen(),
                MouseAction::Move(None),
                point,
                MouseModifiers::default()
            )
            .unwrap(),
            b"\x1b[<35;251;3M"
        );
        parser.process(b"\x1b[?1006l");
        assert!(mouse_report(parser.screen(), MouseAction::Press(0), point, ctrl).is_none());
        assert_eq!(
            mouse_report(
                parser.screen(),
                MouseAction::Wheel(true),
                CellPoint::default(),
                ctrl
            )
            .unwrap(),
            vec![27, b'[', b'M', 112, 33, 33]
        );
        parser.process(b"\x1b[?1005h");
        assert!(
            std::str::from_utf8(
                &mouse_report(parser.screen(), MouseAction::Press(0), point, ctrl).unwrap()
            )
            .is_ok()
        );
    }
    #[test]
    fn osc8_hyperlinks_open_their_web_targets_only() {
        let mut parser = vt100::Parser::new(4, 20, 0);
        parser.process(
            b"go \x1b]8;id=1;https://example.com/a;b\x1b\\\x1b[1mhere\x1b[0m\x1b]8;;\x1b\\ x\r\n\
              \x1b]8;;file:///etc/passwd\x07local\x1b]8;;\x07",
        );
        let screen = parser.screen();
        let link = link_at(screen, CellPoint { row: 0, col: 4 }).unwrap();
        assert_eq!(link.url, "https://example.com/a;b");
        assert_eq!(
            (link.start, link.end),
            (CellPoint { row: 0, col: 3 }, CellPoint { row: 0, col: 6 })
        );
        // The SGR reset inside the link kept it open; the space after it
        // is plain text.
        assert!(link_at(screen, CellPoint { row: 0, col: 7 }).is_none());
        assert!(link_at(screen, CellPoint { row: 1, col: 1 }).is_none());
    }

    #[test]
    fn only_explicit_web_urls_are_detected_across_wrapped_rows() {
        let mut parser = vt100::Parser::new(6, 20, 0);
        parser
            .process(b"see (https://example.com/a).\r\nfile:///etc/passwd\r\njavascript:alert(1)");
        let link = link_at(parser.screen(), CellPoint { row: 1, col: 3 }).unwrap();
        assert_eq!(link.url, "https://example.com/a");
        // The span skips the bracket and the trailing `).`, across the wrap.
        assert_eq!(
            (link.start, link.end),
            (CellPoint { row: 0, col: 5 }, CellPoint { row: 1, col: 5 })
        );
        assert!(link.contains(0, 19) && link.contains(1, 0));
        assert!(!link.contains(0, 4) && !link.contains(1, 6));
        assert!(link_at(parser.screen(), CellPoint { row: 2, col: 5 }).is_none());
        assert!(link_at(parser.screen(), CellPoint { row: 3, col: 5 }).is_none());
    }

    #[test]
    fn dropped_paths_are_quoted_for_the_shell_or_refused() {
        use std::path::PathBuf;
        let paths = [
            PathBuf::from("/tmp/plain-file.md"),
            PathBuf::from("/tmp/it's here.md"),
        ];
        assert_eq!(
            super::quote_paths(&paths, "/bin/zsh").unwrap(),
            "/tmp/plain-file.md '/tmp/it'\\''s here.md'"
        );
        assert_eq!(
            super::quote_paths(&paths[1..], "/opt/homebrew/bin/fish").unwrap(),
            "'/tmp/it\\'s here.md'"
        );
        assert_eq!(
            super::quote_paths(&paths[1..], "pwsh").unwrap(),
            "'/tmp/it''s here.md'"
        );
        assert_eq!(
            super::quote_paths(&[PathBuf::from("C:\\a b")], "cmd.exe").unwrap(),
            "\"C:\\a b\""
        );
        assert!(super::quote_paths(&[PathBuf::from("C:\\100%")], "cmd").is_err());
        assert!(super::quote_paths(&[PathBuf::from("/tmp/a\nb")], "bash").is_err());
        assert!(super::quote_paths(&paths, "claude").is_err());
    }

    /// Quoted paths reach a real shell as the same literal arguments,
    /// whatever they contain, and nothing in them runs.
    #[cfg(unix)]
    #[test]
    fn dropped_paths_round_trip_through_a_real_shell_without_executing() {
        use std::path::PathBuf;
        let paths = [
            "/repo/中文 file.md",
            "/repo/it's.md",
            "/repo/$(echo injected)`echo nope`;$HOME.md",
        ];
        let quoted = super::quote_paths(&paths.map(PathBuf::from), "/bin/zsh").unwrap();
        assert!(!quoted.contains('\n'));
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", &format!("printf '%s\\0' {quoted}")])
            .output()
            .unwrap();
        let echoed = String::from_utf8(output.stdout).unwrap();
        assert_eq!(
            echoed
                .split('\0')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>(),
            paths
        );
        // C0 and C1 terminal controls never reach the prompt.
        for path in ["/repo/a\nb", "/repo/\u{1b}[31m", "/repo/\u{9b}31m"] {
            assert!(
                super::quote_paths(&[PathBuf::from(path)], "zsh").is_err(),
                "{path:?}"
            );
        }
        assert_eq!(
            super::quote_paths(&[PathBuf::from("C:\\my files\\it's.md")], "pwsh.exe").unwrap(),
            "'C:\\my files\\it''s.md'"
        );
    }
}
