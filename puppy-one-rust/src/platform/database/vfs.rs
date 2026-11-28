//! A read-only SQLite VFS over one provider reader. There is no ambient open,
//! sidecar creation, extension loading, mmap or temporary-file fallback.
//! SQLite's C callbacks own only Arc handles; Rust panics cannot cross C.
use super::{
    Failure,
    source::{Guard, Input},
};
use rusqlite::{Connection, OpenFlags, ffi};
use std::{
    collections::HashMap,
    ffi::{CStr, c_char, c_int, c_void},
    io::SeekFrom,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr,
    sync::{Arc, Mutex, OnceLock, Weak},
};
const NAME: &str = "puppyone-provider-readonly";
struct Source {
    input: Mutex<Input>,
    length: u64,
    guard: Arc<Guard>,
}
type Sources = Mutex<HashMap<String, Weak<Source>>>;
fn sources() -> &'static Sources {
    static SOURCES: OnceLock<Sources> = OnceLock::new();
    SOURCES.get_or_init(Mutex::default)
}
/// Dropped after Connection, removing the unguessable reader registration.
pub(super) struct Registration {
    name: String,
    _source: Arc<Source>,
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut entries) = sources().lock() {
            entries.remove(&self.name);
        }
    }
}
#[repr(C)]
struct File {
    base: ffi::sqlite3_file,
    source: *mut Arc<Source>,
}

pub(super) fn open(input: Input, guard: Arc<Guard>) -> Result<(Connection, Registration), Failure> {
    register()?;
    let source = Arc::new(Source {
        length: input.length,
        input: Mutex::new(input),
        guard,
    });
    let name = format!("preview-{}", uuid::Uuid::new_v4());
    sources()
        .lock()
        .map_err(|_| Failure::Unavailable)?
        .insert(name.clone(), Arc::downgrade(&source));
    let registration = Registration {
        name,
        _source: source,
    };
    let connection = Connection::open_with_flags_and_vfs(
        &registration.name,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        NAME,
    )
    .map_err(|_| registration._source.guard.error(Failure::Unavailable))?;
    Ok((connection, registration))
}
fn boundary(operation: impl FnOnce() -> c_int) -> c_int {
    catch_unwind(AssertUnwindSafe(operation)).unwrap_or(ffi::SQLITE_IOERR)
}
// SAFETY: SQLite allocates szOsFile bytes, calls xOpen before any method, and
// invokes xClose exactly once for a successfully initialized pMethods. The
// pointer held inside File is a Box<Arc<Source>> created by this VFS alone.
unsafe fn source<'a>(file: *mut ffi::sqlite3_file) -> &'a Arc<Source> {
    unsafe { &*(*file.cast::<File>()).source }
}
unsafe extern "C" fn open_file(
    _: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    file: *mut ffi::sqlite3_file,
    flags: c_int,
    out: *mut c_int,
) -> c_int {
    boundary(|| {
        if name.is_null()
            || flags & ffi::SQLITE_OPEN_MAIN_DB == 0
            || flags
                & (ffi::SQLITE_OPEN_READWRITE
                    | ffi::SQLITE_OPEN_CREATE
                    | ffi::SQLITE_OPEN_DELETEONCLOSE)
                != 0
        {
            return ffi::SQLITE_CANTOPEN;
        }
        // SAFETY: SQLite supplies the NUL-terminated filename and output storage.
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy();
        let found = sources()
            .lock()
            .ok()
            .and_then(|entries| entries.get(name.as_ref()).and_then(Weak::upgrade));
        let Some(found) = found else {
            return ffi::SQLITE_CANTOPEN;
        };
        if found.guard.check().is_err() {
            return ffi::SQLITE_CANTOPEN;
        }
        unsafe {
            ptr::write(
                file.cast::<File>(),
                File {
                    base: ffi::sqlite3_file { pMethods: &METHODS },
                    source: Box::into_raw(Box::new(found)),
                },
            );
            if !out.is_null() {
                *out = ffi::SQLITE_OPEN_READONLY;
            }
        }
        ffi::SQLITE_OK
    })
}
unsafe extern "C" fn close(file: *mut ffi::sqlite3_file) -> c_int {
    boundary(|| {
        // SAFETY: xOpen initialized this owned pointer. Clear it before Drop.
        unsafe {
            let slot = &mut *file.cast::<File>();
            let source = std::mem::replace(&mut slot.source, ptr::null_mut());
            slot.base.pMethods = ptr::null();
            if !source.is_null() {
                drop(Box::from_raw(source));
            }
        }
        ffi::SQLITE_OK
    })
}
unsafe extern "C" fn read(
    file: *mut ffi::sqlite3_file,
    output: *mut c_void,
    amount: c_int,
    offset: i64,
) -> c_int {
    if amount < 0 || offset < 0 || (amount > 0 && output.is_null()) {
        return ffi::SQLITE_IOERR_READ;
    }
    if amount == 0 {
        return ffi::SQLITE_OK;
    }
    // SAFETY: SQLite supplies a writable buffer of exactly amount bytes.
    let bytes = unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), amount as usize) };
    bytes.fill(0);
    let result = boundary(|| {
        let source = unsafe { source(file) };
        if source.guard.check().is_err() {
            return ffi::SQLITE_IOERR_READ;
        }
        let Ok(mut input) = source.input.lock() else {
            return ffi::SQLITE_IOERR_READ;
        };
        let wanted = source
            .length
            .saturating_sub(offset as u64)
            .min(bytes.len() as u64) as usize;
        if wanted == 0 {
            return ffi::SQLITE_IOERR_SHORT_READ;
        }
        let operation = (|| -> std::io::Result<()> {
            if input.reader.seek(SeekFrom::Start(offset as u64))? != offset as u64 {
                return Err(std::io::Error::other("Provider seek mismatch"));
            }
            input.reader.read_exact(&mut bytes[..wanted])
        })();
        if source.guard.check().is_err() {
            return ffi::SQLITE_IOERR_READ;
        }
        if operation.is_err() {
            source.guard.record(Failure::Unavailable);
            return ffi::SQLITE_IOERR_READ;
        }
        if wanted < bytes.len() {
            ffi::SQLITE_IOERR_SHORT_READ
        } else {
            ffi::SQLITE_OK
        }
    });
    // SHORT_READ must retain its valid prefix and zero-fill the remainder.
    if result != ffi::SQLITE_OK && result != ffi::SQLITE_IOERR_SHORT_READ {
        bytes.fill(0);
    }
    result
}
unsafe extern "C" fn size(file: *mut ffi::sqlite3_file, size: *mut i64) -> c_int {
    boundary(|| {
        let source = unsafe { source(file) };
        if source.guard.check().is_err() {
            return ffi::SQLITE_IOERR_FSTAT;
        }
        // SAFETY: SQLite supplies one output integer; admission caps length at 8 GiB.
        unsafe {
            *size = source.length as i64;
        }
        ffi::SQLITE_OK
    })
}
unsafe extern "C" fn write(_: *mut ffi::sqlite3_file, _: *const c_void, _: c_int, _: i64) -> c_int {
    ffi::SQLITE_READONLY
}
unsafe extern "C" fn truncate(_: *mut ffi::sqlite3_file, _: i64) -> c_int {
    ffi::SQLITE_READONLY
}
unsafe extern "C" fn sync(_: *mut ffi::sqlite3_file, _: c_int) -> c_int {
    ffi::SQLITE_READONLY
}
unsafe extern "C" fn lock(_: *mut ffi::sqlite3_file, _: c_int) -> c_int {
    ffi::SQLITE_OK
}
unsafe extern "C" fn reserved(_: *mut ffi::sqlite3_file, out: *mut c_int) -> c_int {
    unsafe {
        *out = 0;
    }
    ffi::SQLITE_OK
}
unsafe extern "C" fn control(_: *mut ffi::sqlite3_file, _: c_int, _: *mut c_void) -> c_int {
    ffi::SQLITE_NOTFOUND
}
unsafe extern "C" fn sector(_: *mut ffi::sqlite3_file) -> c_int {
    512
}
unsafe extern "C" fn characteristics(_: *mut ffi::sqlite3_file) -> c_int {
    ffi::SQLITE_IOCAP_IMMUTABLE
}
static METHODS: ffi::sqlite3_io_methods = ffi::sqlite3_io_methods {
    iVersion: 1,
    xClose: Some(close),
    xRead: Some(read),
    xWrite: Some(write),
    xTruncate: Some(truncate),
    xSync: Some(sync),
    xFileSize: Some(size),
    xLock: Some(lock),
    xUnlock: Some(lock),
    xCheckReservedLock: Some(reserved),
    xFileControl: Some(control),
    xSectorSize: Some(sector),
    xDeviceCharacteristics: Some(characteristics),
    xShmMap: None,
    xShmLock: None,
    xShmBarrier: None,
    xShmUnmap: None,
    xFetch: None,
    xUnfetch: None,
};
unsafe extern "C" fn delete(_: *mut ffi::sqlite3_vfs, _: *const c_char, _: c_int) -> c_int {
    ffi::SQLITE_READONLY
}
unsafe extern "C" fn access(
    _: *mut ffi::sqlite3_vfs,
    _: *const c_char,
    _: c_int,
    out: *mut c_int,
) -> c_int {
    unsafe {
        *out = 0;
    }
    ffi::SQLITE_OK
}
unsafe extern "C" fn full_path(
    _: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    capacity: c_int,
    out: *mut c_char,
) -> c_int {
    boundary(|| {
        // SAFETY: SQLite supplies a terminated name and capacity output bytes.
        let bytes = unsafe { CStr::from_ptr(name) }.to_bytes_with_nul();
        if capacity <= 0 || bytes.len() > capacity as usize {
            return ffi::SQLITE_CANTOPEN;
        }
        unsafe {
            ptr::copy_nonoverlapping(bytes.as_ptr().cast::<c_char>(), out, bytes.len());
        }
        ffi::SQLITE_OK
    })
}
unsafe extern "C" fn random(_: *mut ffi::sqlite3_vfs, amount: c_int, out: *mut c_char) -> c_int {
    boundary(|| {
        if amount <= 0 {
            return 0;
        }
        // SAFETY: SQLite supplies exactly amount output bytes.
        let bytes = unsafe { std::slice::from_raw_parts_mut(out.cast::<u8>(), amount as usize) };
        if getrandom::fill(bytes).is_ok() {
            amount
        } else {
            0
        }
    })
}
unsafe extern "C" fn sleep(_: *mut ffi::sqlite3_vfs, micros: c_int) -> c_int {
    if micros > 0 {
        std::thread::sleep(std::time::Duration::from_micros(micros as u64));
    }
    micros.max(0)
}
unsafe extern "C" fn time(_: *mut ffi::sqlite3_vfs, output: *mut f64) -> c_int {
    boundary(|| {
        let Ok(time) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) else {
            return ffi::SQLITE_ERROR;
        };
        // SAFETY: SQLite supplies one output double in Julian days.
        unsafe {
            *output = 2_440_587.5 + time.as_secs_f64() / 86_400.;
        }
        ffi::SQLITE_OK
    })
}
fn register() -> Result<(), Failure> {
    static REGISTERED: OnceLock<Result<(), Failure>> = OnceLock::new();
    *REGISTERED.get_or_init(|| {
        // SAFETY: one process-lifetime VFS, registered once under SQLite's own
        // registry lock. Its immutable callback/name pointers outlive all DBs.
        unsafe {
            if ffi::sqlite3_initialize() != ffi::SQLITE_OK {
                return Err(Failure::Unavailable);
            }
            let mut vfs: Box<ffi::sqlite3_vfs> = Box::new(std::mem::zeroed());
            vfs.iVersion = 1;
            vfs.szOsFile = std::mem::size_of::<File>() as c_int;
            vfs.mxPathname = 128;
            vfs.zName = c"puppyone-provider-readonly".as_ptr();
            vfs.xOpen = Some(open_file);
            vfs.xDelete = Some(delete);
            vfs.xAccess = Some(access);
            vfs.xFullPathname = Some(full_path);
            vfs.xRandomness = Some(random);
            vfs.xSleep = Some(sleep);
            vfs.xCurrentTime = Some(time);
            if ffi::sqlite3_vfs_register(&mut *vfs, 0) != ffi::SQLITE_OK {
                return Err(Failure::Unavailable);
            }
            Box::leak(vfs);
        }
        Ok(())
    })
}
