//! Standard terminal replies needed by interactive CLI agents. OSC 52 clipboard
//! operations are deliberately not implemented; child output cannot read the clipboard.
#[derive(Default)]
pub struct Queries {
    parser: vte::Parser,
}
struct Replies<'a> {
    screen: &'a vt100::Screen,
    values: Vec<Vec<u8>>,
}
impl Queries {
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
    fn osc_dispatch(&mut self, params: &[&[u8]], _: bool) {
        if params.len() != 2 || params[1] != b"?" {
            return;
        }
        match params[0] {
            b"10" => self
                .values
                .push(b"\x1b]10;rgb:eeee/eeee/eeee\x1b\\".to_vec()),
            b"11" => self
                .values
                .push(b"\x1b]11;rgb:1616/1616/1616\x1b\\".to_vec()),
            _ => {}
        }
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
