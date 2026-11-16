//! Process fixture for verify-managed-installer-interop.py. Uses the production
//! installer with a local archive transport, never a user's home or a network.
use po_platform::platform::local_agent_setup::{
    Algorithm, Recipe, activation::ErrorCode, installer::Installer,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    home: PathBuf,
    archive: PathBuf,
    control: PathBuf,
    hold: bool,
}
fn main() {
    let file = std::env::args_os().nth(1).expect("fixture configuration");
    let config: Config = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
    assert!(
        config.home.join(".interop-fixture").is_file(),
        "only explicitly marked fixture homes are allowed"
    );
    let downloads = Arc::new(AtomicUsize::new(0));
    let count = downloads.clone();
    let cancellation = Arc::new(AtomicBool::new(false));
    let requested = cancellation.clone();
    let installer = Installer {
        home: config.home,
        download: Arc::new(move |_, destination, cancel| {
            count.fetch_add(1, Ordering::SeqCst);
            std::fs::write(config.control.join("ready"), b"ready")
                .map_err(|_| ErrorCode::Download)?;
            let deadline = Instant::now() + Duration::from_secs(20);
            while config.hold && !config.control.join("release").exists() {
                if config.control.join("cancel").exists() {
                    requested.store(true, Ordering::Release);
                }
                if cancel.load(Ordering::Acquire) {
                    return Err(ErrorCode::Interrupted);
                }
                if Instant::now() >= deadline {
                    return Err(ErrorCode::Timeout);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            std::fs::copy(&config.archive, destination)
                .map(|_| ())
                .map_err(|_| ErrorCode::Download)
        }),
    };
    let recipe = Recipe {
        setup_id: "codex",
        version: "interop-1",
        entry: "codex",
        binary: "codex".into(),
        url: "https://registry.npmjs.org/interop-fixture.tgz".into(),
        algorithm: Algorithm::Sha512,
        digest: "interop-fixture-digest",
    };
    let commits = AtomicUsize::new(0);
    let result = installer.install(
        &recipe,
        &cancellation,
        &|path, _| {
            if std::fs::read(path).ok().as_deref() == Some(b"fixture binary") {
                Ok(())
            } else {
                Err(ErrorCode::Installation)
            }
        },
        &|| {
            commits.fetch_add(1, Ordering::SeqCst);
        },
    );
    println!(
        "{}",
        json!({"status": result.as_ref().map_or_else(|error| error.key(), |_| "installed"),
        "downloads": downloads.load(Ordering::SeqCst), "commits": commits.load(Ordering::SeqCst)})
    );
}
