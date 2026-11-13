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

/// Where device keys live on this computer; none where it has no keychain.
pub fn keys() -> Keys {
    #[cfg(target_os = "macos")]
    {
        Arc::new(|| Box::new(super::identity::Keychain) as Box<dyn KeyStore>)
    }
    #[cfg(not(target_os = "macos"))]
    {
        struct Unavailable;
        impl KeyStore for Unavailable {
            fn put(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("Device key storage is unavailable.".into())
            }
            fn get(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(None)
            }
            fn delete(&self, _: &str) -> Result<(), String> {
                Ok(())
            }
        }
        Arc::new(|| Box::new(Unavailable) as Box<dyn KeyStore>)
    }
}

/// Runs the host for the App whose data is at `app_data` until it is asked
/// to shut down; a second host for the same state leaves at once, and so
/// does any host while the release gate is closed (a login entry an earlier
/// build wrote keeps starting it).
pub fn run(app_data: &Path, app_version: &str) -> i32 {
    if !super::AVAILABLE {
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
                    eprintln!("PuppyOne Host failed to start: {error}");
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
            entry: cfg!(target_os = "macos").then(|| {
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
}
