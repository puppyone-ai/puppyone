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
            // The user pasted the page's code or the callback URL.
            if let Some(text) = cancel.take_pasted() {
                return pasted(&text, path, state);
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

/// The provider pages that read the callback's answer from a script
/// (xAI's sign-in calls the loopback with `fetch` and shows "copy this
/// code" when it cannot read the reply), as xAI's own Grok CLI clients do.
const PAGE_ORIGINS: [&str; 2] = ["https://auth.x.ai", "https://accounts.x.ai"];

/// CORS for an allowed provider page, including Chrome's Private Network
/// Access; nothing for any other origin.
fn cors(origin: Option<&str>) -> String {
    match origin.filter(|o| PAGE_ORIGINS.contains(o)) {
        Some(origin) => format!(
            "access-control-allow-origin: {origin}\r\naccess-control-allow-methods: GET, OPTIONS\r\n\
             access-control-allow-headers: content-type\r\naccess-control-allow-private-network: true\r\nvary: origin\r\n"
        ),
        None => String::new(),
    }
}

fn page(stream: &mut TcpStream, status: &str, message: &str, origin: Option<&str>) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>PuppyOne</title>\
         <body style=\"font:15px -apple-system,system-ui,sans-serif;margin:64px auto;max-width:420px;color:#222\">\
         <p>{message}</p></body>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncache-control: no-store\r\n\
         {}content-length: {}\r\nconnection: close\r\n\r\n{body}",
        cors(origin),
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
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    if (&mut reader).take_line(&mut line).is_err() {
        return None;
    }
    // The headers, for the page's `Origin` (bounded).
    let mut origin: Option<String> = None;
    for _ in 0..64 {
        let mut header = String::new();
        if (&mut reader).take_line(&mut header).is_err() || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("origin")
        {
            origin = Some(value.trim().to_owned());
        }
    }
    let origin = origin.as_deref();
    let target = line.split_whitespace().nth(1).unwrap_or_default();
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    // A script's preflight: allowed, nothing is decided yet.
    if line.starts_with("OPTIONS ") && url.path() == path {
        let _ = write!(
            stream,
            "HTTP/1.1 204 No Content\r\n{}content-length: 0\r\nconnection: close\r\n\r\n",
            cors(origin)
        );
        let _ = stream.flush();
        return None;
    }
    if !line.starts_with("GET ") || url.path() != path {
        page(&mut stream, "404 Not Found", FAILURE, origin);
        return None;
    }
    let query = |key: &str| {
        url.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    };
    // Only the answer to this sign-in (its state) ends it: any other
    // request to the port, from a page or a process, is refused and the
    // wait goes on.
    let returned = query("state");
    if let Some(expected) = state
        && returned.as_deref() != Some(expected)
    {
        page(&mut stream, "400 Bad Request", FAILURE, origin);
        return None;
    }
    if query("error").is_some() {
        page(&mut stream, "400 Bad Request", FAILURE, origin);
        return Some(Err("OAUTH_DENIED".into()));
    }
    let Some(code) = query("code").filter(|c| !c.is_empty()) else {
        page(&mut stream, "400 Bad Request", FAILURE, origin);
        return Some(Err("OAUTH_INVALID_RESPONSE".into()));
    };
    page(&mut stream, "200 OK", SUCCESS, origin);
    Some(Ok(Authorization {
        code,
        state: returned,
    }))
}

/// What the user pasted: the final callback URL (checked like the callback
/// itself) or the bare code a provider's page shows ("copy this code to
/// finish signing in").
pub fn pasted(text: &str, path: &str, state: Option<&str>) -> Result<Authorization, String> {
    let text = text.trim();
    if let Ok(url) = url::Url::parse(text) {
        let query = |key: &str| {
            url.query_pairs()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.into_owned())
        };
        let loopback = url
            .host_str()
            .is_some_and(|h| matches!(h, "127.0.0.1" | "localhost" | "[::1]" | "::1"));
        if !loopback || url.path() != path {
            return Err("OAUTH_PASTE_INVALID".into());
        }
        if query("error").is_some() {
            return Err("OAUTH_DENIED".into());
        }
        let returned = query("state");
        if let Some(expected) = state
            && returned.as_deref() != Some(expected)
        {
            return Err("OAUTH_STATE_MISMATCH".into());
        }
        let code = query("code")
            .filter(|c| !c.is_empty())
            .ok_or("OAUTH_PASTE_INVALID")?;
        return Ok(Authorization {
            code,
            state: returned,
        });
    }
    // A bare code: one token of URL-safe characters.
    let plausible = (8..=4096).contains(&text.len())
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.~".contains(c));
    if !plausible {
        return Err("OAUTH_PASTE_INVALID".into());
    }
    Ok(Authorization {
        code: text.to_owned(),
        state: None,
    })
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
                state: Some("s1".into()),
            }
        );
    }

    #[test]
    fn another_pages_request_neither_ends_nor_answers_the_sign_in() {
        // A forged state or a forged denial is refused, and the real
        // answer that follows still signs in.
        assert_eq!(
            run(
                vec![
                    "/auth/callback?code=forged&state=forged",
                    "/auth/callback?error=access_denied&state=forged",
                    "/auth/callback?code=abc&state=s1",
                ],
                Some("s1")
            )
            .unwrap()
            .code,
            "abc"
        );
        assert_eq!(
            run(
                vec!["/auth/callback?error=access_denied&state=s1"],
                Some("s1")
            )
            .unwrap_err(),
            "OAUTH_DENIED"
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

    #[test]
    fn a_pasted_code_or_callback_url_finishes_the_wait() {
        // A bare code, as xAI's "copy this code" page shows it.
        let got = pasted("emxx9CrrsAIvpPfvLpJuiC8_6vr-5C2u", "/callback", Some("st")).unwrap();
        assert_eq!(
            (got.code.as_str(), got.state),
            ("emxx9CrrsAIvpPfvLpJuiC8_6vr-5C2u", None)
        );
        // The final callback URL is checked like the callback.
        let url = "http://127.0.0.1:56121/callback?code=c1&state=st";
        let got = pasted(url, "/callback", Some("st")).unwrap();
        assert_eq!(got.code, "c1");
        assert_eq!(
            pasted(
                "http://127.0.0.1:56121/callback?code=c1&state=other",
                "/callback",
                Some("st")
            )
            .unwrap_err(),
            "OAUTH_STATE_MISMATCH"
        );
        for bad in [
            "https://evil.test/callback?code=x&state=st",
            "two words",
            "abc",
        ] {
            assert_eq!(
                pasted(bad, "/callback", Some("st")).unwrap_err(),
                "OAUTH_PASTE_INVALID",
                "{bad}"
            );
        }
        // Pasting ends a running wait without any browser.
        let callback = Callback::bind(0).unwrap();
        let cancel = Cancel::default();
        cancel.paste("pasted-code-123".into());
        let got = callback
            .wait_blocking("/callback", Some("st"), &cancel, Duration::from_secs(2))
            .unwrap();
        assert_eq!(got.code, "pasted-code-123");
    }

    #[test]
    fn xais_page_reads_the_answer_after_its_preflight() {
        use std::io::{Read, Write};
        let callback = Callback::bind(0).unwrap();
        let port = callback.port;
        let exchange = |request: &'static str| {
            std::thread::spawn(move || {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(request.as_bytes()).unwrap();
                let mut reply = String::new();
                let _ = s.read_to_string(&mut reply);
                reply
            })
        };
        let preflight = exchange(
            "OPTIONS /callback?code=c&state=st HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://auth.x.ai\r\nAccess-Control-Request-Private-Network: true\r\n\r\n",
        );
        std::thread::sleep(Duration::from_millis(150));
        let get = exchange(
            "GET /callback?code=c&state=st HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://auth.x.ai\r\n\r\n",
        );
        let got = callback
            .wait_blocking(
                "/callback",
                Some("st"),
                &Cancel::default(),
                Duration::from_secs(5),
            )
            .unwrap();
        assert_eq!(got.code, "c");
        let preflight = preflight.join().unwrap();
        assert!(preflight.starts_with("HTTP/1.1 204"), "{preflight}");
        assert!(preflight.contains("access-control-allow-private-network: true"));
        let get = get.join().unwrap();
        assert!(
            get.contains("access-control-allow-origin: https://auth.x.ai"),
            "{get}"
        );
        // Another site gets no CORS.
        assert!(cors(Some("https://evil.test")).is_empty());
    }
}
