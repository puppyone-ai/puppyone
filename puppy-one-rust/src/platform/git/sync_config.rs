//! Git owns synchronization policy. An empty setting is still configured, and
//! a failed configuration read never authorizes a fallback destination.
use super::{AtomicBool, Path, git_read, push_remote};

struct Config(Vec<(String, String)>);
impl Config {
    fn load(root: &Path, cancel: &AtomicBool) -> Result<Self, String> {
        // One successful, NUL-framed snapshot preserves empty values, repeated
        // keys and Git's include/precedence rules. Unlike optional text reads,
        // neither exit errors nor cancellation can be confused with absence.
        let bytes = git_read(root, &["config", "--null", "--list"], None, cancel)?;
        Ok(Self::parse(&bytes))
    }
    fn parse(bytes: &[u8]) -> Self {
        Self(
            bytes
                .split(|b| *b == 0)
                .filter(|r| !r.is_empty())
                .map(|record| {
                    let separator = record.iter().position(|b| *b == b'\n');
                    let (key, value) =
                        separator.map_or((record, &b""[..]), |i| (&record[..i], &record[i + 1..]));
                    (
                        String::from_utf8_lossy(key).into_owned(),
                        String::from_utf8_lossy(value).trim().to_owned(),
                    )
                })
                .collect(),
        )
    }
    fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    fn all(&self, key: &str) -> Option<String> {
        let values: Vec<_> = self
            .0
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .collect();
        (!values.is_empty()).then(|| values.join("\n"))
    }
    fn pull_policy(&self, branch: &str) -> Vec<String> {
        let mut args = vec![];
        if [
            format!("branch.{branch}.rebase"),
            "pull.rebase".into(),
            "pull.ff".into(),
        ]
        .iter()
        .all(|key| self.get(key).is_none())
        {
            args.push("--rebase".into());
        }
        // Git emits section/variable names in lowercase; subsection (branch)
        // names retain their case. Explicit false/empty values suppress defaults.
        if ["rebase.autostash", "merge.autostash", "pull.autostash"]
            .iter()
            .all(|key| self.get(key).is_none())
        {
            args.push("--autostash".into());
        }
        args
    }
}

pub(super) struct Binding {
    pub branch: String,
    pub remote: Option<String>,
    pub destination: Option<String>,
    pub push_remote: Option<String>,
}
pub(super) fn binding(root: &Path, cancel: &AtomicBool) -> Result<Binding, String> {
    let config = Config::load(root, cancel)?;
    read_binding(root, &config, cancel)
}
fn read_binding(root: &Path, config: &Config, cancel: &AtomicBool) -> Result<Binding, String> {
    let branch = String::from_utf8_lossy(&git_read(
        root,
        &["branch", "--show-current"],
        None,
        cancel,
    )?)
    .trim()
    .to_owned();
    if branch.is_empty() {
        return Err("Unable to synchronize changes: current workspace is not on a branch.".into());
    }
    let remote = config.get(&format!("branch.{branch}.remote"));
    let merge = config.all(&format!("branch.{branch}.merge"));
    if (remote.is_some() || merge.is_some())
        && (remote.is_none_or(str::is_empty)
            || !merge
                .as_deref()
                .is_some_and(|m| m.starts_with("refs/heads/") && !m.contains('\n')))
    {
        return Err("Unable to synchronize changes: current branch upstream is incomplete or is not a remote branch.".into());
    }
    let push_remote = config
        .get(&format!("branch.{branch}.pushremote"))
        .or_else(|| config.get("remote.pushdefault"));
    if push_remote == Some("") {
        return Err("Unable to synchronize changes: configured push remote is empty.".into());
    }
    Ok(Binding {
        branch,
        remote: remote.map(str::to_owned),
        destination: merge.map(|m| m["refs/heads/".len()..].to_owned()),
        push_remote: push_remote.map(str::to_owned),
    })
}

pub(super) fn pull_args(root: &Path, cancel: &AtomicBool) -> Result<Vec<String>, String> {
    let config = Config::load(root, cancel)?;
    let binding = read_binding(root, &config, cancel)?;
    // The pull destination is the upstream, never a triangular push preference.
    let remote = push_remote(root, binding.remote.as_deref(), cancel)?;
    let mut args = vec!["pull".into()];
    args.extend(config.pull_policy(&binding.branch));
    args.push(remote);
    args.push(binding.destination.unwrap_or(binding.branch));
    Ok(args)
}

#[cfg(test)]
#[path = "sync_config_tests.rs"]
mod tests;
