//! The one-shot OAuth callback server: listens on loopback only
//! (`127.0.0.1`, and `::1` when the system has it, since a browser may
//! resolve `localhost` to either, as Cherry Studio's transport does), answers
//! the browser with a short page, and hands back the authorization code of
//! the first request on `path` whose `state` matches. Other requests
//! (favicons, stray probes) get 404 and are ignored.
use super::Cancel;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

pub struct Callback {
    listeners: Vec<TcpListener>,
    pub port: u16,
}

/// The code and the `state` it came back with.
#[derive(Debug, PartialEq, Eq)]
pub struct Authorization {
    pub code: String,
    pub state: Option<String>,
}

impl Callback {
    /// Bind `127.0.0.1:port` (`0` for any free port) and the same port on
    /// `::1` when available.
    pub fn bind(port: u16) -> Result<Self, String> {
        let v4 =
            TcpListener::bind(("127.0.0.1", port)).map_err(|_| "OAUTH_PORT_IN_USE".to_owned())?;
        let port = v4
            .local_addr()
            .map_err(|_| "OAUTH_UNAVAILABLE".to_owned())?
            .port();
        let mut listeners = vec![v4];
        // IPv6 loopback is optional: some systems have none.
        if let Ok(v6) = TcpListener::bind(("::1", port)) {
            listeners.push(v6);
        }
        for listener in &listeners {
            listener
                .set_nonblocking(true)
                .map_err(|_| "OAUTH_UNAVAILABLE".to_owned())?;
        }
        Ok(Self { listeners, port })
    }

    /// Wait (on a blocking thread) for the callback on `path`; `state`, when
    /// given, must match exactly.
    pub async fn wait(
        self,
        path: String,
        state: Option<String>,
        cancel: Cancel,
        timeout: Duration,
    ) -> Result<Authorization, String> {
        tokio::task::spawn_blocking(move || {
            self.wait_blocking(&path, state.as_deref(), &cancel, timeout)
        })
        .await
        .map_err(|_| "OAUTH_UNAVAILABLE".to_owned())?
    }

    fn wait_blocking(
        &self,
        path: &str,
        state: Option<&str>,
        cancel: &Cancel,
        timeout: Duration,
    ) -> Result<Authorization, String> {
        let deadline = Instant::now() + timeout;
        loop {
            cancel.check()?;
            if Instant::now() >= deadline {
                return Err("OAUTH_TIMEOUT".into());
            }
            let mut idle = true;
            for listener in &self.listeners {
                match listener.accept() {
                    Ok((stream, _)) => {
                        idle = false;
                        if let Some(result) = answer(stream, path, state) {
                            return result;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => return Err("OAUTH_UNAVAILABLE".into()),
                }
            }
            if idle {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

const SUCCESS: &str = "PuppyOne is signed in. You can close this tab and return to the app.";
const FAILURE: &str = "PuppyOne could not finish signing in. Return to the app and try again.";

fn page(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>PuppyOne</title>\
         <body style=\"font:15px -apple-system,system-ui,sans-serif;margin:64px auto;max-width:420px;color:#222\">\
         <p>{message}</p></body>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncache-control: no-store\r\n\
         content-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// `None` for a request that is not the callback; otherwise its outcome.
fn answer(
    mut stream: TcpStream,
    path: &str,
    state: Option<&str>,
) -> Option<Result<Authorization, String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    if BufReader::new(&stream).take_line(&mut line).is_err() {
        return None;
    }
    let target = line.split_whitespace().nth(1).unwrap_or_default();
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if !line.starts_with("GET ") || url.path() != path {
        page(&mut stream, "404 Not Found", FAILURE);
        return None;
    }
    let query = |key: &str| {
        url.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    };
    if query("error").is_some() {
        page(&mut stream, "400 Bad Request", FAILURE);
        return Some(Err("OAUTH_DENIED".into()));
    }
    let returned = query("state");
    if let Some(expected) = state
        && returned.as_deref() != Some(expected)
    {
        page(&mut stream, "400 Bad Request", FAILURE);
        return Some(Err("OAUTH_STATE_MISMATCH".into()));
    }
    let Some(code) = query("code").filter(|c| !c.is_empty()) else {
        page(&mut stream, "400 Bad Request", FAILURE);
        return Some(Err("OAUTH_INVALID_RESPONSE".into()));
    };
    page(&mut stream, "200 OK", SUCCESS);
    Some(Ok(Authorization {
        code,
        state: returned,
    }))
}

/// One request line, bounded.
trait TakeLine {
    fn take_line(self, line: &mut String) -> std::io::Result<()>;
}
impl<R: BufRead> TakeLine for R {
    fn take_line(self, line: &mut String) -> std::io::Result<()> {
        self.take(8192).read_line(line).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(port: u16, target: &str) -> String {
        use std::io::Read as _;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n").unwrap();
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
    }

    fn run(
        target_requests: Vec<&'static str>,
        state: Option<&str>,
    ) -> Result<Authorization, String> {
        let callback = Callback::bind(0).unwrap();
        let port = callback.port;
        let client = std::thread::spawn(move || {
            target_requests
                .into_iter()
                .map(|t| get(port, t))
                .collect::<Vec<_>>()
        });
        let result = callback.wait_blocking(
            "/auth/callback",
            state,
            &Cancel::default(),
            Duration::from_secs(5),
        );
        let pages = client.join().unwrap();
        assert!(pages.iter().all(|p| p.starts_with("HTTP/1.1")));
        result
    }

    #[test]
    fn the_callback_returns_the_code_after_ignoring_other_paths() {
        let result = run(
            vec!["/favicon.ico", "/auth/callback?code=abc&state=s1"],
            Some("s1"),
        );
        assert_eq!(
            result.unwrap(),
            Authorization {
                code: "abc".into(),
                state: Some("s1".into())
            }
        );
    }

    #[test]
    fn a_mismatched_state_or_a_denial_fails_the_sign_in() {
        assert_eq!(
            run(vec!["/auth/callback?code=abc&state=forged"], Some("s1")).unwrap_err(),
            "OAUTH_STATE_MISMATCH"
        );
        assert_eq!(
            run(vec!["/auth/callback?error=access_denied"], None).unwrap_err(),
            "OAUTH_DENIED"
        );
        assert_eq!(
            run(vec!["/auth/callback?state=s1"], Some("s1")).unwrap_err(),
            "OAUTH_INVALID_RESPONSE"
        );
    }

    #[test]
    fn a_cancelled_or_timed_out_sign_in_stops_listening() {
        let callback = Callback::bind(0).unwrap();
        let cancel = Cancel::default();
        cancel.cancel();
        assert_eq!(
            callback
                .wait_blocking("/cb", None, &cancel, Duration::from_secs(5))
                .unwrap_err(),
            "OAUTH_CANCELLED"
        );
        let callback = Callback::bind(0).unwrap();
        assert_eq!(
            callback
                .wait_blocking("/cb", None, &Cancel::default(), Duration::from_millis(60))
                .unwrap_err(),
            "OAUTH_TIMEOUT"
        );
    }

    #[test]
    fn the_server_binds_only_to_loopback_on_both_families() {
        let callback = Callback::bind(0).unwrap();
        assert!(
            callback
                .listeners
                .iter()
                .all(|l| l.local_addr().unwrap().ip().is_loopback())
        );
        // `localhost` may resolve to `::1`: the callback still arrives.
        if callback.listeners.len() == 2 {
            let port = callback.port;
            std::thread::spawn(move || {
                use std::io::{Read, Write};
                std::thread::sleep(Duration::from_millis(50));
                let mut s = TcpStream::connect(("::1", port)).unwrap();
                s.write_all(b"GET /cb?code=c6 HTTP/1.1\r\nHost: localhost\r\n\r\n")
                    .unwrap();
                let _ = s.read(&mut [0u8; 256]);
            });
            let got = callback
                .wait_blocking("/cb", None, &Cancel::default(), Duration::from_secs(5))
                .unwrap();
            assert_eq!(got.code, "c6");
        }
    }
}
