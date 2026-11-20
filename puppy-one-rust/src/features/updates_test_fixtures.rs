#![cfg(test)]
use super::*;
#[cfg(target_os = "macos")]
use std::path::Path;
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

#[derive(Default)]
struct Replies {
    files: BTreeMap<String, Vec<u8>>,
    requests: Vec<String>,
    stopped: bool,
}

pub(super) struct Feed {
    pub url: url::Url,
    replies: Arc<Mutex<Replies>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Feed {
    pub fn new(files: Vec<(String, Vec<u8>)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let replies = Arc::new(Mutex::new(Replies {
            files: files.into_iter().collect(),
            ..Replies::default()
        }));
        let worker = replies.clone();
        let thread = std::thread::spawn(move || {
            while !worker.lock().unwrap().stopped {
                let (mut stream, _) = match listener.accept() {
                    Ok(stream) => stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(_) => return,
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 1024];
                while request.len() < 8192 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => request.extend_from_slice(&chunk[..n]),
                    }
                }
                let request = String::from_utf8_lossy(&request);
                let path = request.split_whitespace().nth(1).unwrap_or("").to_owned();
                let name = path.strip_prefix("/feed/").unwrap_or("");
                let mut state = worker.lock().unwrap();
                state.requests.push(path.clone());
                if state.stopped {
                    return;
                }
                let body = state.files.get(name).cloned();
                drop(state);
                let status = if body.is_some() {
                    "200 OK"
                } else {
                    "404 Not Found"
                };
                let body = body.unwrap_or_default();
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(&body);
            }
        });
        Self {
            url: url::Url::parse(&format!("http://{address}/feed")).unwrap(),
            replies,
            thread: Some(thread),
        }
    }
    pub fn requests(&self) -> Vec<String> {
        self.replies.lock().unwrap().requests.clone()
    }
    pub fn put(&self, name: &str, body: Vec<u8>) {
        self.replies.lock().unwrap().files.insert(name.into(), body);
    }
    /// Whether the worker thread, which owns the listener, still holds its
    /// state: `false` once the listener is closed.
    pub fn listening(&self) -> impl Fn() -> bool + use<> {
        let state = Arc::downgrade(&self.replies);
        move || state.strong_count() > 0
    }
}
impl Drop for Feed {
    fn drop(&mut self) {
        self.replies.lock().unwrap().stopped = true;
        if let Some(thread) = self.thread.take() {
            let result = thread.join();
            if !std::thread::panicking() {
                assert!(result.is_ok(), "update feed worker panicked");
            }
        }
    }
}

#[derive(Default)]
pub(super) struct Quits(pub usize);
impl Global for Quits {}
fn quit(cx: &mut App) {
    cx.update_global(|count: &mut Quits, _| count.0 += 1);
}

pub(super) struct Fixture {
    entity: Entity<Updates>,
    pub root: tempfile::TempDir,
}
impl std::ops::Deref for Fixture {
    type Target = Entity<Updates>;
    fn deref(&self) -> &Self::Target {
        &self.entity
    }
}
impl Fixture {
    pub fn new(
        feed: &Feed,
        channel: build_identity::Channel,
        current: &str,
        automatic: bool,
        cx: &mut gpui::TestAppContext,
    ) -> Self {
        let root = tempfile::tempdir().unwrap();
        cx.update(|cx| cx.set_global(Quits::default()));
        let entity = cx.new(|_| Updates {
            state: UpdateState::new(channel, current.into(), None, automatic),
            config: Configuration {
                channel,
                current_version: current.into(),
                feed: Some(feed.url.clone()),
                update_channel: Some(channel.key()),
                force_dev: true,
            },
            candidate: None,
            #[cfg(target_os = "macos")]
            prepared: None,
            busy: false,
            waiting: Vec::new(),
            restart_requested: false,
            data_dir: root.path().join("profile"),
            downloads: root.path().join("downloads"),
            download_cancel: None,
            quit,
            _schedule: None,
        });
        Self { entity, root }
    }
    pub fn profile(&self) -> PathBuf {
        self.root.path().join("profile")
    }
    pub fn quits(&self, cx: &mut gpui::TestAppContext) -> usize {
        cx.update(|cx| cx.global::<Quits>().0)
    }

    #[cfg(target_os = "macos")]
    pub fn prepare_target(&self, version: &str, cx: &mut gpui::TestAppContext) -> Vec<u8> {
        let current = self.read_with(cx, |u, _| u.state.current_version.clone());
        let installed = signed_app(&self.root.path().join("Applications"), &current);
        let incoming = signed_app(&self.root.path().join("build"), version);
        let archive = self.root.path().join("update.zip");
        run(
            "/usr/bin/ditto",
            &[
                "-c".as_ref(),
                "-k".as_ref(),
                "--keepParent".as_ref(),
                incoming.as_os_str(),
                archive.as_os_str(),
            ],
        );
        let prepared =
            updates::prepared::PreparedUpdate::new(installed, self.root.path().join("staging"))
                .unwrap();
        self.update(cx, |u, _| u.prepared = Some(prepared));
        std::fs::read(archive).unwrap()
    }
    #[cfg(target_os = "macos")]
    pub fn installed_version(&self) -> String {
        let info: serde_json::Value = serde_json::from_slice(
            &std::fs::read(self.root.path().join(
                "Applications/PuppyOne Update Fixture.app/Contents/Resources/build-info.json",
            ))
            .unwrap(),
        )
        .unwrap();
        info["version"].as_str().unwrap().to_owned()
    }
}

#[cfg(target_os = "macos")]
fn run(program: &str, arguments: &[&std::ffi::OsStr]) {
    let output = std::process::Command::new(program)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{program}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
#[cfg(target_os = "macos")]
fn signed_app(parent: &Path, version: &str) -> PathBuf {
    let app = parent.join("PuppyOne Update Fixture.app");
    let contents = app.join("Contents");
    std::fs::create_dir_all(contents.join("MacOS")).unwrap();
    std::fs::create_dir_all(contents.join("Resources")).unwrap();
    std::fs::copy("/bin/echo", contents.join("MacOS/fixture")).unwrap();
    std::fs::write(contents.join("Info.plist"),format!(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>ai.puppyone.update.fixture</string><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#)).unwrap();
    std::fs::write(
        contents.join("Resources/build-info.json"),
        serde_json::json!({"runtime":"gpui","version":version}).to_string(),
    )
    .unwrap();
    // An explicit ad hoc requirement exercises the real codesign/ditto swap
    // in this private fixture. Production init still requires a release signature.
    run(
        "/usr/bin/codesign",
        &[
            "--force".as_ref(),
            "--sign".as_ref(),
            "-".as_ref(),
            "--requirements".as_ref(),
            "=designated => identifier \"ai.puppyone.update.fixture\"".as_ref(),
            app.as_os_str(),
        ],
    );
    assert_eq!(updates::signature(&app), updates::Signature::AdHoc);
    app
}
