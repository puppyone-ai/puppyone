//! PuppyOne Host as its own process (`electron-main.mjs`, `launcher.mjs`,
//! `autostart.mjs`): the same program started with `--puppyone-host`, with
//! no windows, keeping its state beside the App's, never inside it. It keeps
//! sharing after the App quits; the person may start it at login.
use super::{
    control,
    exec::Mechanism,
    identity::KeyStore,
    service::{HostService, Keys},
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// The argument that starts this program as the host instead of the App.
pub const HOST_ARGUMENT: &str = "--puppyone-host";
/// The login entry's label (a per-user LaunchAgent).
pub const LAUNCH_AGENT_LABEL: &str = "ai.puppyone.gpui.host";

/// `hostServiceStateDir`: the host's own state, beside the App's.
pub fn state_dir(app_data: &Path) -> PathBuf {
    app_data.join("host-service")
}

/// Where device keys live on this computer.
pub fn keys() -> Keys {
    Arc::new(|| Box::new(super::identity::Keychain) as Box<dyn KeyStore>)
}

/// Runs the host for the App whose data is at `app_data` until it is asked
/// to shut down; a second host for the same state leaves at once, and so
/// does any host while the release gate is closed (a login entry an earlier
/// build wrote keeps starting it).
pub fn run(app_data: &Path, app_version: &str) -> i32 {
    run_gated(app_data, app_version, super::AVAILABLE)
}
fn run_gated(app_data: &Path, app_version: &str, available: bool) -> i32 {
    if !available {
        return 0;
    }
    let dir = state_dir(app_data);
    let runtime = super::remote::runtime();
    runtime.block_on(async move {
        let probe = control::connect(
            &dir,
            "client",
            Arc::new(|_, _| Box::pin(async { Err("no".into()) })),
            Arc::new(|_, _| {}),
            || {},
        )
        .await;
        if probe.is_ok() {
            return 0;
        }
        let host = HostService::new(
            dir.clone(),
            vec![app_data.to_path_buf()],
            app_version,
            None,
            keys(),
            Mechanism::detect(),
        );
        let starting = host.clone();
        let _ = tokio::task::spawn_blocking(move || starting.start()).await;
        let (stop, mut stopped) = tokio::sync::mpsc::unbounded_channel();
        let serving = tokio::spawn(control::serve(dir.clone(), host.clone(), stop));
        tokio::select! {
            _ = stopped.recv() => {}
            served = serving => {
                if let Ok(Err(error)) = served {
                    po_platform::diagnosticln!("PuppyOne Host failed to start: {error}");
                    return 1;
                }
            }
        }
        host.dispose();
        let (socket, token) = control::paths(&dir);
        let _ = std::fs::remove_file(socket);
        let _ = std::fs::remove_file(token);
        0
    })
}

/// `launchAgentPlist`: run this program as the host at login.
pub fn launch_agent(program: &Path) -> String {
    let xml = |value: &str| {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
    <string>{HOST_ARGUMENT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
"#,
        xml(&program.to_string_lossy())
    )
}
/// The login entry of this installation.
pub struct Autostart {
    pub entry: Option<PathBuf>,
    pub contents: String,
}
impl Autostart {
    pub fn new(home: &Path, program: &Path) -> Self {
        Self {
            entry: crate::platform::os::Os::current().is_macos().then(|| {
                home.join("Library/LaunchAgents")
                    .join(format!("{LAUNCH_AGENT_LABEL}.plist"))
            }),
            contents: launch_agent(program),
        }
    }
    pub fn supported(&self) -> bool {
        self.entry.is_some()
    }
    /// On only when the entry is this installation's, unchanged.
    pub fn enabled(&self) -> bool {
        self.entry
            .as_ref()
            .and_then(|e| std::fs::read_to_string(e).ok())
            .is_some_and(|text| text == self.contents)
    }
    /// Turning it off only removes the login entry; a running host keeps
    /// sharing until it is stopped from the App.
    pub fn set(&self, on: bool) -> bool {
        let Some(entry) = &self.entry else {
            return false;
        };
        if on {
            if let Some(dir) = entry.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(entry, &self.contents);
        } else {
            let _ = std::fs::remove_file(entry);
        }
        self.enabled()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_login_entry_runs_this_program_as_the_host() {
        let temp = tempfile::tempdir().unwrap();
        let start = Autostart::new(temp.path(), Path::new("/Applications/Puppy <One>.app/x"));
        let plist = &start.contents;
        assert!(plist.contains("<string>--puppyone-host</string>"));
        assert!(plist.contains("Puppy &lt;One&gt;"));
        if start.supported() {
            assert!(!start.enabled());
            assert!(start.set(true));
            assert!(start.enabled());
            assert!(!start.set(false));
        }
        assert_eq!(state_dir(Path::new("/d")), Path::new("/d/host-service"));
    }

    /// Outside the rollout a login entry an earlier build wrote starts
    /// nothing; inside it, a second host for the same App leaves the one
    /// already serving alone.
    #[test]
    fn a_host_starts_only_in_the_rollout_and_only_once() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(run_gated(temp.path(), "0.4.0", false), 0);
        assert!(!state_dir(temp.path()).exists());
        let dir = state_dir(temp.path());
        let host = HostService::new(
            dir.clone(),
            vec![],
            "0.4.0",
            None,
            Arc::new(|| {
                Box::new(super::super::identity::MemoryKeys::default())
                    as Box<dyn super::super::identity::KeyStore>
            }),
            None,
        );
        let runtime = super::super::remote::runtime();
        let (stop, _stopped) = tokio::sync::mpsc::unbounded_channel();
        runtime.spawn(control::serve(dir.clone(), host, stop));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !control::paths(&dir).1.exists() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let token = std::fs::read_to_string(control::paths(&dir).1).unwrap();
        assert_eq!(run_gated(temp.path(), "0.4.0", true), 0);
        // The serving host kept its token: nothing replaced it.
        assert_eq!(
            std::fs::read_to_string(control::paths(&dir).1).unwrap(),
            token
        );
    }
}
