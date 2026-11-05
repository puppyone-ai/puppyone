//! `transports/jsonl-stream.mjs`: byte framing only; native RPC schemas and
//! command outcomes stay with each client.

/// `createJsonlFramer({ maxLineBytes, onLine, onFailure, isClosed })`: feed
/// it chunks; it calls back with each complete line.
pub struct JsonlFramer {
    max_line_bytes: usize,
    buffer: Vec<u8>,
}

/// What a chunk produced.
pub enum Framed {
    Line(String),
    /// A line (or its unfinished tail) exceeded the limit.
    Overflow,
}

impl JsonlFramer {
    pub fn new(max_line_bytes: usize) -> Self {
        Self {
            max_line_bytes,
            buffer: Vec::new(),
        }
    }

    /// Splits `chunk` into complete lines. After an overflow the buffer is
    /// cleared and no further lines from this chunk are produced.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Framed> {
        self.buffer.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(newline) = self.buffer.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.len() > self.max_line_bytes {
                self.buffer.clear();
                out.push(Framed::Overflow);
                return out;
            }
            let text = String::from_utf8_lossy(&line).into_owned();
            if !text.trim().is_empty() {
                out.push(Framed::Line(text));
            }
        }
        // Check the unfinished tail even when this chunk also contained valid lines.
        if self.buffer.len() > self.max_line_bytes {
            self.buffer.clear();
            out.push(Framed::Overflow);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn frames_lines_across_chunks_and_bounds_them() {
        let mut framer = JsonlFramer::new(8);
        let lines = |frames: Vec<Framed>| -> Vec<String> {
            frames
                .into_iter()
                .map(|f| match f {
                    Framed::Line(l) => l,
                    Framed::Overflow => "!".into(),
                })
                .collect()
        };
        assert_eq!(lines(framer.push(b"ab")), Vec::<String>::new());
        assert_eq!(lines(framer.push(b"c\r\n\n d\n")), ["abc", " d"]);
        assert_eq!(lines(framer.push(b"123456789")), ["!"]);
        assert_eq!(lines(framer.push(b"ok\n")), ["ok"]);
    }
}
