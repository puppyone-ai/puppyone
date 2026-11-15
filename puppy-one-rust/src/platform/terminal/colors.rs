//! Consume startup OSC 10/11 queries before publishing terminal output. Carry
//! only a possible query prefix, so split chunks do not become visible text.
use super::environment::DefaultColors;
const QUERIES: [(&[u8], u8); 8] = [
    (b"\x1b]10;?\x1b\\", 10),
    (b"\x1b]10;?\x07", 10),
    (b"\x1b]11;?\x1b\\", 11),
    (b"\x1b]11;?\x07", 11),
    (b"\xc2\x9d10;?\xc2\x9c", 10),
    (b"\xc2\x9d11;?\xc2\x9c", 11),
    (b"\x9d10;?\x9c", 10),
    (b"\x9d11;?\x9c", 11),
];
pub struct Handled {
    pub output: Vec<u8>,
    pub replies: Vec<Vec<u8>>,
}
pub struct Responder {
    colors: DefaultColors,
    carry: Vec<u8>,
}
impl Responder {
    pub fn new(colors: DefaultColors) -> Self {
        Self {
            colors,
            carry: vec![],
        }
    }
    pub fn update(&mut self, colors: DefaultColors) {
        self.colors = colors;
    }
    pub fn process(&mut self, bytes: &[u8]) -> Handled {
        let mut source = std::mem::take(&mut self.carry);
        source.extend_from_slice(bytes);
        let mut result = Handled {
            output: Vec::with_capacity(source.len()),
            replies: vec![],
        };
        let mut cursor = 0;
        while cursor < source.len() {
            let remaining = &source[cursor..];
            if let Some((sequence, slot)) = QUERIES
                .iter()
                .find(|(sequence, _)| remaining.starts_with(sequence))
            {
                let channels = if *slot == 10 {
                    self.colors.foreground
                } else {
                    self.colors.background
                };
                let value = channels.map(|c| format!("{c:02x}{c:02x}")).join("/");
                result
                    .replies
                    .push(format!("\x1b]{slot};rgb:{value}\x1b\\").into_bytes());
                cursor += sequence.len();
            } else if QUERIES
                .iter()
                .any(|(sequence, _)| sequence.starts_with(remaining))
            {
                self.carry.extend_from_slice(remaining);
                break;
            } else {
                result.output.push(source[cursor]);
                cursor += 1;
            }
        }
        result
    }
    pub fn flush(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.carry)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    const LIGHT: DefaultColors = DefaultColors {
        foreground: [109, 102, 93],
        background: [251, 250, 247],
    };
    #[test]
    fn every_query_encoding_survives_each_chunk_boundary_and_color_updates() {
        for (sequence, slot) in QUERIES {
            for split in 0..=sequence.len() {
                let mut responder = Responder::new(LIGHT);
                let mut first = b"before".to_vec();
                first.extend_from_slice(&sequence[..split]);
                let mut second = sequence[split..].to_vec();
                second.extend_from_slice(b"after");
                let a = responder.process(&first);
                let b = responder.process(&second);
                assert_eq!([a.output, b.output].concat(), b"beforeafter");
                let expected = if slot == 10 {
                    b"\x1b]10;rgb:6d6d/6666/5d5d\x1b\\".to_vec()
                } else {
                    b"\x1b]11;rgb:fbfb/fafa/f7f7\x1b\\".to_vec()
                };
                assert_eq!([a.replies, b.replies].concat(), vec![expected]);
                assert!(responder.flush().is_empty());
            }
        }
        let mut responder = Responder::new(LIGHT);
        assert!(responder.process(b"\x1b]10;").replies.is_empty());
        responder.update(DefaultColors {
            foreground: [209, 206, 198],
            background: [22, 20, 19],
        });
        assert_eq!(
            responder.process(b"?\x1b\\\x1b]11;?\x1b\\").replies,
            [
                b"\x1b]10;rgb:d1d1/cece/c6c6\x1b\\".to_vec(),
                b"\x1b]11;rgb:1616/1414/1313\x1b\\".to_vec()
            ]
        );
    }
    #[test]
    fn partial_queries_flush_once_and_unrelated_output_is_preserved_byte_for_byte() {
        let mut responder = Responder::new(LIGHT);
        let bytes = b"\xff\x1b]52;c;?\x07\x1b]110;?\x07\x1b[?1049h\xe4\xb8\xad";
        let result = responder.process(bytes);
        assert_eq!(result.output, bytes);
        assert!(result.replies.is_empty());
        assert_eq!(responder.process(b"tail\x1b]11;").output, b"tail");
        assert_eq!(responder.flush(), b"\x1b]11;");
        assert!(responder.flush().is_empty());
        assert_eq!(responder.process(b"x").output, b"x");
    }
}
