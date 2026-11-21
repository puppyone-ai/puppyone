//! Unix filesystem primitives (`sync_dir`, `O_NOFOLLOW`, `renameatx_np` / `renameat2`, xattrs).
use cap_std::fs::{Dir, File, Metadata, MetadataExt, OpenOptions, OpenOptionsExt};
use std::{
    ffi::CString,
    io,
    os::{
        fd::{AsRawFd, RawFd},
        unix::ffi::OsStrExt,
    },
    path::Path,
};

pub(super) fn sync_dir(dir: &Dir) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::FromRawFd;
        // `cap_std::fs::Dir` opens directories with `O_PATH` on Linux, and
        // `fsync` on an `O_PATH` descriptor fails with `EBADF`. Reopen `.`
        // directly from `dir`'s fd with `O_RDONLY | O_DIRECTORY | O_CLOEXEC`.
        let fd = unsafe {
            libc::openat(
                dir.as_raw_fd(),
                c".".as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fd` is a newly opened, valid file descriptor owned here.
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        file.sync_all()
    }
    #[cfg(not(target_os = "linux"))]
    {
        dir.try_clone()?.into_std_file().sync_all()
    }
}

pub(super) fn open_path_nofollow_read(path: &Path) -> io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let mut options = std::fs::OpenOptions::new();
    options.read(true).custom_flags(libc::O_NOFOLLOW);
    options.open(path)
}

pub(super) fn open_path_nofollow_private_write(path: &Path) -> io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let mut options = std::fs::OpenOptions::new();
    options
        .write(true)
        .create(true)
        .custom_flags(libc::O_NOFOLLOW)
        .mode(0o600);
    options.open(path)
}

pub(super) fn can_access_read(path: &Path) -> io::Result<()> {
    let c_path = CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other)?;
    if unsafe { libc::access(c_path.as_ptr(), libc::R_OK) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

pub(super) fn can_access_execute(path: &Path) -> io::Result<()> {
    let c_path = CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other)?;
    if unsafe { libc::access(c_path.as_ptr(), libc::X_OK) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

pub(super) fn open_nofollow_read(dir: &Dir, name: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    dir.open_with(name, &options)
}

pub(super) fn open_nofollow_read_write(dir: &Dir, name: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    dir.open_with(name, &options)
}

pub(super) fn open_directory_nofollow(parent: &Dir, name: &Path) -> io::Result<Dir> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW);
    parent
        .open_with(name, &options)
        .map(|file| Dir::from_std_file(file.into_std()))
}

pub(super) fn copy_file_metadata(src: &File, src_meta: &Metadata, dst: &File) {
    let src_fd = src.as_raw_fd();
    let dst_fd = dst.as_raw_fd();

    if let Ok(dst_meta) = dst.metadata()
        && (dst_meta.uid() != src_meta.uid() || dst_meta.gid() != src_meta.gid())
    {
        unsafe {
            let _ = libc::fchown(dst_fd, src_meta.uid(), src_meta.gid());
        }
    }

    copy_unix_xattrs(src_fd, dst_fd);

    #[cfg(target_os = "macos")]
    copy_macos_creation_time(src_fd, dst_fd);
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn exclusive_rename(from: &Dir, name: &Path, to: &Dir, next: &Path) -> io::Result<()> {
    let name = CString::new(name.as_os_str().as_bytes())?;
    let next = CString::new(next.as_os_str().as_bytes())?;
    // SAFETY: both directory handles stay alive through the call; each C
    // string is a validated single component with its own terminating NUL.
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            from.as_raw_fd(),
            name.as_ptr(),
            to.as_raw_fd(),
            next.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            from.as_raw_fd(),
            name.as_ptr(),
            to.as_raw_fd(),
            next.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn copy_unix_xattrs(src_fd: RawFd, dst_fd: RawFd) {
    let list_len = unsafe { xattr_list(src_fd, std::ptr::null_mut(), 0) };
    if list_len <= 0 {
        return;
    }
    let mut names = vec![0u8; list_len as usize];
    let read_len = unsafe { xattr_list(src_fd, names.as_mut_ptr().cast(), names.len()) };
    if read_len <= 0 {
        return;
    }
    names.truncate(read_len as usize);

    for raw_name in names.split(|&b| b == 0).filter(|s| !s.is_empty()) {
        let mut c_name = Vec::with_capacity(raw_name.len() + 1);
        c_name.extend_from_slice(raw_name);
        c_name.push(0);
        let name_ptr = c_name.as_ptr().cast::<libc::c_char>();

        let val_len = unsafe { xattr_get(src_fd, name_ptr, std::ptr::null_mut(), 0) };
        if val_len < 0 {
            continue;
        }
        let mut value = vec![0u8; val_len as usize];
        let got = if val_len == 0 {
            0
        } else {
            unsafe { xattr_get(src_fd, name_ptr, value.as_mut_ptr().cast(), value.len()) }
        };
        if got < 0 {
            continue;
        }
        unsafe {
            let _ = xattr_set(dst_fd, name_ptr, value.as_ptr().cast(), got as usize);
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn xattr_list(fd: libc::c_int, buf: *mut libc::c_char, size: libc::size_t) -> libc::ssize_t {
    unsafe { libc::flistxattr(fd, buf, size, 0) }
}

#[cfg(not(target_os = "macos"))]
unsafe fn xattr_list(fd: libc::c_int, buf: *mut libc::c_char, size: libc::size_t) -> libc::ssize_t {
    unsafe { libc::flistxattr(fd, buf, size) }
}

#[cfg(target_os = "macos")]
unsafe fn xattr_get(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *mut libc::c_void,
    size: libc::size_t,
) -> libc::ssize_t {
    unsafe { libc::fgetxattr(fd, name, value, size, 0, 0) }
}

#[cfg(not(target_os = "macos"))]
unsafe fn xattr_get(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *mut libc::c_void,
    size: libc::size_t,
) -> libc::ssize_t {
    unsafe { libc::fgetxattr(fd, name, value, size) }
}

#[cfg(target_os = "macos")]
unsafe fn xattr_set(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *const libc::c_void,
    size: libc::size_t,
) -> libc::c_int {
    unsafe { libc::fsetxattr(fd, name, value, size, 0, 0) }
}

#[cfg(not(target_os = "macos"))]
unsafe fn xattr_set(
    fd: libc::c_int,
    name: *const libc::c_char,
    value: *const libc::c_void,
    size: libc::size_t,
) -> libc::c_int {
    unsafe { libc::fsetxattr(fd, name, value, size, 0) }
}

#[cfg(target_os = "macos")]
fn copy_macos_creation_time(src_fd: RawFd, dst_fd: RawFd) {
    let mut st = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe { libc::fstat(src_fd, st.as_mut_ptr()) } != 0 {
        return;
    }
    let st = unsafe { st.assume_init() };
    if st.st_birthtime <= 0 && st.st_birthtime_nsec <= 0 {
        return;
    }
    let mut attrlist = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: libc::ATTR_CMN_CRTIME,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    let mut crtime = libc::timespec {
        tv_sec: st.st_birthtime,
        tv_nsec: st.st_birthtime_nsec,
    };
    unsafe {
        let _ = libc::fsetattrlist(
            dst_fd,
            (&raw mut attrlist).cast(),
            (&raw mut crtime).cast(),
            std::mem::size_of::<libc::timespec>(),
            0,
        );
    }
}
