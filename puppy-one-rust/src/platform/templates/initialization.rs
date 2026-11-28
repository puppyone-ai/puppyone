//! `project-initialization-service.mjs`, with the numbering of
//! `project-entry-service.mjs`: a new project folder is made under an
//! operation id, so a retry tells what became of the first attempt instead
//! of making the project twice.
//!
//! The same operation with the same request gives back the same receipt,
//! whatever happened to the folder's files since — an edited or deleted
//! guide is never written again; with another request it is refused. Before
//! a complete staging folder takes the project's name, the journal records
//! it with the folder's identity (device, inode and birth time, which a
//! rename keeps). A run that lost its acknowledgement is then recovered by
//! identity: a published folder is taken as made, a staged one is
//! published. When neither is found — another folder now has the name — it
//! is refused and nothing is touched.
use super::{Plan, sha256_hex};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

/// How many finished operations this process remembers; the journal keeps
/// every receipt.
const REMEMBERED: usize = 128;
/// `REMEMBERED_NAMES`: the numbered names chosen for recent operations.
const REMEMBERED_NAMES: usize = 64;

/// The app's initializations, journaled in its data directory.
pub fn shared() -> Arc<Initializer> {
    static SHARED: OnceLock<Arc<Initializer>> = OnceLock::new();
    SHARED
        .get_or_init(|| {
            Arc::new(Initializer::new(Some(
                crate::platform::data_dir().join("project-initialization"),
            )))
        })
        .clone()
}

/// What an operation made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub operation_id: String,
    pub path: PathBuf,
    pub name: String,
    pub created_paths: Vec<String>,
    pub initial_open_path: Option<String>,
    /// The template it was made from; a blank folder has none.
    pub template: Option<Template>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Template {
    pub source: String,
    pub digest: String,
}

/// One creation: `name` in `parent`, written from `plan`. `template` names
/// where the plan came from; it is part of the request. `number_if_taken`
/// picks "name 2", "name 3"… when the name is taken, once per operation: a
/// retry lands on the name its first attempt chose, though that attempt's
/// folder now makes the name look taken.
pub struct Request<'a> {
    pub parent: &'a Path,
    pub name: &'a str,
    pub operation_id: &'a str,
    pub plan: &'a Plan,
    pub template: Option<&'a str>,
    pub number_if_taken: bool,
}

/// A directory's identity across a rename; empty where the file system
/// keeps none, and then it matches nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    dev: String,
    ino: String,
    birthtime_ns: String,
}
fn identity(path: &Path) -> Identity {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            let (dev, ino) = crate::platform::fs::path_identity(path).unwrap_or_default();
            let birth = metadata
                .created()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_nanos());
            Identity {
                dev: dev.to_string(),
                ino: ino.to_string(),
                birthtime_ns: birth.to_string(),
            }
        }
        _ => Identity::default(),
    }
}
/// `matchesIdentity`.
fn matches(path: &Path, expected: &Identity) -> bool {
    let known = |value: &str| !value.is_empty() && value != "0";
    known(&expected.ino) && known(&expected.birthtime_ns) && identity(path) == *expected
}

/// One operation's journal entry.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    state: String,
    fingerprint: String,
    receipt: Receipt,
    staging_path: PathBuf,
    identity: Identity,
}

#[derive(Default)]
struct State {
    completed: HashMap<String, (String, Receipt)>,
    completed_order: VecDeque<String>,
    running: HashMap<String, Arc<Mutex<()>>>,
    numbered: HashMap<String, String>,
    numbered_order: VecDeque<String>,
}

/// Project initializations: their journal (one record per operation) and
/// the operations this process has run.
pub struct Initializer {
    journal: Option<PathBuf>,
    state: Mutex<State>,
}

impl Initializer {
    pub fn new(journal: Option<PathBuf>) -> Self {
        Self {
            journal,
            state: Mutex::default(),
        }
    }

    /// `createProject`.
    pub fn create(&self, request: Request) -> Result<Receipt, String> {
        self.create_while(request, || Ok(()))
    }
    /// [`Self::create`], published only if `still_allowed` holds once every
    /// file is written (`validateSource`).
    pub fn create_while(
        &self,
        request: Request,
        still_allowed: impl FnOnce() -> Result<(), String>,
    ) -> Result<Receipt, String> {
        let operation = request.operation_id;
        if !valid_operation(operation) {
            return Err("Invalid initialization operation ID.".into());
        }
        let requested = super::require_project_name(request.name)?;
        // Numbering never reuses a folder: it only picks a name no folder has.
        let name = if request.number_if_taken {
            self.numbered_name(request.parent, requested, operation)?
        } else {
            requested.to_owned()
        };
        let (directories, digest) = super::validate(request.plan)?;
        let fingerprint = sha256_hex(
            serde_json::json!({
                "parentPath": request.parent,
                "name": name,
                "template": request.template,
                "digest": digest,
            })
            .to_string()
            .as_bytes(),
        );
        let receipt = Receipt {
            operation_id: operation.to_owned(),
            path: request.parent.join(&name),
            name,
            created_paths: directories
                .into_iter()
                .chain(request.plan.files.iter().map(|(path, _)| path.clone()))
                .collect(),
            initial_open_path: request.plan.initial_open.clone(),
            template: request.template.map(|source| Template {
                source: source.to_owned(),
                digest,
            }),
        };
        // One run per operation at a time; a retry waits for it.
        let running = self
            .state
            .lock()
            .unwrap()
            .running
            .entry(operation.to_owned())
            .or_default()
            .clone();
        let _running = running.lock().unwrap();
        let known = self.state.lock().unwrap().completed.get(operation).cloned();
        if let Some((known, receipt)) = known {
            return if known == fingerprint {
                Ok(receipt)
            } else {
                Err(different_request())
            };
        }
        let result = self.run(request, &fingerprint, receipt, still_allowed);
        let mut state = self.state.lock().unwrap();
        state.running.remove(operation);
        if let Ok(receipt) = &result {
            state
                .completed
                .insert(operation.to_owned(), (fingerprint, receipt.clone()));
            state.completed_order.push_back(operation.to_owned());
            if state.completed_order.len() > REMEMBERED
                && let Some(oldest) = state.completed_order.pop_front()
            {
                state.completed.remove(&oldest);
            }
        }
        result
    }

    /// `freeProjectName`, once per operation; one the journal knows keeps
    /// the name it was made under.
    fn numbered_name(&self, parent: &Path, name: &str, operation: &str) -> Result<String, String> {
        let mut state = self.state.lock().unwrap();
        if let Some(known) = state.numbered.get(operation) {
            return Ok(known.clone());
        }
        let chosen = match self.read(operation)? {
            Some(record) => record.receipt.name,
            None => super::free_name(parent, name)?,
        };
        state.numbered.insert(operation.to_owned(), chosen.clone());
        state.numbered_order.push_back(operation.to_owned());
        if state.numbered_order.len() > REMEMBERED_NAMES
            && let Some(oldest) = state.numbered_order.pop_front()
        {
            state.numbered.remove(&oldest);
        }
        Ok(chosen)
    }

    fn record_path(&self, operation: &str) -> Option<PathBuf> {
        Some(self.journal.as_ref()?.join(format!("{operation}.json")))
    }
    fn read(&self, operation: &str) -> Result<Option<Record>, String> {
        let Some(path) = self.record_path(operation) else {
            return Ok(None);
        };
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| invalid_journal()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
    /// The record, whole or not at all: a private file renamed over it.
    fn save(&self, record: &Record) -> Result<(), String> {
        let Some(path) = self.record_path(&record.receipt.operation_id) else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
        let saved = (|| -> std::io::Result<()> {
            use std::io::Write as _;
            let mut file = crate::platform::fs::open_private_create_new(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            std::fs::rename(&temporary, &path)
        })();
        let _ = std::fs::remove_file(&temporary);
        saved.map_err(|error| error.to_string())
    }

    fn run(
        &self,
        request: Request,
        fingerprint: &str,
        receipt: Receipt,
        still_allowed: impl FnOnce() -> Result<(), String>,
    ) -> Result<Receipt, String> {
        if let Some(journal) = &self.journal {
            crate::platform::fs::create_private_dir_all(journal)
                .map_err(|error| error.to_string())?;
        }
        if let Some(existing) = self.read(&receipt.operation_id)? {
            return self.recover(existing, fingerprint, receipt);
        }
        let mut publishing = None;
        let made = super::materialize_with(
            request.parent,
            &receipt.name,
            request.plan,
            |staging| {
                still_allowed()?;
                let record = Record {
                    state: "publishing".into(),
                    fingerprint: fingerprint.to_owned(),
                    receipt: receipt.clone(),
                    staging_path: staging.to_path_buf(),
                    identity: identity(staging),
                };
                self.save(&record)?;
                publishing = Some(record);
                Ok(())
            },
            super::publish,
        );
        if let Err(error) = made {
            // Published after all: the receipt and the person's files stay.
            // Otherwise the staging is gone, and its record goes too.
            if !publishing
                .as_ref()
                .is_some_and(|record| matches(&receipt.path, &record.identity))
            {
                if let Some(path) = self.record_path(&receipt.operation_id) {
                    let _ = std::fs::remove_file(path);
                }
                return Err(error);
            }
        }
        // A lost acknowledgement never turns this folder into a second
        // creation: the publishing record recovers it by identity.
        if let Some(mut record) = publishing {
            record.state = "committed".into();
            let _ = self.save(&record);
        }
        Ok(receipt)
    }

    /// A journaled operation: what it made, or what can safely be finished.
    fn recover(
        &self,
        mut existing: Record,
        fingerprint: &str,
        receipt: Receipt,
    ) -> Result<Receipt, String> {
        if existing.fingerprint != fingerprint {
            return Err(different_request());
        }
        let staged_beside = existing.staging_path.parent() == receipt.path.parent()
            && existing
                .staging_path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(".puppyone-template-"));
        if !matches!(existing.state.as_str(), "publishing" | "committed")
            || existing.receipt.operation_id != receipt.operation_id
            || existing.receipt.path != receipt.path
            || !staged_beside
        {
            return Err(invalid_journal());
        }
        if existing.state == "committed" {
            return Ok(receipt);
        }
        if matches(&receipt.path, &existing.identity) {
            existing.state = "committed".into();
            self.save(&existing)?;
            return Ok(receipt);
        }
        if matches(&existing.staging_path, &existing.identity) {
            super::publish(&existing.staging_path, &receipt.path)
                .map_err(|error| error.to_string())?;
            existing.state = "committed".into();
            self.save(&existing)?;
            return Ok(receipt);
        }
        Err("The previous creation could not be safely recovered. Check the project location before starting a new creation.".into())
    }
}

/// An id the renderer mints with `crypto.randomUUID()`.
fn valid_operation(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(at, ch)| match at {
            8 | 13 | 18 | 23 => ch == '-',
            _ => ch.is_ascii_hexdigit(),
        })
}
fn different_request() -> String {
    "This initialization ID belongs to a different request.".into()
}
fn invalid_journal() -> String {
    "Invalid initialization journal. No project files were changed.".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::templates::builtin;

    const SAMPLES: [&str; 4] = [
        "Formats.csv",
        "Getting Started.md",
        "How It Works.html",
        "Workspace Map.excalidraw",
    ];

    struct Fixture {
        _root: tempfile::TempDir,
        parent: PathBuf,
        journal: PathBuf,
        guide: Plan,
    }
    fn fixture() -> Fixture {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().canonicalize().unwrap().join("projects");
        std::fs::create_dir(&parent).unwrap();
        Fixture {
            journal: parent.with_file_name("operations"),
            parent,
            _root: root,
            guide: builtin::getting_started("en", builtin::GETTING_STARTED_VERSION).unwrap(),
        }
    }
    impl Fixture {
        fn request<'a>(&'a self, name: &'a str, operation: &'a str) -> Request<'a> {
            Request {
                parent: &self.parent,
                name,
                operation_id: operation,
                plan: &self.guide,
                template: Some("builtin:puppyone.project.getting-started@2"),
                number_if_taken: false,
            }
        }
        fn restart(&self) -> Initializer {
            Initializer::new(Some(self.journal.clone()))
        }
        fn record(&self, operation: &str) -> serde_json::Value {
            let text = std::fs::read(self.journal.join(format!("{operation}.json"))).unwrap();
            serde_json::from_slice(&text).unwrap()
        }
        fn write_record(&self, operation: &str, record: &serde_json::Value) {
            std::fs::write(
                self.journal.join(format!("{operation}.json")),
                record.to_string(),
            )
            .unwrap();
        }
    }
    fn names(folder: &Path) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
    fn operation() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    /// `coalesces retries and never rewrites an edited or deleted guide,
    /// including after restart`.
    #[test]
    fn a_retry_gets_the_first_receipt_and_never_writes_the_guide_again() {
        let f = fixture();
        let initializer = f.restart();
        let id = operation();
        let (one, two) = std::thread::scope(|scope| {
            let first = scope.spawn(|| initializer.create(f.request("Notes", &id)));
            let second = scope.spawn(|| initializer.create(f.request("Notes", &id)));
            (first.join().unwrap(), second.join().unwrap())
        });
        let one = one.unwrap();
        assert_eq!(two.unwrap(), one);
        assert_eq!(names(&f.parent), ["Notes"]);
        assert_eq!(one.initial_open_path.as_deref(), Some("Getting Started.md"));
        let mut made = one.created_paths.clone();
        made.sort();
        assert_eq!(made, SAMPLES);
        let guide = one.path.join("Getting Started.md");
        std::fs::write(&guide, "my edits").unwrap();
        assert_eq!(initializer.create(f.request("Notes", &id)).unwrap(), one);
        assert_eq!(std::fs::read_to_string(&guide).unwrap(), "my edits");
        std::fs::remove_file(&guide).unwrap();
        assert_eq!(f.restart().create(f.request("Notes", &id)).unwrap(), one);
        assert!(!names(&one.path).contains(&"Getting Started.md".to_owned()));
        assert_eq!(names(&one.path).len(), SAMPLES.len() - 1);
        for refused in [
            initializer.create(f.request("Another", &id)),
            f.restart().create(f.request("Another", &id)),
        ] {
            let refused = refused.unwrap_err();
            assert!(refused.contains("different request"), "{refused}");
        }
        assert!(!f.parent.join("Another").exists());
    }

    /// `recovers a published directory with a lost acknowledgement by
    /// identity`: the record still says publishing, and the folder it
    /// staged is the project now.
    #[test]
    fn a_published_folder_with_a_lost_acknowledgement_is_recovered_by_identity() {
        let f = fixture();
        let id = operation();
        let receipt = f.restart().create(f.request("Notes", &id)).unwrap();
        let mut record = f.record(&id);
        assert_eq!(record["state"], "committed");
        record["state"] = "publishing".into();
        f.write_record(&id, &record);
        assert_eq!(
            f.restart().create(f.request("Notes", &id)).unwrap(),
            receipt
        );
        assert_eq!(names(&f.parent), ["Notes"]);
        assert_eq!(names(&receipt.path), SAMPLES);
        assert_eq!(f.record(&id)["state"], "committed");
    }

    /// `recovers a staged directory with a lost acknowledgement by
    /// identity`: the staging folder was never renamed, so it is published.
    #[test]
    fn a_staged_folder_with_a_lost_acknowledgement_is_published() {
        let f = fixture();
        let id = operation();
        let receipt = f.restart().create(f.request("Notes", &id)).unwrap();
        let mut record = f.record(&id);
        record["state"] = "publishing".into();
        let staging = PathBuf::from(record["stagingPath"].as_str().unwrap());
        std::fs::rename(&receipt.path, &staging).unwrap();
        f.write_record(&id, &record);
        assert_eq!(
            f.restart().create(f.request("Notes", &id)).unwrap(),
            receipt
        );
        assert_eq!(names(&f.parent), ["Notes"]);
        assert_eq!(names(&receipt.path), SAMPLES);
    }

    /// `fails safely on ambiguous recovery without modifying the replacement
    /// directory`: another folder took the name, and the staged one is gone.
    #[test]
    fn an_ambiguous_recovery_is_refused_and_touches_nothing() {
        let f = fixture();
        let id = operation();
        let receipt = f.restart().create(f.request("Notes", &id)).unwrap();
        let mut record = f.record(&id);
        record["state"] = "publishing".into();
        std::fs::rename(&receipt.path, f.parent.join("Moved")).unwrap();
        std::fs::create_dir(&receipt.path).unwrap();
        std::fs::write(receipt.path.join("keep"), "user data").unwrap();
        f.write_record(&id, &record);
        let refused = f.restart().create(f.request("Notes", &id)).unwrap_err();
        assert!(refused.contains("safely recovered"), "{refused}");
        assert_eq!(
            std::fs::read_to_string(receipt.path.join("keep")).unwrap(),
            "user data"
        );
        assert_eq!(names(&receipt.path), ["keep"]);
        assert_eq!(names(&f.parent), ["Moved", "Notes"]);
        // A journal that is not one is refused before anything is written.
        f.write_record(&id, &serde_json::json!("not a record"));
        let refused = f.restart().create(f.request("Notes", &id)).unwrap_err();
        assert!(
            refused.contains("Invalid initialization journal"),
            "{refused}"
        );
        let refused = f
            .restart()
            .create(f.request("Fresh", "not-an-id"))
            .unwrap_err();
        assert!(refused.contains("operation ID"), "{refused}");
        assert!(!f.parent.join("Fresh").exists());
    }

    /// `project-entry-service`: `gives a retry the name its first attempt
    /// chose` — its own folder now makes "CRM" look taken, yet the retry
    /// lands on "CRM", not "CRM 2".
    #[test]
    fn a_numbered_retry_lands_on_the_name_its_first_attempt_chose() {
        let f = fixture();
        let initializer = Initializer::new(None);
        let blank = Plan::default();
        let id = operation();
        let request = || Request {
            parent: &f.parent,
            name: "CRM",
            operation_id: &id,
            plan: &blank,
            template: None,
            number_if_taken: true,
        };
        let first = initializer.create(request()).unwrap();
        assert_eq!(
            (first.name.as_str(), first.template.as_ref()),
            ("CRM", None)
        );
        let retry = initializer.create(request()).unwrap();
        assert_eq!((retry.name, retry.path), (first.name, first.path));
        assert_eq!(names(&f.parent), ["CRM"]);
        // Another operation is numbered past it.
        let other = operation();
        let next = initializer
            .create(Request {
                operation_id: &other,
                ..request()
            })
            .unwrap();
        assert_eq!(next.name, "CRM 2");
    }
}
