//! `prepared-update.mjs`: an update made ready before it is offered, so
//! restarting to update only swaps two folders.
//!
//! The new app is extracted beside the installed one, on the same volume.
//! It must satisfy the installed app's own designated requirement (its
//! identifier and Developer ID team) and carry the expected version and the
//! GPUI runtime in its `build-info.json`, which keeps a same-team Electron
//! bundle from ever being swapped in. As the app exits it swaps the two
//! bundles with two renames, putting the installed one back if the second
//! fails. A detached script reopens the app once this process has ended, and
//! the next launch removes the replaced bundle. Where that cannot work (an
//! app outside a folder it may write, staging on another volume, or after a
//! swap has failed once) there is no prepared update, and updates are
//! unavailable.
use std::path::{Path, PathBuf};
use std::process::Command;

/// Reopens the app once the process that swapped it in has exited (copied
/// verbatim from the product). Paths come from the environment.
const RELAUNCH_SCRIPT: &str = r#"
waited=0
while /bin/kill -0 "$PUPPYONE_UPDATE_PID" 2>/dev/null; do
  /bin/sleep 0.05
  waited=$((waited + 1))
  if [ "$waited" -eq "$PUPPYONE_UPDATE_GRACE_TICKS" ]; then
    printf '%s %s\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "The app was still exiting; ending it to reopen the update."
    /bin/kill -9 "$PUPPYONE_UPDATE_PID" 2>/dev/null
  fi
  if [ "$waited" -ge $((PUPPYONE_UPDATE_GRACE_TICKS + 40)) ]; then
    printf '%s %s\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "The app did not exit; not reopening it."
    exit 1
  fi
done
"$PUPPYONE_UPDATE_OPEN" "$PUPPYONE_UPDATE_APP"
"#;
/// How long the reopen waits for this process before ending it.
const EXIT_GRACE_MS: u64 = 5000;

struct RelaunchTarget {
    process_id: u32,
    open: &'static str,
    grace_ms: u64,
}

pub struct PreparedUpdate {
    app: PathBuf,
    staging: PathBuf,
    requirement: String,
    prepared: Option<(PathBuf, String)>,
}

fn run(program: &str, args: &[&std::ffi::OsStr]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if output.status.success() {
        Ok(text)
    } else {
        Err(text.trim().lines().last().unwrap_or("failed").to_owned())
    }
}
fn os(value: &str) -> &std::ffi::OsStr {
    std::ffi::OsStr::new(value)
}
fn writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: a NUL-terminated path.
    unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }
}

/// The requirement an app was signed with. An ad hoc signature's is only
/// implied (`# designated => cdhash …`), so such an app is never updated.
fn designated(codesign: &str) -> Option<String> {
    codesign
        .lines()
        .find_map(|line| line.strip_prefix("designated => "))
        .map(|r| r.trim().to_owned())
        .filter(|r| !r.is_empty())
}

impl PreparedUpdate {
    /// `${stagingRoot}.failed` / `.log`: beside the staging folder.
    fn beside(staging: &Path, suffix: &str) -> PathBuf {
        let mut name = staging.as_os_str().to_owned();
        name.push(suffix);
        PathBuf::from(name)
    }
    fn failure_marker(staging: &Path) -> PathBuf {
        Self::beside(staging, ".failed")
    }
    /// `createMacosPreparedUpdate`: the installed app's designated
    /// requirement, once a swap is known to be possible; `Err` says why not.
    pub fn new(app: PathBuf, staging: PathBuf) -> Result<Self, String> {
        use std::os::unix::fs::MetadataExt;
        if app.extension().is_none_or(|e| e != "app") {
            return Err(format!("{} is not an app bundle.", app.display()));
        }
        if let Ok(failure) = std::fs::read_to_string(Self::failure_marker(&staging)) {
            return Err(format!("A swap failed before ({}).", failure.trim()));
        }
        let folder = app.parent().ok_or("The app has no folder.")?;
        if !writable(folder) || !writable(&app) {
            return Err(format!(
                "{} may not be changed by this user.",
                app.display()
            ));
        }
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let same_volume = std::fs::metadata(folder)
            .and_then(|f| std::fs::metadata(&staging).map(|s| f.dev() == s.dev()))
            .unwrap_or(false);
        if !same_volume {
            return Err(format!(
                "{} and {} are on different volumes.",
                folder.display(),
                staging.display()
            ));
        }
        let signature = run("/usr/bin/codesign", &[os("-d"), os("-r-"), app.as_os_str()])?;
        let requirement =
            designated(&signature).ok_or("The installed app has no designated requirement.")?;
        // The app this one replaced, if any.
        let _ = std::fs::remove_dir_all(staging.join("previous"));
        Ok(Self {
            app,
            staging,
            requirement,
            prepared: None,
        })
    }
    /// Extracts and verifies the downloaded app (`archive`, a ditto ZIP);
    /// `Err` when it may not be installed.
    pub fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        self.prepared = None;
        let next = self.staging.join("next");
        let _ = std::fs::remove_dir_all(&self.staging);
        std::fs::create_dir_all(&next).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(self.staging.join("previous")).map_err(|e| e.to_string())?;
        run(
            "/usr/bin/ditto",
            &[os("-x"), os("-k"), archive.as_os_str(), next.as_os_str()],
        )?;
        let bundles: Vec<PathBuf> = std::fs::read_dir(&next)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .collect();
        let [bundle] = bundles.as_slice() else {
            return Err(format!(
                "The update holds {} apps instead of one.",
                bundles.len()
            ));
        };
        // Nothing quarantines what the updater writes; cleared in case.
        let _ = run(
            "/usr/bin/xattr",
            &[
                os("-r"),
                os("-d"),
                os("com.apple.quarantine"),
                bundle.as_os_str(),
            ],
        );
        let requirement = format!("={}", self.requirement);
        run(
            "/usr/bin/codesign",
            &[
                os("--verify"),
                os("--deep"),
                os("--strict"),
                os("-R"),
                os(&requirement),
                bundle.as_os_str(),
            ],
        )
        .map_err(|e| format!("The update is not signed as this app is: {e}"))?;
        let info: serde_json::Value =
            std::fs::read(bundle.join("Contents/Resources/build-info.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .ok_or("The update has no build information.")?;
        if info["runtime"] != "gpui" {
            return Err("The update is not a GPUI build.".into());
        }
        if info["version"] != version {
            return Err(format!(
                "The update holds {} instead of {version}.",
                info["version"]
            ));
        }
        self.prepared = Some((bundle.clone(), version.to_owned()));
        Ok(())
    }
    /// Revokes installation when the service no longer owns this candidate.
    pub fn discard(&mut self) {
        self.prepared = None;
    }

    /// Swaps the prepared app in, as the very last thing before this process
    /// exits, and reopens it once the process has ended when asked. A
    /// failure is remembered, so no later update is offered a swap.
    pub fn install_on_exit(&mut self, relaunch: bool) -> bool {
        self.install(
            relaunch,
            &RelaunchTarget {
                process_id: std::process::id(),
                open: "/usr/bin/open",
                grace_ms: EXIT_GRACE_MS,
            },
        )
        .0
    }

    // The production target is fixed above. Integration tests own a separate
    // app child and use touch to observe the same real relaunch script safely.
    fn install(
        &mut self,
        relaunch: bool,
        target: &RelaunchTarget,
    ) -> (bool, Option<std::process::Child>) {
        let Some((bundle, version)) = self.prepared.take() else {
            return (false, None);
        };
        let previous = self
            .staging
            .join("previous")
            .join(self.app.file_name().unwrap_or_default());
        let swapped = std::fs::rename(&self.app, &previous).and_then(|()| {
            std::fs::rename(&bundle, &self.app).inspect_err(|_| {
                let _ = std::fs::rename(&previous, &self.app);
            })
        });
        let installed = match swapped {
            Ok(()) => true,
            Err(error) => {
                let _ = std::fs::write(
                    Self::failure_marker(&self.staging),
                    format!("{} {version}: {error}\n", chrono::Utc::now().to_rfc3339()),
                );
                false
            }
        };
        let helper = if relaunch {
            let log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(Self::beside(&self.staging, ".log"));
            let mut command = Command::new("/bin/sh");
            command
                .args(["-c", RELAUNCH_SCRIPT])
                .env_clear()
                .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
                .env("PUPPYONE_UPDATE_PID", target.process_id.to_string())
                .env("PUPPYONE_UPDATE_APP", &self.app)
                .env("PUPPYONE_UPDATE_OPEN", target.open)
                .env(
                    "PUPPYONE_UPDATE_GRACE_TICKS",
                    target.grace_ms.div_ceil(50).max(1).to_string(),
                )
                .stdin(std::process::Stdio::null());
            if let Ok(log) = log {
                if let Ok(copy) = log.try_clone() {
                    command.stdout(copy);
                }
                command.stderr(log);
            }
            use std::os::unix::process::CommandExt as _;
            // SAFETY: this post-fork callback only calls the async-signal-safe
            // setsid syscall, with no allocation or shared locks. The helper
            // must survive the old app's process session, like detached spawn.
            unsafe {
                command.pre_exec(|| {
                    if libc::setsid() == -1 {
                        Err(std::io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
            command.spawn().ok()
        } else {
            None
        };
        (installed, helper)
    }
}

#[cfg(test)]
#[path = "prepared_integration_tests.rs"]
mod integration_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// A signed app (ad hoc is enough: its designated requirement is its
    /// own code hash, which the update must then match exactly).
    fn app(dir: &Path, name: &str, version: &str) -> PathBuf {
        let app = dir.join(name);
        let resources = app.join("Contents/Resources");
        std::fs::create_dir_all(&resources).unwrap();
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::copy("/bin/echo", app.join("Contents/MacOS/puppy-one-rust")).unwrap();
        std::fs::write(
            app.join("Contents/Info.plist"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>puppy-one-rust</string>
<key>CFBundleIdentifier</key><string>ai.puppyone.desktop.gpui.test</string>
<key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#
            ),
        )
        .unwrap();
        std::fs::write(
            resources.join("build-info.json"),
            format!(r#"{{"runtime":"gpui","version":"{version}"}}"#),
        )
        .unwrap();
        run(
            "/usr/bin/codesign",
            &[os("--force"), os("--sign"), os("-"), app.as_os_str()],
        )
        .unwrap();
        app
    }
    /// The installed app, prepared against its own (ad hoc) code hash: a
    /// real installation reads a Developer ID requirement instead.
    fn prepared_for(installed: &Path, staging: &Path) -> PreparedUpdate {
        let text = run(
            "/usr/bin/codesign",
            &[os("-d"), os("-r-"), installed.as_os_str()],
        )
        .unwrap();
        assert_eq!(
            designated(&text),
            None,
            "ad hoc requirements are only implied"
        );
        let implied = text
            .lines()
            .find_map(|l| l.strip_prefix("# designated => "))
            .unwrap()
            .to_owned();
        std::fs::create_dir_all(staging).unwrap();
        PreparedUpdate {
            app: installed.to_path_buf(),
            staging: staging.to_path_buf(),
            requirement: implied,
            prepared: None,
        }
    }
    fn zip(app: &Path, to: &Path) {
        run(
            "/usr/bin/ditto",
            &[
                os("-c"),
                os("-k"),
                os("--keepParent"),
                app.as_os_str(),
                to.as_os_str(),
            ],
        )
        .unwrap();
    }

    #[test]
    fn only_an_explicit_requirement_counts() {
        assert_eq!(
            designated(
                "Executable=/x\ndesignated => identifier \"ai.puppyone.desktop.gpui\" and anchor apple generic"
            ),
            Some("identifier \"ai.puppyone.desktop.gpui\" and anchor apple generic".into())
        );
        assert_eq!(designated("# designated => cdhash H\"00\""), None);
    }

    #[test]
    fn an_update_that_is_not_this_app_is_refused_before_the_swap() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let installed = app(&root.join("Applications"), "PuppyOne GPUI.app", "0.4.4");
        let other = app(&root.join("build"), "PuppyOne GPUI.app", "0.4.5");
        let archive = root.join("update.zip");
        zip(&other, &archive);
        assert!(
            PreparedUpdate::new(installed.clone(), root.join("cache/prepared"))
                .err()
                .unwrap()
                .contains("no designated requirement")
        );
        let mut prepared = prepared_for(&installed, &root.join("cache/prepared"));
        // An ad hoc requirement names the installed code hash; any other
        // build fails it, as a build of another team would.
        let error = prepared.prepare(&archive, "0.4.5").unwrap_err();
        assert!(
            error.starts_with("The update is not signed as this app is"),
            "{error}"
        );
        assert!(!prepared.install_on_exit(false), "nothing prepared");
        assert!(installed.join("Contents/Info.plist").is_file());
    }

    #[test]
    fn a_prepared_update_swaps_in_and_a_failed_swap_is_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let installed = app(&root.join("Applications"), "PuppyOne GPUI.app", "0.4.4");
        let staging = root.join("cache/prepared");
        let mut prepared = prepared_for(&installed, &staging);
        // The same code, version 0.4.4 in its build information: the
        // version check refuses a payload that claims another one.
        let archive = root.join("same.zip");
        zip(&installed, &archive);
        assert!(
            prepared
                .prepare(&archive, "0.4.5")
                .unwrap_err()
                .contains("instead of 0.4.5")
        );
        prepared.prepare(&archive, "0.4.4").unwrap();
        assert!(prepared.install_on_exit(false));
        assert!(
            installed
                .join("Contents/Resources/build-info.json")
                .is_file()
        );
        assert!(staging.join("previous/PuppyOne GPUI.app").is_dir());
        // A folder that cannot change makes no prepared update at all.
        let marker = PreparedUpdate::failure_marker(&staging);
        std::fs::write(&marker, "earlier failure").unwrap();
        let refused = PreparedUpdate::new(installed, staging).err().unwrap();
        assert!(refused.starts_with("A swap failed before"), "{refused}");
    }
}
