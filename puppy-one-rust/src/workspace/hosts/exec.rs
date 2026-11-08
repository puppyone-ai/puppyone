//! Running in a shared folder for the owner's other computers
//! (`host-exec-service.mjs`, `sandbox.mjs`): terminals, Agents and single
//! commands, each inside an operating-system sandbox for the folder.
//!
//! Writes are confined to the folder, temporary directories, tool caches
//! and the Agent's own state; credentials (SSH and GPG keys, the keychain,
//! cloud CLI credentials, browser data, this app's data) can be neither read
//! nor written. System directories and tool chains stay readable, and every
//! child inherits the sandbox (Git hooks and package scripts included).
//! macOS uses Seatbelt (`sandbox-exec`), Linux bubblewrap; where neither is
//! available nothing runs — there is no unsandboxed tier.
use super::files::Folders;
use russh::{Channel, ChannelMsg, server::Msg};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::{mpsc, watch};

/// What a client asked to run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Run {
    /// The person's own shell, with a pty.
    Shell,
    /// `puppyone-agent <launcher>`, with a pty.
    Agent(String),
    /// One command for `/bin/sh -c`, binary safe, without a pty.
    Command(String),
}
/// The terminal a client asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pty {
    pub term: String,
    pub cols: u16,
    pub rows: u16,
}
/// A program ready to start: already wrapped in the sandbox.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prepared {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}
/// The host's execution service: what `run` in the folder at `root` starts
/// as, or why it cannot.
pub trait Execution: Send + Sync {
    fn prepare(&self, root: &Path, run: &Run) -> Result<Prepared, &'static str>;
}

/// Credentials nothing in the folder tier may read or write, under home.
const PROTECTED_HOME_PATHS: [&str; 27] = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".config/gcloud",
    ".config/gh",
    ".netrc",
    ".git-credentials",
    ".npmrc",
    ".pypirc",
    ".password-store",
    "Library/Keychains",
    "Library/Cookies",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Firefox",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Microsoft Edge",
    "Library/Safari",
    "Library/Mail",
    "Library/Messages",
    ".mozilla",
    ".config/google-chrome",
    ".config/chromium",
    ".config/BraveSoftware",
    ".local/share/keyrings",
];
/// Caches tool chains write to, under home.
const CACHE_HOME_PATHS: [&str; 13] = [
    ".cache",
    "Library/Caches",
    ".npm",
    ".pnpm-store",
    ".yarn",
    ".bun",
    ".cargo/registry",
    ".cargo/git",
    ".gradle/caches",
    ".m2/repository",
    "go/pkg/mod",
    ".local/share/pnpm",
    ".deno",
];
/// State each Agent keeps for its own sessions, under home.
pub fn agent_state_paths(launcher: &str) -> &'static [&'static str] {
    match launcher {
        "claude" => &[".claude", ".claude.json", ".config/claude"],
        "codex" => &[".codex"],
        "cursor" => &[".cursor", ".config/cursor"],
        "opencode" => &[
            ".config/opencode",
            ".local/share/opencode",
            ".local/state/opencode",
        ],
        "pi" => &[".pi"],
        "hermes" => &[".hermes"],
        _ => &[],
    }
}

fn sbpl_string(value: &Path) -> Result<String, &'static str> {
    let text = value.to_string_lossy();
    if text.contains(['\0', '\n', '\r']) {
        return Err("sandbox_unavailable");
    }
    Ok(format!(
        "\"{}\"",
        text.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
fn real_or_self(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

/// `seatbeltProfile`: later rules win, so the protected paths come last.
pub fn seatbelt_profile(
    root: &Path,
    home: &Path,
    app_data: &[PathBuf],
    writable: &[PathBuf],
    temp: &[PathBuf],
) -> Result<String, &'static str> {
    let mut allow: Vec<PathBuf> = vec![real_or_self(root)];
    allow.extend(temp.iter().map(|p| real_or_self(p)));
    allow.extend(writable.iter().map(|p| real_or_self(p)));
    allow.extend(CACHE_HOME_PATHS.iter().map(|p| home.join(p)));
    let protected: Vec<PathBuf> = PROTECTED_HOME_PATHS
        .iter()
        .map(|p| home.join(p))
        .chain(app_data.iter().cloned())
        .map(|p| real_or_self(&p))
        .collect();
    let subpaths = |paths: &[PathBuf]| -> Result<String, &'static str> {
        Ok(paths
            .iter()
            .map(|p| sbpl_string(p).map(|s| format!("  (subpath {s})")))
            .collect::<Result<Vec<_>, _>>()?
            .join("\n"))
    };
    Ok([
        "(version 1)".to_owned(),
        "(allow default)".to_owned(),
        "(deny file-write*)".to_owned(),
        "(allow file-write*".to_owned(),
        subpaths(&allow)?,
        "  (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/dtracehelper\") (literal \"/dev/ptmx\")".to_owned(),
        "  (regex #\"^/dev/tty\") (regex #\"^/dev/fd/\"))".to_owned(),
        "(deny file-read* file-write*".to_owned(),
        subpaths(&protected)?,
        ")".to_owned(),
        // Keychain items are served by securityd, not read from files.
        "(deny mach-lookup (global-name \"com.apple.SecurityServer\"))".to_owned(),
        String::new(),
    ]
    .join("\n"))
}
/// `bubblewrapArgs`: the program and its arguments follow "--".
pub fn bubblewrap_args(
    root: &Path,
    home: &Path,
    app_data: &[PathBuf],
    writable: &[PathBuf],
) -> Vec<String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut args: Vec<String> = [
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--die-with-parent",
        "--bind",
    ]
    .iter()
    .map(|a| (*a).to_owned())
    .collect();
    args.push(s(root));
    args.push(s(root));
    for item in CACHE_HOME_PATHS
        .iter()
        .map(|p| home.join(p))
        .chain(writable.iter().cloned())
    {
        if item.exists() {
            args.extend(["--bind".into(), s(&item), s(&item)]);
        }
    }
    for item in PROTECTED_HOME_PATHS
        .iter()
        .map(|p| home.join(p))
        .chain(app_data.iter().cloned())
    {
        if !item.exists() {
            continue;
        }
        if item.is_dir() {
            args.extend(["--tmpfs".into(), s(&item)]);
        } else {
            args.extend(["--ro-bind".into(), "/dev/null".into(), s(&item)]);
        }
    }
    args.extend(["--chdir".into(), s(root)]);
    args
}

/// The sandbox this computer has for the folder tier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mechanism {
    Seatbelt(PathBuf),
    Bubblewrap(PathBuf),
}
impl Mechanism {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Seatbelt(_) => "seatbelt",
            Self::Bubblewrap(_) => "bubblewrap",
        }
    }
    /// `detectSandbox`: a sandbox that actually runs, or none.
    pub fn detect() -> Option<Self> {
        let works = |program: &Path, args: &[&str]| {
            std::process::Command::new(program)
                .args(args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
        };
        if cfg!(target_os = "macos") {
            let seatbelt = PathBuf::from("/usr/bin/sandbox-exec");
            return (seatbelt.exists()
                && works(
                    &seatbelt,
                    &["-p", "(version 1)(allow default)", "/usr/bin/true"],
                ))
            .then_some(Self::Seatbelt(seatbelt));
        }
        if cfg!(target_os = "linux") {
            let bwrap = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]
                .iter()
                .map(PathBuf::from)
                .find(|p| p.exists())?;
            // Unprivileged user namespaces may be off; then bubblewrap cannot run.
            return works(
                &bwrap,
                &["--ro-bind", "/", "/", "--dev", "/dev", "/bin/true"],
            )
            .then_some(Self::Bubblewrap(bwrap));
        }
        None
    }
}

/// The folder tier: programs wrapped in this computer's sandbox.
pub struct FolderSandbox {
    pub mechanism: Option<Mechanism>,
    pub home: PathBuf,
    /// This app's own data, never readable from the folder.
    pub app_data: Vec<PathBuf>,
    /// Where an Agent's launcher is found (the local terminal's search path).
    pub search_path: String,
    /// Temporary directories, writable from the folder.
    pub temp: Vec<PathBuf>,
}
impl FolderSandbox {
    /// This computer's sandbox for the folder tier, if it has one.
    pub fn detect(home: PathBuf, app_data: Vec<PathBuf>, search_path: String) -> Self {
        Self {
            mechanism: Mechanism::detect(),
            home,
            app_data,
            search_path,
            temp: vec![std::env::temp_dir(), "/private/tmp".into(), "/tmp".into()],
        }
    }
    fn wrap(
        &self,
        program: &Path,
        args: Vec<String>,
        root: &Path,
        writable: &[PathBuf],
    ) -> Result<Prepared, &'static str> {
        let mechanism = self.mechanism.as_ref().ok_or("sandbox_unavailable")?;
        if !root.is_absolute() || !self.home.is_absolute() {
            return Err("sandbox_unavailable");
        }
        let (wrapper, mut wrapped) = match mechanism {
            Mechanism::Seatbelt(path) => (
                path.clone(),
                vec![
                    "-p".to_owned(),
                    seatbelt_profile(root, &self.home, &self.app_data, writable, &self.temp)?,
                ],
            ),
            Mechanism::Bubblewrap(path) => {
                let mut args = bubblewrap_args(root, &self.home, &self.app_data, writable);
                args.push("--".into());
                (path.clone(), args)
            }
        };
        wrapped.push(program.to_string_lossy().into_owned());
        wrapped.extend(args);
        Ok(Prepared {
            program: wrapper,
            args: wrapped,
            env: vec![
                ("PATH".into(), self.search_path.clone()),
                ("HOME".into(), self.home.to_string_lossy().into_owned()),
                // Shell history stays out of the owner's own history file.
                (
                    "HISTFILE".into(),
                    std::env::temp_dir()
                        .join(format!("puppyone-host-{}.history", std::process::id()))
                        .to_string_lossy()
                        .into_owned(),
                ),
            ],
        })
    }
    /// A launcher on the search path, as a local terminal would find it.
    fn find(&self, name: &str) -> Option<PathBuf> {
        std::env::split_paths(&self.search_path)
            .map(|dir| dir.join(name))
            .find(|p| p.is_file())
    }
}
impl Execution for FolderSandbox {
    fn prepare(&self, root: &Path, run: &Run) -> Result<Prepared, &'static str> {
        match run {
            Run::Shell => {
                let shell = std::env::var_os("SHELL")
                    .map(PathBuf::from)
                    .filter(|p| p.is_absolute())
                    .unwrap_or_else(|| "/bin/zsh".into());
                self.wrap(&shell, vec!["-l".into()], root, &[])
            }
            Run::Agent(launcher) => {
                let program = self.find(launcher).ok_or("launcher_unavailable")?;
                let state: Vec<PathBuf> = agent_state_paths(launcher)
                    .iter()
                    .map(|p| self.home.join(p))
                    .collect();
                self.wrap(&program, Vec::new(), root, &state)
            }
            Run::Command(command) => self.wrap(
                Path::new("/bin/sh"),
                vec!["-c".into(), command.clone()],
                root,
                &[],
            ),
        }
    }
}

/// Bridges one session channel to `run` in the folder, until either ends.
#[allow(clippy::too_many_arguments)]
pub async fn bridge(
    execution: Arc<dyn Execution>,
    folders: Arc<dyn Folders>,
    folder: String,
    run: Run,
    pty: Option<Pty>,
    env: Vec<(String, String)>,
    sizes: watch::Receiver<(u16, u16)>,
    channel: Channel<Msg>,
) {
    let (mut read, write) = channel.split();
    let fail = |code: u32, message: &'static str| {
        let write = &write;
        async move {
            let _ = write
                .extended_data_bytes(1, format!("PuppyOne: {message}\r\n").into_bytes())
                .await;
            let _ = write.exit_status(code).await;
            let _ = write.eof().await;
            let _ = write.close().await;
        }
    };
    let Some(grant) = folders.resolve(&folder).filter(|g| g.active) else {
        fail(126, "folder_unavailable").await;
        return;
    };
    let prepared = match execution.prepare(&grant.root, &run) {
        Ok(prepared) => prepared,
        Err(code) => {
            fail(126, code).await;
            return;
        }
    };
    let env: Vec<(String, String)> = prepared.env.iter().cloned().chain(env).collect();
    let (input, inputs) = std::sync::mpsc::channel::<Vec<u8>>();
    let (output, mut outputs) = mpsc::unbounded_channel::<(bool, Vec<u8>)>();
    let (done, mut status) = mpsc::unbounded_channel::<u32>();
    let root = grant.root.clone();
    let spawned = match pty {
        Some(pty) => spawn_pty(prepared, root, env, pty, sizes, inputs, output, done),
        None => spawn_plain(prepared, root, env, inputs, output, done),
    };
    if let Err(code) = spawned {
        fail(127, code).await;
        return;
    }
    let mut stdin_open = true;
    loop {
        tokio::select! {
            message = read.wait(), if stdin_open => match message {
                Some(ChannelMsg::Data { data }) => {
                    let _ = input.send(data.to_vec());
                }
                Some(ChannelMsg::Eof) => {
                    let _ = input.send(Vec::new());
                    stdin_open = false;
                }
                None | Some(ChannelMsg::Close) => {
                    stdin_open = false;
                }
                _ => {}
            },
            chunk = outputs.recv() => match chunk {
                Some((false, bytes)) => {
                    let _ = write.data_bytes(bytes).await;
                }
                Some((true, bytes)) => {
                    let _ = write.extended_data_bytes(1, bytes).await;
                }
                None => {}
            },
            code = status.recv() => {
                while let Ok((stderr, bytes)) = outputs.try_recv() {
                    let _ = if stderr {
                        write.extended_data_bytes(1, bytes).await
                    } else {
                        write.data_bytes(bytes).await
                    };
                }
                let _ = write.exit_status(code.unwrap_or(1)).await;
                let _ = write.eof().await;
                let _ = write.close().await;
                return;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_pty(
    prepared: Prepared,
    root: PathBuf,
    env: Vec<(String, String)>,
    pty: Pty,
    mut sizes: watch::Receiver<(u16, u16)>,
    inputs: std::sync::mpsc::Receiver<Vec<u8>>,
    output: mpsc::UnboundedSender<(bool, Vec<u8>)>,
    done: mpsc::UnboundedSender<u32>,
) -> Result<(), &'static str> {
    use portable_pty::{CommandBuilder, PtySize, native_pty_system};
    let size = |cols: u16, rows: u16| PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size(pty.cols, pty.rows))
        .map_err(|_| "start_failed")?;
    let mut command = CommandBuilder::new(&prepared.program);
    command.args(&prepared.args);
    command.cwd(&root);
    command.env_clear();
    command.env(
        "TERM",
        if pty.term.is_empty() {
            "xterm-256color"
        } else {
            &pty.term
        },
    );
    for (key, value) in &env {
        command.env(key, value);
    }
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|_| "start_failed")?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|_| "start_failed")?;
    let mut writer = pair.master.take_writer().map_err(|_| "start_failed")?;
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 || output.send((false, buffer[..n].to_vec())).is_err() {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        while let Ok(bytes) = inputs.recv() {
            if bytes.is_empty() || writer.write_all(&bytes).is_err() {
                break;
            }
        }
    });
    let master = pair.master;
    tokio::spawn(async move {
        while sizes.changed().await.is_ok() {
            let (cols, rows) = *sizes.borrow();
            let _ = master.resize(size(cols, rows));
        }
    });
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
        let _ = done.send(code);
    });
    Ok(())
}

fn spawn_plain(
    prepared: Prepared,
    root: PathBuf,
    env: Vec<(String, String)>,
    inputs: std::sync::mpsc::Receiver<Vec<u8>>,
    output: mpsc::UnboundedSender<(bool, Vec<u8>)>,
    done: mpsc::UnboundedSender<u32>,
) -> Result<(), &'static str> {
    let mut child = std::process::Command::new(&prepared.program)
        .args(&prepared.args)
        .current_dir(&root)
        .env_clear()
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|_| "start_failed")?;
    let (mut stdin, stdout, stderr) = (
        child.stdin.take().ok_or("start_failed")?,
        child.stdout.take().ok_or("start_failed")?,
        child.stderr.take().ok_or("start_failed")?,
    );
    std::thread::spawn(move || {
        while let Ok(bytes) = inputs.recv() {
            if bytes.is_empty() || stdin.write_all(&bytes).is_err() {
                break;
            }
        }
    });
    let pipe = |mut from: Box<dyn Read + Send>,
                err: bool,
                output: mpsc::UnboundedSender<(bool, Vec<u8>)>| {
        std::thread::spawn(move || {
            let mut buffer = [0u8; 16 * 1024];
            while let Ok(n) = from.read(&mut buffer) {
                if n == 0 || output.send((err, buffer[..n].to_vec())).is_err() {
                    break;
                }
            }
        })
    };
    let out = pipe(Box::new(stdout), false, output.clone());
    let err = pipe(Box::new(stderr), true, output);
    std::thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .and_then(|s| s.code())
            .map_or(1, |c| c as u32);
        let _ = out.join();
        let _ = err.join();
        let _ = done.send(code);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The profile allows writing only the folder, temporaries, caches and
    /// an Agent's own state, and denies the credentials last, so they win.
    #[test]
    fn the_folder_sandbox_writes_only_where_it_may_and_never_reads_credentials() {
        let home = Path::new("/Users/someone");
        let profile = seatbelt_profile(
            Path::new("/work/folder"),
            home,
            &[PathBuf::from(
                "/Users/someone/Library/Application Support/PuppyOne GPUI",
            )],
            &[home.join(".codex")],
            &[PathBuf::from("/tmp")],
        )
        .unwrap();
        let allow = profile.find("(allow file-write*").unwrap();
        let deny = profile.find("(deny file-read* file-write*").unwrap();
        assert!(allow < deny);
        assert!(profile[allow..deny].contains("\"/work/folder\""));
        assert!(profile[allow..deny].contains("\"/Users/someone/.codex\""));
        assert!(profile[deny..].contains("\"/Users/someone/.ssh\""));
        assert!(profile[deny..].contains("PuppyOne GPUI"));
        assert!(profile.contains("com.apple.SecurityServer"));
        assert!(seatbelt_profile(Path::new("/a\nb"), home, &[], &[], &[]).is_err());
        let args = bubblewrap_args(Path::new("/work/folder"), home, &[], &[]);
        assert_eq!(&args[..3], ["--ro-bind", "/", "/"]);
        assert_eq!(args.last().map(String::as_str), Some("/work/folder"));
        // No sandbox: nothing runs.
        let none = FolderSandbox {
            mechanism: None,
            home: home.into(),
            app_data: vec![],
            search_path: String::new(),
            temp: vec![],
        };
        assert_eq!(
            none.prepare(Path::new("/work/folder"), &Run::Shell),
            Err("sandbox_unavailable")
        );
    }

    /// On this computer's own sandbox: a command runs in the folder, and
    /// writing outside it or reading a credential is refused.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_command_in_the_seatbelt_stays_in_its_folder() {
        let Some(mechanism) = Mechanism::detect() else {
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let root = home.join("folder");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::write(home.join(".ssh/id_ed25519"), "secret").unwrap();
        let sandbox = FolderSandbox {
            mechanism: Some(mechanism),
            home: home.clone(),
            app_data: vec![],
            search_path: "/usr/bin:/bin".into(),
            // The test's home lives in the temporary directory itself.
            temp: vec![],
        };
        let run = |command: &str| {
            let prepared = sandbox
                .prepare(&root, &Run::Command(command.into()))
                .unwrap();
            std::process::Command::new(&prepared.program)
                .args(&prepared.args)
                .current_dir(&root)
                .output()
                .unwrap()
        };
        assert!(run("echo inside > note.md").status.success());
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "inside\n"
        );
        assert!(
            !run(&format!("echo outside > {}/escape.md", home.display()))
                .status
                .success()
        );
        assert!(!home.join("escape.md").exists());
        assert!(
            !run(&format!("cat {}/.ssh/id_ed25519", home.display()))
                .status
                .success()
        );
    }
}
