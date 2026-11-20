//! A scripted loopback HTTP server for OAuth tests: one canned answer per
//! request, returning what each request sent.
use std::io::{Read, Write};

#[derive(Debug)]
pub struct Request {
    pub head: String,
    pub body: String,
}

/// Serve `answers` (status line, JSON body) in order on a free port.
pub fn serve(
    answers: Vec<(&'static str, &'static str)>,
) -> (String, std::thread::JoinHandle<Vec<Request>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let server = std::thread::spawn(move || {
        let mut requests = vec![];
        for (status, body) in answers {
            let (mut stream, _) = listener.accept().unwrap();
            let mut raw = vec![];
            let mut buffer = [0u8; 4096];
            let request = loop {
                let n = stream.read(&mut buffer).unwrap();
                raw.extend_from_slice(&buffer[..n]);
                let text = String::from_utf8_lossy(&raw).to_string();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text[..split]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if raw.len() >= split + 4 + length || n == 0 {
                        break Request {
                            head: text[..split].to_owned(),
                            body: text[split + 4..].to_owned(),
                        };
                    }
                }
                if n == 0 {
                    break Request {
                        head: text,
                        body: String::new(),
                    };
                }
            };
            write!(
                stream,
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            requests.push(request);
        }
        requests
    });
    (base, server)
}
