use super::{Engine, Failure, detect};
use std::{
    io::{Read, Seek, SeekFrom},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

pub trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}
/// Provider-admitted lazy bytes and a stable-identity check. The engine never
/// receives a platform path and cannot reopen one or discover sibling files.
pub struct Input {
    pub length: u64,
    pub reader: Box<dyn ReadSeek>,
    pub validate: Arc<dyn Fn() -> Result<(), Failure> + Send + Sync>,
}
pub const OPEN_TIMEOUT: Duration = Duration::from_secs(15);
pub const QUERY_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) struct Guard {
    validate: Arc<dyn Fn() -> Result<(), Failure> + Send + Sync>,
    cancel: Arc<AtomicBool>,
    deadline: Mutex<Instant>,
    failure: Mutex<Option<Failure>>,
}
impl Guard {
    pub fn new(input: &Input, cancel: Arc<AtomicBool>) -> Arc<Self> {
        Arc::new(Self {
            validate: input.validate.clone(),
            cancel,
            deadline: Mutex::new(Instant::now() + OPEN_TIMEOUT),
            failure: Mutex::new(None),
        })
    }
    pub fn begin(&self, timeout: Duration) -> Result<(), Failure> {
        *self.deadline.lock().map_err(|_| Failure::Unavailable)? = Instant::now() + timeout;
        self.check()
    }
    pub fn check(&self) -> Result<(), Failure> {
        if let Some(failure) = *self.failure.lock().map_err(|_| Failure::Unavailable)? {
            return Err(failure);
        }
        let result = if self.cancel.load(Ordering::Acquire) {
            Err(Failure::Unavailable)
        } else if Instant::now() >= *self.deadline.lock().map_err(|_| Failure::Unavailable)? {
            Err(Failure::Budget)
        } else {
            (self.validate)()
        };
        if let Err(failure) = result {
            self.record(failure);
        }
        result
    }
    pub fn record(&self, failure: Failure) {
        if let Ok(mut current) = self.failure.lock() {
            current.get_or_insert(failure);
        }
    }
    pub fn error(&self, fallback: Failure) -> Failure {
        self.check().err().unwrap_or(fallback)
    }
}

pub(super) fn admit(input: &mut Input, max: u64, guard: &Guard) -> Result<(), Failure> {
    guard.check()?;
    if input.length > max {
        return Err(Failure::Budget);
    }
    let mut header = [0; 100];
    let wanted = input.length.min(header.len() as u64) as usize;
    if input
        .reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| guard.error(Failure::Unavailable))?
        != 0
    {
        return Err(Failure::Unavailable);
    }
    input
        .reader
        .read_exact(&mut header[..wanted])
        .map_err(|_| guard.error(Failure::Unavailable))?;
    guard.check()?;
    match detect(&header[..wanted]) {
        Some(Engine::Sqlite { wal: true }) => Err(Failure::Recovery),
        Some(Engine::Sqlite { wal: false }) => Ok(()),
        None => Err(Failure::Unsupported),
    }
}

#[cfg(test)]
pub(super) fn file(path: &std::path::Path) -> Result<Input, Failure> {
    use std::fs;
    let path = path.to_owned();
    let meta = fs::symlink_metadata(&path).map_err(|_| Failure::Unavailable)?;
    if !meta.is_file() {
        return Err(Failure::Permission);
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(&path).map_err(|_| Failure::Unavailable)?;
    let before = file.metadata().map_err(|_| Failure::Unavailable)?;
    let length = before.len();
    let held = file.try_clone().map_err(|_| Failure::Unavailable)?;
    let same = move |now: &fs::Metadata| {
        let equal = now.is_file()
            && now.len() == before.len()
            && now.modified().ok() == before.modified().ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            equal
                && (now.dev(), now.ino(), now.ctime(), now.ctime_nsec())
                    == (
                        before.dev(),
                        before.ino(),
                        before.ctime(),
                        before.ctime_nsec(),
                    )
        }
        #[cfg(not(unix))]
        {
            equal
        }
    };
    Ok(Input {
        length,
        reader: Box::new(file),
        validate: Arc::new(move || {
            if !same(&fs::symlink_metadata(&path).map_err(|_| Failure::Expired)?)
                || !same(&held.metadata().map_err(|_| Failure::Expired)?)
            {
                return Err(Failure::Expired);
            }
            for suffix in ["-wal", "-shm", "-journal"] {
                match fs::symlink_metadata(super::sidecar(&path, suffix)) {
                    Ok(_) => return Err(Failure::Recovery),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err(Failure::Permission),
                }
            }
            Ok(())
        }),
    })
}
