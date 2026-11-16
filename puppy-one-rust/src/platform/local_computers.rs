//! Computers on this computer (`electron/main/local-computers`): the
//! registry of workspaces Computer Mode presents as on-device computers, and
//! the Lima instance that gives one a desktop and a screen.
//!
//! A computer is a workspace folder first: its files open in the editor like
//! any project's. Its desktop is an isolated Linux instance (`limactl`, VZ on
//! macOS) that mounts the folder at `/workspace` and serves a display over
//! VNC on a loopback port; without Lima the computer is a managed workspace
//! with a screen preview. The registry lives in `<data>/local-computers/`,
//! never inside the workspace, and a running instance is stopped when
//! Computer Mode is turned off or the app quits.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::{Duration, SystemTime},
};

/// `LocalComputerStatus`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Running,
    #[default]
    Asleep,
    Provisioning,
    Stopped,
    Error,
}

/// `LocalComputerEngine`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Lima,
    #[default]
    Managed,
}

/// `LocalComputerRecord`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub name: String,
    pub workspace_path: String,
    pub instance_name: String,
    pub engine: Engine,
    pub status: Status,
    pub desktop_ready: bool,
    pub vnc_port: Option<u16>,
    pub status_detail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Record {
    /// Asleep or stopped: nothing runs, its files stay readable.
    pub fn asleep(&self) -> bool {
        matches!(self.status, Status::Asleep | Status::Stopped)
    }
}

/// `LocalComputerRuntimeInfo`: whether this computer can give a computer a
/// desktop (`limactl` found) or only manages its workspace.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Runtime {
    pub limactl: Option<PathBuf>,
}
impl Runtime {
    pub fn available(&self) -> bool {
        self.limactl.is_some()
    }
    pub fn engine(&self) -> Engine {
        if self.available() {
            Engine::Lima
        } else {
            Engine::Managed
        }
    }
    /// `detectLimactlPath`: Homebrew's places, then `PATH`.
    pub fn detect() -> Self {
        let candidates = ["/opt/homebrew/bin/limactl", "/usr/local/bin/limactl"]
            .into_iter()
            .map(PathBuf::from);
        let on_path = std::env::var_os("PATH")
            .map(|paths| {
                std::env::split_paths(&paths)
                    .map(|dir| dir.join("limactl"))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Self {
            limactl: candidates.chain(on_path).find(|path| path.is_file()),
        }
    }
}

/// Where the registry lives.
pub fn directory() -> PathBuf {
    super::data_dir().join("local-computers")
}

/// `normalizeComputerWorkspacePath`: one path, without trailing separators.
pub fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.len() <= 1 {
        return trimmed.to_owned();
    }
    trimmed.trim_end_matches(['/', '\\']).to_owned()
}

/// `local-computer-store`: `registry.v1.json`, written whole and atomically.
#[derive(Debug)]
pub struct Registry {
    path: PathBuf,
    computers: Vec<Record>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRegistry {
    version: u32,
    #[serde(default)]
    computers: Vec<serde_json::Value>,
}

const VERSION: u32 = 1;

impl Registry {
    /// The registry in `dir`, empty when it is missing or unreadable.
    pub fn open(dir: &Path) -> Self {
        let path = dir.join("registry.v1.json");
        let computers = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoredRegistry>(&bytes).ok())
            .map(|stored| normalize(stored.computers))
            .unwrap_or_default();
        Self { path, computers }
    }

    pub fn computers(&self) -> &[Record] {
        &self.computers
    }

    pub fn get(&self, id: &str) -> Option<&Record> {
        self.computers.iter().find(|c| c.id == id)
    }

    /// `findLocalComputerForPath`.
    pub fn for_path(&self, path: &str) -> Option<&Record> {
        let target = normalize_path(path);
        if target.is_empty() {
            return None;
        }
        self.computers
            .iter()
            .find(|c| normalize_path(&c.workspace_path) == target)
    }

    /// `register`: the computer of `workspace` (canonical), created or named
    /// again; it starts running or asleep.
    pub fn register(
        &mut self,
        workspace: &Path,
        name: Option<&str>,
        engine: Engine,
        start_now: bool,
    ) -> std::io::Result<Record> {
        let workspace_path = normalize_path(&workspace.to_string_lossy());
        let now = timestamp(SystemTime::now());
        let existing = self.for_path(&workspace_path).cloned();
        let id = existing
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let name = name
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_owned)
            .or_else(|| existing.as_ref().map(|c| c.name.clone()))
            .unwrap_or_else(|| base_name(&workspace_path, &id));
        let record = Record {
            instance_name: existing
                .as_ref()
                .map(|c| c.instance_name.clone())
                .unwrap_or_else(|| instance_name(&id)),
            engine: existing.as_ref().map_or(engine, |c| c.engine),
            status: if start_now {
                Status::Running
            } else {
                Status::Asleep
            },
            desktop_ready: existing.as_ref().is_some_and(|c| c.desktop_ready),
            vnc_port: existing.as_ref().and_then(|c| c.vnc_port),
            status_detail: None,
            created_at: existing
                .as_ref()
                .map_or_else(|| now.clone(), |c| c.created_at.clone()),
            updated_at: now,
            id,
            name,
            workspace_path,
        };
        match self.computers.iter_mut().find(|c| c.id == record.id) {
            Some(slot) => *slot = record.clone(),
            None => self.computers.push(record.clone()),
        }
        self.save()?;
        Ok(record)
    }

    /// Changes the computer `id`, stamps it, and saves.
    pub fn update(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut Record),
    ) -> std::io::Result<Option<Record>> {
        let Some(record) = self.computers.iter_mut().find(|c| c.id == id) else {
            return Ok(None);
        };
        change(record);
        record.updated_at = timestamp(SystemTime::now());
        let record = record.clone();
        self.save()?;
        Ok(Some(record))
    }

    pub fn remove(&mut self, id: &str) -> std::io::Result<Option<Record>> {
        let Some(index) = self.computers.iter().position(|c| c.id == id) else {
            return Ok(None);
        };
        let record = self.computers.remove(index);
        self.save()?;
        Ok(Some(record))
    }

    fn save(&self) -> std::io::Result<()> {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir)?;
        let body = serde_json::to_vec_pretty(&serde_json::json!({
            "version": VERSION,
            "computers": self.computers,
        }))?;
        let mut file = tempfile::NamedTempFile::new_in(dir)?;
        std::io::Write::write_all(&mut file, &body)?;
        std::io::Write::write_all(&mut file, b"\n")?;
        file.persist(&self.path).map_err(|e| e.error)?;
        Ok(())
    }
}

/// `normalizeRecord` over a stored list: unreadable entries go, one computer
/// per workspace, and a desktop that was still starting when the app last
/// ran is asleep (its start ended with that run).
fn normalize(entries: Vec<serde_json::Value>) -> Vec<Record> {
    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter_map(|entry| {
            let field = |key: &str| {
                entry
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
            };
            let id = field("id")?;
            let workspace_path = field("workspacePath")?;
            let status = entry
                .get("status")
                .and_then(|s| serde_json::from_value::<Status>(s.clone()).ok())
                .unwrap_or_default();
            let now = timestamp(SystemTime::now());
            Some(Record {
                name: field("name").unwrap_or_else(|| base_name(&workspace_path, &id)),
                instance_name: field("instanceName")
                    .unwrap_or_else(|| format!("p1-{}", id.chars().take(12).collect::<String>())),
                engine: entry
                    .get("engine")
                    .and_then(|e| serde_json::from_value(e.clone()).ok())
                    .unwrap_or_default(),
                status: if status == Status::Provisioning {
                    Status::Asleep
                } else {
                    status
                },
                desktop_ready: entry.get("desktopReady") == Some(&serde_json::Value::Bool(true)),
                vnc_port: entry
                    .get("vncPort")
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|p| u16::try_from(p).ok())
                    .filter(|p| *p > 0),
                status_detail: field("statusDetail"),
                created_at: field("createdAt").unwrap_or_else(|| now.clone()),
                updated_at: field("updatedAt").unwrap_or(now),
                id,
                workspace_path,
            })
        })
        .filter(|record| seen.insert(record.workspace_path.clone()))
        .collect()
}

fn base_name(workspace_path: &str, id: &str) -> String {
    Path::new(workspace_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| id.to_owned())
}

/// `p1-` and the id's first ten hex digits.
fn instance_name(id: &str) -> String {
    format!(
        "p1-{}",
        id.chars()
            .filter(|c| *c != '-')
            .take(10)
            .collect::<String>()
    )
}

fn timestamp(at: SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(at).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// `buildLimaConfigYaml`: two CPUs, 2 GiB, the workspace writable at
/// `/workspace`, and a desktop (Xvfb, fluxbox, x11vnc on `:5900`) forwarded
/// to `vnc_port` on loopback. VZ and VirtioFS on macOS, QEMU elsewhere.
pub fn lima_config(workspace: &Path, vnc_port: u16) -> String {
    let vz = cfg!(target_os = "macos");
    let location = serde_json::to_string(&workspace.to_string_lossy()).unwrap_or_default();
    [
        if vz { r#"vmType: "vz""# } else { r#"vmType: "qemu""# },
        if vz {
            r#"mountType: "virtiofs""#
        } else {
            r#"mountType: "reverse-sshfs""#
        },
        "cpus: 2",
        r#"memory: "2GiB""#,
        r#"disk: "16GiB""#,
        "mounts:",
        &format!("  - location: {location}"),
        r#"    mountPoint: "/workspace""#,
        "    writable: true",
        "portForwards:",
        "  - guestPort: 5900",
        &format!("    hostPort: {vnc_port}"),
        r#"    hostIP: "127.0.0.1""#,
        "provision:",
        "  - mode: system",
        "    script: |",
        "      #!/bin/bash",
        "      set -eux -o pipefail",
        "      export DEBIAN_FRONTEND=noninteractive",
        "      if ! command -v x11vnc >/dev/null 2>&1; then",
        "        apt-get update && apt-get install -y xvfb fluxbox x11vnc xterm",
        "      fi",
        "      cat >/etc/systemd/system/p1-desktop.service <<'EOF'",
        "      [Unit]",
        "      Description=PuppyOne Computer Desktop",
        "      After=network.target",
        "      [Service]",
        "      Type=simple",
        "      ExecStart=/bin/bash -lc 'Xvfb :99 -screen 0 1280x800x24 & sleep 1; DISPLAY=:99 fluxbox & exec x11vnc -display :99 -forever -shared -nopw -rfbport 5900'",
        "      Restart=always",
        "      [Install]",
        "      WantedBy=multi-user.target",
        "      EOF",
        "      systemctl daemon-reload && systemctl enable --now p1-desktop.service",
        "",
    ]
    .join("\n")
}

/// A free loopback port for a computer's screen.
pub fn free_port() -> std::io::Result<u16> {
    Ok(std::net::TcpListener::bind(("127.0.0.1", 0))?
        .local_addr()?
        .port())
}

/// How `limactl` runs (`execFileAsync`): replaced in tests.
pub trait Limactl: Send + Sync {
    fn run(&self, args: &[&str], timeout: Duration) -> Result<(), String>;
}

/// `limactl` at its path, bounded by `timeout`.
pub struct LimactlAt(pub PathBuf);
impl Limactl for LimactlAt {
    fn run(&self, args: &[&str], timeout: Duration) -> Result<(), String> {
        let cancel = AtomicBool::new(false);
        super::process::run(&self.0, args, &std::env::temp_dir(), None, timeout, &cancel)
            .map(|_| ())
    }
}

/// `runDesktopProvisioning`: writes the instance's config (its screen on
/// `vnc_port`) and starts it, which first provisions the desktop; up to ten
/// minutes.
pub fn provision(
    limactl: &dyn Limactl,
    record: &Record,
    vnc_port: u16,
    dir: &Path,
) -> Result<(), String> {
    let config_dir = dir.join("instances").join(&record.id);
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config = config_dir.join("lima.yaml");
    std::fs::write(
        &config,
        lima_config(Path::new(&record.workspace_path), vnc_port),
    )
    .map_err(|e| e.to_string())?;
    let name = format!("--name={}", record.instance_name);
    let config = config.to_string_lossy().into_owned();
    limactl.run(
        &["start", "--tty=false", &name, &config],
        Duration::from_secs(10 * 60),
    )
}

/// Starts an instance whose desktop is provisioned.
pub fn start(limactl: &dyn Limactl, record: &Record) -> Result<(), String> {
    limactl.run(
        &["start", "--tty=false", &record.instance_name],
        Duration::from_secs(120),
    )
}

/// `stopLimaInstanceIfNeeded`: stops the instance of a Lima computer with a
/// desktop; one already stopped or never made is fine.
pub fn stop(limactl: &dyn Limactl, record: &Record) {
    if record.engine == Engine::Lima && record.desktop_ready {
        let _ = limactl.run(
            &["stop", "-f", &record.instance_name],
            Duration::from_secs(15),
        );
    }
}

/// The detail kept when a desktop cannot start: its first 240 characters.
pub fn failure_detail(error: &str) -> String {
    error.chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorded(Mutex<Vec<Vec<String>>>);
    impl Limactl for Recorded {
        fn run(&self, args: &[&str], _: Duration) -> Result<(), String> {
            self.0
                .lock()
                .unwrap()
                .push(args.iter().map(|a| a.to_string()).collect());
            Ok(())
        }
    }

    #[test]
    fn a_workspace_registers_once_and_survives_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("Field Notes");
        let mut registry = Registry::open(dir.path());
        let first = registry
            .register(&workspace, Some("  Lab  "), Engine::Lima, true)
            .unwrap();
        assert_eq!(first.name, "Lab");
        assert_eq!(first.status, Status::Running);
        assert!(first.instance_name.starts_with("p1-"));
        assert_eq!(first.instance_name.len(), 13);
        // Again, by a path with a trailing separator, asleep: the same computer.
        let again = registry
            .register(
                Path::new(&format!("{}/", workspace.display())),
                None,
                Engine::Managed,
                false,
            )
            .unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(again.name, "Lab");
        assert_eq!(again.engine, Engine::Lima);
        assert_eq!(again.status, Status::Asleep);
        let reopened = Registry::open(dir.path());
        assert_eq!(reopened.computers().len(), 1);
        assert_eq!(
            reopened
                .for_path(&workspace.to_string_lossy())
                .map(|c| c.id.clone()),
            Some(first.id)
        );
    }

    #[test]
    fn a_stored_registry_is_read_forgivingly() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("registry.v1.json"),
            serde_json::json!({"version": 1, "computers": [
                {"id": "a", "workspacePath": "/w/one", "status": "provisioning",
                 "engine": "lima", "desktopReady": true, "vncPort": 5901},
                {"id": "b", "workspacePath": "/w/one", "status": "running"},
                {"id": "c", "workspacePath": "/w/two", "status": "weird", "engine": "x",
                 "vncPort": 70000},
                {"workspacePath": "/w/three"},
                "nonsense"
            ]})
            .to_string(),
        )
        .unwrap();
        let registry = Registry::open(dir.path());
        let computers = registry.computers();
        assert_eq!(computers.len(), 2);
        let one = &computers[0];
        assert_eq!((one.id.as_str(), one.name.as_str()), ("a", "one"));
        // A start that outlived its run is over.
        assert_eq!(one.status, Status::Asleep);
        assert!(one.desktop_ready);
        assert_eq!(one.vnc_port, Some(5901));
        let two = &computers[1];
        assert_eq!(
            (two.status, two.engine, two.vnc_port),
            (Status::Asleep, Engine::Managed, None)
        );
        assert_eq!(two.instance_name, "p1-c");
        assert!(
            Registry::open(&dir.path().join("missing"))
                .computers()
                .is_empty()
        );
    }

    #[test]
    fn the_desktop_config_mounts_the_workspace_and_forwards_its_screen() {
        let config = lima_config(Path::new("/Users/me/My \"Notes\""), 50123);
        assert!(config.contains(r#"  - location: "/Users/me/My \"Notes\"""#));
        assert!(config.contains(r#"    mountPoint: "/workspace""#));
        assert!(config.contains("    hostPort: 50123"));
        assert!(config.contains(r#"    hostIP: "127.0.0.1""#));
        assert!(config.contains("x11vnc -display :99"));
        if cfg!(target_os = "macos") {
            assert!(config.starts_with("vmType: \"vz\"\nmountType: \"virtiofs\""));
        }
    }

    #[test]
    fn limactl_starts_provisions_and_stops_only_a_desktop() {
        let dir = tempfile::tempdir().unwrap();
        let limactl = Recorded::default();
        let mut registry = Registry::open(dir.path());
        let record = registry
            .register(&dir.path().join("w"), None, Engine::Lima, true)
            .unwrap();
        // No desktop yet: nothing to stop.
        stop(&limactl, &record);
        assert!(limactl.0.lock().unwrap().is_empty());
        provision(&limactl, &record, 50200, dir.path()).unwrap();
        let config = dir
            .path()
            .join("instances")
            .join(&record.id)
            .join("lima.yaml");
        assert!(
            std::fs::read_to_string(&config)
                .unwrap()
                .contains("hostPort: 50200")
        );
        let ready = registry
            .update(&record.id, |r| r.desktop_ready = true)
            .unwrap()
            .unwrap();
        start(&limactl, &ready).unwrap();
        stop(&limactl, &ready);
        let calls = limactl.0.lock().unwrap().clone();
        let name = &record.instance_name;
        assert_eq!(
            calls,
            [
                vec![
                    "start".to_owned(),
                    "--tty=false".into(),
                    format!("--name={name}"),
                    config.to_string_lossy().into_owned()
                ],
                vec!["start".into(), "--tty=false".into(), name.clone()],
                vec!["stop".into(), "-f".into(), name.clone()],
            ]
        );
        assert_eq!(
            registry.remove(&record.id).unwrap().map(|r| r.id),
            Some(record.id)
        );
        assert!(Registry::open(dir.path()).computers().is_empty());
    }

    #[test]
    fn paths_compare_without_their_trailing_separator() {
        assert_eq!(normalize_path(" /a/b/ "), "/a/b");
        assert_eq!(normalize_path("/"), "/");
        assert_eq!(normalize_path(""), "");
        assert_eq!(failure_detail(&"x".repeat(300)).len(), 240);
    }
}
