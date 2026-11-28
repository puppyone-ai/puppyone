//! Standard terminal replies needed by interactive CLI agents. OSC 52 clipboard
//! operations are deliberately not implemented; child output cannot read the clipboard.
#[derive(Default)]
pub struct Queries {
    parser: vte::Parser,
    colors: Option<crate::platform::terminal::colors::Responder>,
}
struct Replies<'a> {
    screen: &'a vt100::Screen,
    values: Vec<Vec<u8>>,
}
impl Queries {
    pub fn colors(
        &mut self,
        bytes: &[u8],
        theme: &crate::theme::Theme,
    ) -> crate::platform::terminal::colors::Handled {
        let colors = default_colors(theme);
        let responder = self
            .colors
            .get_or_insert_with(|| crate::platform::terminal::colors::Responder::new(colors));
        responder.update(colors);
        responder.process(bytes)
    }
    pub fn flush_colors(&mut self) -> Vec<u8> {
        self.colors
            .as_mut()
            .map_or_else(Vec::new, |colors| colors.flush())
    }
    pub fn process(&mut self, bytes: &[u8], screen: &vt100::Screen) -> Vec<Vec<u8>> {
        let mut replies = Replies {
            screen,
            values: vec![],
        };
        for byte in bytes {
            self.parser.advance(&mut replies, *byte);
        }
        replies.values
    }
}
impl vte::Perform for Replies<'_> {
    fn csi_dispatch(
        &mut self,
        params: &vte::Params,
        intermediates: &[u8],
        ignore: bool,
        action: char,
    ) {
        if ignore {
            return;
        }
        let first = params
            .iter()
            .next()
            .and_then(|p| p.first())
            .copied()
            .unwrap_or(0);
        let reply = match (action, first, intermediates) {
            ('n', 5, []) => Some("\x1b[0n".into()),
            ('n', 6, []) => {
                let (r, c) = self.screen.cursor_position();
                Some(format!("\x1b[{};{}R", r + 1, c + 1))
            }
            ('n', 6, [b'?']) => {
                let (r, c) = self.screen.cursor_position();
                Some(format!("\x1b[?{};{}R", r + 1, c + 1))
            }
            ('c', 0, []) => Some("\x1b[?1;2c".into()),
            ('c', 0, [b'>']) => Some("\x1b[>0;1;0c".into()),
            ('t', 18, []) => {
                let (r, c) = self.screen.size();
                Some(format!("\x1b[8;{r};{c}t"))
            }
            _ => None,
        };
        if let Some(reply) = reply {
            self.values.push(reply.into_bytes());
        }
    }
}
pub(super) fn default_colors(
    theme: &crate::theme::Theme,
) -> crate::platform::terminal::environment::DefaultColors {
    fn channels(color: gpui::Rgba) -> [u8; 3] {
        [color.r, color.g, color.b].map(|v| (v * 255.).round().clamp(0., 255.) as u8)
    }
    crate::platform::terminal::environment::DefaultColors {
        foreground: channels(theme.terminal_fg),
        background: channels(theme.terminal_bg),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_queries_and_clipboard_are_handled_safely() {
        let mut q = Queries::default();
        let mut screen = vt100::Parser::new(24, 80, 100);
        screen.process(b"hello");
        assert!(q.process(b"\x1b[", screen.screen()).is_empty());
        assert_eq!(
            q.process(b"6n", screen.screen()),
            vec![b"\x1b[1;6R".to_vec()]
        );
        assert_eq!(
            q.process(b"\x1b[18t", screen.screen()),
            vec![b"\x1b[8;24;80t".to_vec()]
        );
        assert!(q.process(b"\x1b]52;c;?\x07", screen.screen()).is_empty());
    }
}
