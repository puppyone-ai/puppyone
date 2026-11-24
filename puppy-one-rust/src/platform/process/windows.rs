//! Windows process isolation (`CREATE_NEW_PROCESS_GROUP`, Job Objects with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), subtree termination, and inheritable
//! bootstrap pipes.
use std::{
    io::Write,
    os::windows::{
        io::{FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    process::{Child, Command},
};
use windows::{
    Win32::{
        Foundation::{
            CloseHandle, HANDLE, HANDLE_FLAG_INHERIT, HANDLE_FLAGS, SetHandleInformation,
        },
        Security::SECURITY_ATTRIBUTES,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject,
            },
            Pipes::CreatePipe,
            Threading::{
                CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, OpenProcess, PROCESS_SET_QUOTA,
                PROCESS_TERMINATE, TerminateProcess,
            },
        },
    },
    core::{BOOL, PCWSTR},
};

pub(super) struct JobHandle(HANDLE);

// SAFETY: Win32 job object handles can safely be owned and closed across threads.
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

impl JobHandle {
    pub(super) fn terminate(&self) -> bool {
        // SAFETY: `self.0` is an owned job object handle; terminating it reaps
        // the direct child and all descendants assigned to the job.
        unsafe { TerminateJobObject(self.0, 1).is_ok() }
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        // SAFETY: `self.0` is an owned job object handle; closing it triggers
        // `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` for any surviving descendants.
        unsafe {
            let _ = TerminateJobObject(self.0, 1);
            let _ = CloseHandle(self.0);
        }
    }
}

pub(super) fn attach_job(pid: u32) -> Option<JobHandle> {
    // SAFETY: allocates an anonymous Job Object, configures KILL_ON_JOB_CLOSE,
    // and assigns the spawned process handle to it.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .is_err()
        {
            let _ = CloseHandle(job);
            return None;
        }
        let proc_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid).ok();
        if let Some(proc_handle) = proc_handle {
            let assigned = AssignProcessToJobObject(job, proc_handle).is_ok();
            let _ = CloseHandle(proc_handle);
            if assigned {
                return Some(JobHandle(job));
            }
        }
        let _ = CloseHandle(job);
        None
    }
}

pub(super) struct BootstrapPipe {
    read: OwnedHandle,
    write: OwnedHandle,
}

impl BootstrapPipe {
    pub(super) fn deliver_async(self, payload: Vec<u8>) {
        drop(self.read);
        let write = self.write;
        std::thread::spawn(move || {
            let mut pipe = std::fs::File::from(write);
            let _ = pipe.write_all(&payload);
        });
    }
}

/// Creates an anonymous pipe with an inheritable read handle (communicated to
/// the child via `PUPPYONE_BOOTSTRAP_HANDLE`) and a non-inheritable write end.
pub(super) fn attach_bootstrap_pipe(
    command: &mut tokio::process::Command,
) -> std::io::Result<BootstrapPipe> {
    let mut read_raw = HANDLE::default();
    let mut write_raw = HANDLE::default();
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: BOOL(1),
    };
    // SAFETY: `CreatePipe` populates both output handles on success.
    unsafe { CreatePipe(&mut read_raw, &mut write_raw, Some(&sa), 0) }
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    // Ensure the parent's write handle is NOT inherited by the child so EOF
    // arrives cleanly when the parent closes it.
    let _ = unsafe { SetHandleInformation(write_raw, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) };
    let handle_value = (read_raw.0 as usize).to_string();
    command.env(super::WINDOWS_BOOTSTRAP_HANDLE_ENV, handle_value);
    // SAFETY: both handles are freshly created and uniquely owned here.
    let read = unsafe { OwnedHandle::from_raw_handle(read_raw.0) };
    let write = unsafe { OwnedHandle::from_raw_handle(write_raw.0) };
    Ok(BootstrapPipe { read, write })
}

pub(super) fn isolate_std(command: &mut Command) {
    command.creation_flags((CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW).0);
}

pub(super) fn isolate_tokio(command: &mut tokio::process::Command) {
    command.creation_flags((CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW).0);
}

pub(super) fn hide_console_window(command: &mut tokio::process::Command) {
    command.creation_flags(CREATE_NO_WINDOW.0);
}

pub(super) fn apply_tokio_args(
    command: &mut tokio::process::Command,
    args: &[String],
    verbatim: bool,
) {
    if verbatim {
        for arg in args {
            command.raw_arg(arg);
        }
    } else {
        command.args(args);
    }
}

pub(super) fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) fn is_alive(pid: u32) -> bool {
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    /// `STILL_ACTIVE`.
    const RUNNING: u32 = 259;
    // SAFETY: opens the process for a status query and closes the handle.
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => handle,
            // A process this user may not query still exists.
            Err(error) => return error.code() == windows::Win32::Foundation::E_ACCESSDENIED,
        };
        let mut code = 0u32;
        let running = GetExitCodeProcess(handle, &mut code).is_ok() && code == RUNNING;
        let _ = CloseHandle(handle);
        running
    }
}

pub(super) fn terminate_pid(pid: u32, _grouped: bool, _force: bool) -> bool {
    // SAFETY: opens the process with terminate right and closes the handle.
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) else {
            return false;
        };
        let ok = TerminateProcess(handle, 1).is_ok();
        let _ = CloseHandle(handle);
        ok
    }
}
