//! Viewport selection and xterm mouse encoding, independent of GPUI event delivery.
//! Protocol reference: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking
use vt100::{MouseProtocolEncoding as Encoding, MouseProtocolMode as Mode, Screen};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct CellPoint {
    pub row: u16,
    pub col: u16,
}
#[derive(Clone, Copy, Debug)]
pub struct Selection {
    pub anchor: CellPoint,
    pub head: CellPoint,
}
impl Selection {
    pub fn range(self, screen: &Screen) -> (CellPoint, CellPoint) {
        let (mut start, mut end) = if self.anchor <= self.head {
            (self.anchor, self.head)
        } else {
            (self.head, self.anchor)
        };
        if start != end {
            if screen
                .cell(start.row, start.col)
                .is_some_and(|c| c.is_wide_continuation())
            {
                start.col = start.col.saturating_sub(1);
            }
            if screen
                .cell(end.row, end.col)
                .is_some_and(|c| c.is_wide_continuation())
            {
                end.col += 1;
            }
        }
        (start, end)
    }
    pub fn contains(self, screen: &Screen, row: u16, col: u16) -> bool {
        let (start, end) = self.range(screen);
        let p = CellPoint { row, col };
        start <= p && p < end
    }
    pub fn text(self, screen: &Screen) -> String {
        let (start, end) = self.range(screen);
        screen.contents_between(start.row, start.col, end.row, end.col)
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
        Self {
            anchor: CellPoint {
                row: point.row,
                col: start,
            },
            head: CellPoint {
                row: point.row,
                col: end,
            },
        }
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

/// The http(s) link under a cell: activated by the user only, never by
/// output, and never a local file.
pub fn link_at(screen: &Screen, point: CellPoint) -> Option<Link> {
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
    let url = reqwest::Url::parse(&candidate).ok()?;
    if !(matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    {
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
        let selection = Selection {
            anchor: CellPoint { row: 1, col: 2 },
            head: CellPoint { row: 0, col: 4 },
        };
        assert_eq!(selection.text(parser.screen()), "你好XYZ");
        assert!(selection.contains(parser.screen(), 0, 3));
        let word = Selection::word(parser.screen(), CellPoint { row: 0, col: 4 });
        assert_eq!(word.text(parser.screen()), "abc你好X");
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
}
