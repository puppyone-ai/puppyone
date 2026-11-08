//! Host file protocol v1 (`contracts/host-file-protocol-v1.json`, pinned
//! byte for byte from `puppyone-cloud/contracts`): folders on the owner's
//! other computers, reached only through SSH that ends on the host. The
//! Cloud relays bytes it cannot read; a folder is a server-registered id the
//! host alone maps to a local path.
use serde::{Deserialize, Serialize};

/// The pinned contract.
pub const CONTRACT: &str = include_str!("../../../contracts/host-file-protocol-v1.json");
/// Protocol versions this app speaks (`protocol.supported`).
pub const PROTOCOL_VERSION: u64 = 1;
/// `limits`.
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_DIRECTORY_ENTRIES: usize = 10_000;
pub const MAX_PATH_CHARACTERS: usize = 4096;
pub const MAX_LINE_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_REQUESTS_IN_FLIGHT: usize = 16;
pub const MAX_WATCHES_PER_CHANNEL: usize = 4;
pub const MAX_TUNNELS_PER_DEVICE: usize = 16;
pub const MAX_TUNNEL_CHUNK_BYTES: usize = 64 * 1024;
pub const CLIENT_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
pub const CLIENT_WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);
/// `transport.ssh.user` is the folder id; the files subsystem's name.
pub const FILES_SUBSYSTEM: &str = "puppyone-files";
/// Agents run as `puppyone-agent <launcher>`.
pub const AGENT_COMMAND: &str = "puppyone-agent";
pub const LAUNCHERS: [&str; 7] = [
    "shell", "codex", "claude", "cursor", "opencode", "pi", "hermes",
];

/// `HostFolderCapability`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Capability {
    #[serde(rename = "folder.read")]
    Read,
    #[serde(rename = "folder.write")]
    Write,
    #[serde(rename = "folder.shell")]
    Shell,
    #[serde(rename = "folder.git")]
    Git,
    #[serde(rename = "folder.agent")]
    Agent,
}

/// `errors`: a host file error code and the HTTP-like status the editor
/// understands (`STATUS` in the access side's client).
pub fn status(code: &str) -> u16 {
    match code {
        "invalid_path"
        | "unsupported_file"
        | "too_many_entries"
        | "invalid_content"
        | "revision_required"
        | "file_operation_failed"
        | "invalid_request" => 400,
        "not_found" => 404,
        "already_exists" | "conflict" | "not_empty" => 409,
        "folder_unavailable" | "root_changed" | "not_allowed" => 403,
        "too_large" => 413,
        "device_offline"
        | "device_busy"
        | "device_disconnected"
        | "audit_unavailable"
        | "tunnel_limit"
        | "tunnel_unavailable" => 503,
        "device_timeout" => 504,
        "network_unavailable" => 0,
        _ => 400,
    }
}

/// `HostFileEntry`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    /// Nanoseconds since the epoch, as a decimal string.
    pub modified_ns: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Directory,
    File,
}

/// `HostFileOperation`: one request on the files channel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Request {
    List {
        #[serde(default)]
        path: String,
    },
    Read {
        path: String,
    },
    Write {
        path: String,
        content_base64: String,
        /// `Some(None)` (JSON null) creates a new file without overwriting;
        /// a missing field (`None`) is refused (`revision_required`).
        #[serde(
            default,
            deserialize_with = "present",
            skip_serializing_if = "Option::is_none"
        )]
        expected_revision: Option<Option<String>>,
    },
    Mkdir {
        path: String,
    },
    Move {
        path: String,
        destination: String,
    },
    Remove {
        path: String,
    },
}
/// A field that is there, even as null.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}
impl Request {
    pub fn mutating(&self) -> bool {
        !matches!(self, Self::List { .. } | Self::Read { .. })
    }
}

/// `identity.path`: folder-relative, '/'-separated; never absolute, '.',
/// '..', '\\', NUL or a '.git' segment. The root is "" where allowed.
pub fn relative_path(value: &str, root: bool) -> Result<String, &'static str> {
    if value.chars().count() > MAX_PATH_CHARACTERS
        || value.contains('\\')
        || value.contains('\0')
        || value.starts_with('/')
    {
        return Err("invalid_path");
    }
    let parts: Vec<&str> = value.split('/').filter(|p| !p.is_empty()).collect();
    if value
        .split('/')
        .any(|p| p == ".." || p == "." || p.eq_ignore_ascii_case(".git"))
    {
        return Err("invalid_path");
    }
    let normalized = parts.join("/");
    if !root && normalized.is_empty() {
        return Err("invalid_path");
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The contract is the pinned copy, and what this module encodes of it
    /// agrees with it.
    #[test]
    fn the_host_protocol_is_the_pinned_contract() {
        use sha2::Digest;
        let digest: String = sha2::Sha256::digest(CONTRACT.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            digest,
            "7caecfa68de18e5b43b9bfdec13a7ae0a6df6b792d45424a937681d490661569"
        );
        let contract: serde_json::Value = serde_json::from_str(CONTRACT).unwrap();
        let limits = &contract["limits"];
        assert_eq!(limits["max_file_bytes"], MAX_FILE_BYTES);
        assert_eq!(
            limits["max_directory_entries"],
            MAX_DIRECTORY_ENTRIES as u64
        );
        assert_eq!(limits["max_path_characters"], MAX_PATH_CHARACTERS as u64);
        assert_eq!(limits["max_line_bytes"], MAX_LINE_BYTES as u64);
        assert_eq!(
            limits["max_requests_in_flight_per_channel"],
            MAX_REQUESTS_IN_FLIGHT as u64
        );
        assert_eq!(
            limits["max_watches_per_channel"],
            MAX_WATCHES_PER_CHANNEL as u64
        );
        assert_eq!(
            limits["max_tunnels_per_device"],
            MAX_TUNNELS_PER_DEVICE as u64
        );
        assert_eq!(
            limits["max_tunnel_chunk_bytes"],
            MAX_TUNNEL_CHUNK_BYTES as u64
        );
        assert_eq!(contract["protocol"]["supported"][0], PROTOCOL_VERSION);
        for (code, value) in contract["errors"].as_object().unwrap() {
            assert_eq!(status(code) as u64, value.as_u64().unwrap(), "{code}");
        }
        let launchers: Vec<&str> = contract["transport"]["execution"]["launchers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l.as_str().unwrap())
            .collect();
        assert_eq!(launchers, LAUNCHERS);
    }

    #[test]
    fn paths_stay_inside_the_folder() {
        assert_eq!(relative_path("", true), Ok(String::new()));
        assert_eq!(relative_path("", false), Err("invalid_path"));
        assert_eq!(relative_path("a//b/", false), Ok("a/b".into()));
        for bad in [
            "../x",
            "a/../b",
            "./a",
            "/abs",
            "a\\b",
            "a\0b",
            ".git/config",
            "a/.GIT",
        ] {
            assert_eq!(relative_path(bad, true), Err("invalid_path"), "{bad}");
        }
        let request: Request = serde_json::from_str(
            r#"{"action":"write","path":"a","content_base64":"","expected_revision":null}"#,
        )
        .unwrap();
        assert!(request.mutating());
        let missing: Request =
            serde_json::from_str(r#"{"action":"write","path":"a","content_base64":""}"#).unwrap();
        assert!(matches!(
            missing,
            Request::Write {
                expected_revision: None,
                ..
            }
        ));
        assert!(matches!(
            request,
            Request::Write {
                expected_revision: Some(None),
                ..
            }
        ));
    }
}
