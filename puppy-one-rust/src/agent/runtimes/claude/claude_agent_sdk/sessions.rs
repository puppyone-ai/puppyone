//! The SDK's session helpers over Claude Code's own transcript store
//! (`$CLAUDE_CONFIG_DIR/projects/<sanitized cwd>/<session id>.jsonl`):
//! `listSessions`, `getSessionInfo`, `getSessionMessages` and `forkSession`.
//! Every read is a lite head/tail scan or one bounded transcript parse,
//! exactly as the SDK reads them.
use super::{ForkSessionOptions, ListSessionsOptions, SessionMessagesOptions};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::node_path;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant, UNIX_EPOCH};
use unicode_normalization::UnicodeNormalization;

/// `G4`: the lite head/tail window.
const LITE_READ_BYTES: u64 = 65_536;
/// `_8`: the sanitized project-directory name limit.
const MAX_SANITIZED_LENGTH: usize = 200;
/// `LZ`: transcripts above this size skip their pre-compaction prefix.
const PRECOMPACT_SKIP_BYTES: u64 = 5_242_880;
/// `bg`: a compaction boundary is recognized near a line's start.
const BOUNDARY_WINDOW: usize = 256;

static SESSION_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        .expect("pattern")
});
static COMMAND_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<command-name>(.*?)</command-name>").expect("pattern"));
static BASH_INPUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<bash-input>([\s\S]*?)</bash-input>").expect("pattern"));
static SKIPPED_PROMPT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])").expect("pattern")
});

/// `validateUuid(value)` (`L$`).
pub fn valid_session_id(value: &str) -> bool {
    SESSION_ID.is_match(value)
}

fn nfc(value: &str) -> String {
    value.nfc().collect()
}

/// `getClaudeConfigHomeDir()` (`p6`).
pub fn claude_config_dir() -> PathBuf {
    let root = std::env::var("CLAUDE_CONFIG_DIR").ok().unwrap_or_else(|| {
        node_path::homedir()
            .join(".claude")
            .to_string_lossy()
            .into_owned()
    });
    PathBuf::from(nfc(&root))
}

/// `getProjectsDir()` (`U4`).
fn projects_dir(root: &Path) -> PathBuf {
    root.join("projects")
}

/// `simpleHash(value)` (`jH`): Java's string hash over UTF-16 code units.
fn simple_hash(value: &str) -> i32 {
    value.encode_utf16().fold(0i32, |hash, unit| {
        hash.wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(i32::from(unit))
    })
}

fn base36(mut value: u64) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut digits = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        digits.push(if digit < 10 {
            b'0' + digit
        } else {
            b'a' + digit - 10
        });
        value /= 36;
    }
    digits.reverse();
    String::from_utf8(digits).unwrap_or_default()
}

/// `sanitizePath(path)` (`F0`): one `-` per non-alphanumeric UTF-16 unit,
/// hashed past 200 characters.
pub fn sanitize_path(value: &str) -> String {
    let sanitized: String = value
        .encode_utf16()
        .map(|unit| match char::from_u32(u32::from(unit)) {
            Some(c) if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    if sanitized.len() <= MAX_SANITIZED_LENGTH {
        return sanitized;
    }
    let hash = base36(i64::from(simple_hash(value)).unsigned_abs());
    format!("{}-{hash}", &sanitized[..MAX_SANITIZED_LENGTH])
}

/// `realpath(dir).normalize("NFC")` (`M1`).
fn canonical_dir(dir: &str) -> String {
    match std::fs::canonicalize(dir) {
        Ok(path) => nfc(&path.to_string_lossy()),
        Err(_) => nfc(dir),
    }
}

fn readdir(path: &Path) -> Option<Vec<std::fs::DirEntry>> {
    std::fs::read_dir(path)
        .ok()
        .map(|entries| entries.filter_map(Result::ok).collect())
}

fn entry_name(entry: &std::fs::DirEntry) -> String {
    entry.file_name().to_string_lossy().into_owned()
}

fn is_dir(entry: &std::fs::DirEntry) -> bool {
    entry.file_type().is_ok_and(|kind| kind.is_dir())
}

/// `getProjectDirs(path)` (`j6`): the exact sanitized directory, plus
/// hashed long-path siblings.
fn project_dirs(root: &Path, path: &str) -> Vec<PathBuf> {
    let projects = projects_dir(root);
    let exact = projects.join(sanitize_path(path));
    let mut dirs = Vec::new();
    if std::fs::read_dir(&exact).is_ok() {
        dirs.push(exact.clone());
    }
    let sanitized = sanitize_path(path);
    if sanitized.len() <= MAX_SANITIZED_LENGTH {
        return dirs;
    }
    let prefix = format!("{}-", &sanitized[..MAX_SANITIZED_LENGTH]);
    for entry in readdir(&projects).unwrap_or_default() {
        if !is_dir(&entry) || !entry_name(&entry).starts_with(&prefix) {
            continue;
        }
        let candidate = projects.join(entry.file_name());
        if candidate != exact {
            dirs.push(candidate);
        }
    }
    dirs
}

/// `getWorktreePaths(cwd)` (`m4`): `git worktree list --porcelain`.
fn git_worktrees(cwd: &str) -> Vec<String> {
    let Ok(mut child) = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stdout) = stdout.as_mut() {
            let _ = stdout.read_to_string(&mut text);
        }
        text
    });
    let deadline = Instant::now() + Duration::from_millis(5_000);
    let succeeded = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let text = reader.join().unwrap_or_default();
    if !succeeded || text.is_empty() {
        return Vec::new();
    }
    text.split('\n')
        .filter_map(|line| line.strip_prefix("worktree "))
        .map(nfc)
        .collect()
}

/// `{ filePath, projectPath, fileSize }` of a session transcript.
struct SessionFile {
    file_path: PathBuf,
    project_path: Option<String>,
    file_size: u64,
}

/// `findSessionFile(sessionId, dir)` (`L1`).
fn find_session_file(root: &Path, session_id: &str, dir: Option<&str>) -> Option<SessionFile> {
    let name = format!("{session_id}.jsonl");
    let probe = |directory: &Path, project_path: Option<&str>| {
        let file_path = directory.join(&name);
        let size = std::fs::metadata(&file_path).ok()?.len();
        (size > 0).then(|| SessionFile {
            file_path,
            project_path: project_path.map(str::to_string),
            file_size: size,
        })
    };
    if let Some(dir) = dir {
        let canonical = canonical_dir(dir);
        for directory in project_dirs(root, &canonical) {
            if let Some(found) = probe(&directory, Some(&canonical)) {
                return Some(found);
            }
        }
        for worktree in git_worktrees(&canonical) {
            if worktree == canonical {
                continue;
            }
            for directory in project_dirs(root, &worktree) {
                if let Some(found) = probe(&directory, Some(&worktree)) {
                    return Some(found);
                }
            }
        }
        return None;
    }
    let projects = projects_dir(root);
    for entry in readdir(&projects)? {
        if let Some(found) = probe(&projects.join(entry.file_name()), None) {
            return Some(found);
        }
    }
    None
}

/// `{ mtime, size, head, tail }` (`readSessionLite`, `PX`).
struct Lite {
    mtime: i64,
    size: u64,
    head: String,
    tail: String,
}

/// `stat.mtime.getTime()`: Node rounds the nanosecond timestamp to the
/// nearest millisecond.
fn mtime_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| {
            (duration.as_secs() as f64 * 1_000.0 + f64::from(duration.subsec_nanos()) / 1e6).round()
                as i64
        })
}

fn read_lite(path: &Path) -> Option<Lite> {
    let mut file = std::fs::File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    let mut buffer = vec![0u8; LITE_READ_BYTES as usize];
    let read = read_full(&mut file, &mut buffer).ok()?;
    if read == 0 {
        return None;
    }
    let head = String::from_utf8_lossy(&buffer[..read]).into_owned();
    let offset = metadata.len().saturating_sub(LITE_READ_BYTES);
    let tail = if offset > 0 {
        file.seek(SeekFrom::Start(offset)).ok()?;
        let read = read_full(&mut file, &mut buffer).ok()?;
        String::from_utf8_lossy(&buffer[..read]).into_owned()
    } else {
        head.clone()
    };
    Some(Lite {
        mtime: mtime_ms(&metadata),
        size: metadata.len(),
        head,
        tail,
    })
}

fn read_full(file: &mut std::fs::File, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut total = 0;
    while total < buffer.len() {
        match file.read(&mut buffer[total..])? {
            0 => break,
            read => total += read,
        }
    }
    Ok(total)
}

/// `unescapeJsonString(value)` (`ZZ`).
fn unescape(value: &str) -> String {
    if !value.contains('\\') {
        return value.to_string();
    }
    serde_json::from_str::<String>(&format!("\"{value}\"")).unwrap_or_else(|_| value.to_string())
}

/// The end of a JSON string value starting at `start` (`"` index).
fn string_end(text: &[u8], start: usize) -> Option<usize> {
    let mut index = start;
    while index < text.len() {
        match text[index] {
            b'\\' => index += 2,
            b'"' => return Some(index),
            _ => index += 1,
        }
    }
    None
}

/// `extractLastJsonStringField(text, key)` (`A6`): the field's last
/// occurrence.
fn last_string_field(text: &str, key: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut best: Option<(usize, String)> = None;
    for pattern in [format!("\"{key}\":\""), format!("\"{key}\": \"")] {
        let mut from = 0;
        while let Some(found) = text.get(from..).and_then(|rest| rest.find(&pattern)) {
            let start = from + found;
            let value_start = start + pattern.len();
            let end = string_end(bytes, value_start);
            if let Some(end) = end
                && best.as_ref().is_none_or(|(at, _)| start > *at)
            {
                best = Some((start, unescape(&text[value_start..end])));
            }
            from = end.unwrap_or(bytes.len()) + 1;
            if from > bytes.len() {
                break;
            }
        }
    }
    best.map(|(_, value)| value)
}

/// `extractJsonStringField(text, key)` (`IX`): the field's first
/// occurrence.
fn first_string_field(text: &str, key: &str) -> Option<String> {
    for pattern in [format!("\"{key}\":\""), format!("\"{key}\": \"")] {
        let Some(start) = text.find(&pattern) else {
            continue;
        };
        let value_start = start + pattern.len();
        if let Some(end) = string_end(text.as_bytes(), value_start) {
            return Some(unescape(&text[value_start..end]));
        }
    }
    None
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.is_empty())
}

/// `extractFirstPromptText(entry, state)` (`h9`).
fn first_prompt_of(entry: &Value, command_fallback: &mut String) -> Option<String> {
    if entry.get("type").and_then(Value::as_str) != Some("user")
        || entry.get("isMeta") == Some(&Value::Bool(true))
        || entry.get("isCompactSummary") == Some(&Value::Bool(true))
    {
        return None;
    }
    let message = entry.get("message").filter(|m| js::truthy(m))?;
    let mut texts = Vec::new();
    match message.get("content") {
        Some(Value::String(text)) => texts.push(text.clone()),
        Some(Value::Array(blocks)) => {
            for block in blocks.iter().filter(|b| b.is_object()) {
                match block.get("type").and_then(Value::as_str) {
                    Some("tool_result") => return None,
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            texts.push(text.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    for text in texts {
        let flattened = text.replace('\n', " ");
        let text = js::trim(&flattened);
        if text.is_empty() {
            continue;
        }
        if let Some(command) = COMMAND_NAME.captures(text) {
            if command_fallback.is_empty() {
                *command_fallback = command[1].to_string();
            }
            continue;
        }
        if let Some(input) = BASH_INPUT.captures(text) {
            return Some(format!("! {}", js::trim(&input[1])));
        }
        if SKIPPED_PROMPT.is_match(text) {
            continue;
        }
        if js::len16(text) > 200 {
            return Some(format!("{}…", js::trim(js::head16(text, 200))));
        }
        return Some(text.to_string());
    }
    None
}

/// `extractFirstPrompt(head)` (`RX`).
fn first_prompt(head: &str) -> String {
    let mut fallback = String::new();
    for line in head.split('\n') {
        if !line.contains("\"type\":\"user\"") && !line.contains("\"type\": \"user\"") {
            continue;
        }
        if line.contains("\"tool_result\"")
            || line.contains("\"isMeta\":true")
            || line.contains("\"isMeta\": true")
            || line.contains("\"isCompactSummary\":true")
            || line.contains("\"isCompactSummary\": true")
        {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(prompt) = first_prompt_of(&entry, &mut fallback) {
            return prompt;
        }
    }
    fallback
}

/// `parseSessionInfoFromLite(sessionId, lite, projectPath)` (`k8`).
fn session_info(session_id: &str, lite: &Lite, project_path: Option<&str>) -> Option<Value> {
    let first_line = lite.head.split('\n').next().unwrap_or("");
    if first_line.contains("\"isSidechain\":true") || first_line.contains("\"isSidechain\": true") {
        return None;
    }
    let (head, tail) = (lite.head.as_str(), lite.tail.as_str());
    let custom_title = non_empty(last_string_field(tail, "customTitle"))
        .or_else(|| non_empty(last_string_field(head, "customTitle")))
        .or_else(|| non_empty(last_string_field(tail, "aiTitle")))
        .or_else(|| non_empty(last_string_field(head, "aiTitle")));
    let first_prompt = non_empty(Some(first_prompt(head)));
    let created_at = first_string_field(head, "timestamp").and_then(|value| js::date_parse(&value));
    let summary = custom_title
        .clone()
        .or_else(|| non_empty(last_string_field(tail, "lastPrompt")))
        .or_else(|| non_empty(last_string_field(tail, "summary")))
        .or_else(|| first_prompt.clone())?;
    let git_branch = non_empty(last_string_field(tail, "gitBranch"))
        .or_else(|| non_empty(first_string_field(head, "gitBranch")));
    let cwd = non_empty(first_string_field(head, "cwd"))
        .or_else(|| project_path.filter(|p| !p.is_empty()).map(str::to_string));
    let tag = tail
        .split('\n')
        .rfind(|line| line.contains("\"type\":\"tag\"") && line.contains("\"tag\":\""))
        .and_then(|line| non_empty(last_string_field(line, "tag")));
    Some(
        Obj::new()
            .set("sessionId", session_id)
            .set("summary", summary)
            .set("lastModified", lite.mtime)
            .set("fileSize", lite.size)
            .opt("customTitle", custom_title)
            .opt("firstPrompt", first_prompt)
            .opt("gitBranch", git_branch)
            .opt("cwd", cwd)
            .opt("tag", tag)
            .opt("createdAt", created_at)
            .build(),
    )
}

/// A candidate transcript (`{ sessionId, filePath, mtime, projectPath }`).
struct Candidate {
    session_id: String,
    file_path: PathBuf,
    mtime: i64,
    project_path: Option<String>,
}

/// `readCandidateInfo(candidate)` (`EZ`).
fn candidate_info(candidate: &Candidate) -> Option<Value> {
    let lite = read_lite(&candidate.file_path)?;
    let mut info = session_info(
        &candidate.session_id,
        &lite,
        candidate.project_path.as_deref(),
    )?;
    if candidate.mtime != 0 {
        info["lastModified"] = json!(candidate.mtime);
    }
    Some(info)
}

/// `listCandidates(projectDir, statMtime, projectPath)` (`oQ`).
fn candidates(project_dir: &Path, stat_mtime: bool, project_path: Option<&str>) -> Vec<Candidate> {
    let Some(entries) = readdir(project_dir) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let name = entry_name(entry);
            let session_id = name.strip_suffix(".jsonl")?;
            if !valid_session_id(session_id) {
                return None;
            }
            let file_path = project_dir.join(&name);
            let mtime = if stat_mtime {
                mtime_ms(&std::fs::metadata(&file_path).ok()?)
            } else {
                0
            };
            Some(Candidate {
                session_id: session_id.to_string(),
                file_path,
                mtime,
                project_path: project_path.map(str::to_string),
            })
        })
        .collect()
}

/// `gatherProjectCandidates(dir, includeWorktrees, statMtime)` (`ng`).
fn project_candidates(
    root: &Path,
    dir: &str,
    include_worktrees: bool,
    stat_mtime: bool,
) -> Vec<Candidate> {
    let canonical = canonical_dir(dir);
    let worktrees = if include_worktrees {
        git_worktrees(&canonical)
    } else {
        Vec::new()
    };
    let exact = || {
        project_dirs(root, &canonical)
            .iter()
            .flat_map(|directory| candidates(directory, stat_mtime, Some(&canonical)))
            .collect::<Vec<_>>()
    };
    if worktrees.len() <= 1 {
        return exact();
    }
    let projects = projects_dir(root);
    let windows = cfg!(windows);
    let fold = |value: String| if windows { value.to_lowercase() } else { value };
    let mut prefixes: Vec<(String, String)> = worktrees
        .iter()
        .map(|path| (path.clone(), fold(sanitize_path(path))))
        .collect();
    prefixes.sort_by_key(|(_, prefix)| std::cmp::Reverse(prefix.len()));
    let Some(entries) = readdir(&projects) else {
        return exact();
    };
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for directory in project_dirs(root, &canonical) {
        let name = directory
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        seen.insert(fold(name));
        result.extend(candidates(&directory, stat_mtime, Some(&canonical)));
    }
    for entry in entries {
        if !is_dir(&entry) {
            continue;
        }
        let name = fold(entry_name(&entry));
        if seen.contains(&name) {
            continue;
        }
        for (path, prefix) in &prefixes {
            if name == *prefix
                || (prefix.len() >= MAX_SANITIZED_LENGTH && name.starts_with(&format!("{prefix}-")))
            {
                seen.insert(name.clone());
                result.extend(candidates(
                    &projects.join(entry.file_name()),
                    stat_mtime,
                    Some(path),
                ));
                break;
            }
        }
    }
    result
}

/// `gatherAllCandidates(statMtime)` (`rg`).
fn all_candidates(root: &Path, stat_mtime: bool) -> Vec<Candidate> {
    let projects = projects_dir(root);
    readdir(&projects)
        .unwrap_or_default()
        .iter()
        .filter(|entry| is_dir(entry))
        .flat_map(|entry| candidates(&projects.join(entry.file_name()), stat_mtime, None))
        .collect()
}

fn last_modified(info: &Value) -> i64 {
    info["lastModified"].as_i64().unwrap_or(0)
}

fn session_id_of(info: &Value) -> &str {
    info["sessionId"].as_str().unwrap_or("")
}

/// `listSessions(options)` (`bZ`).
pub fn list_sessions(root: &Path, options: &ListSessionsOptions) -> Vec<Value> {
    let offset = options.offset.unwrap_or(0);
    let paged = options.limit.is_some_and(|limit| limit > 0) || offset > 0;
    let mut found = match options.dir.as_deref() {
        Some(dir) => {
            project_candidates(root, dir, options.include_worktrees.unwrap_or(true), paged)
        }
        None => all_candidates(root, paged),
    };
    if !paged {
        // `ig`: the newest copy of each session, newest first.
        let mut newest: Map<String, Value> = Map::new();
        for info in found.iter().filter_map(candidate_info) {
            let id = session_id_of(&info).to_string();
            if newest
                .get(&id)
                .is_none_or(|existing| last_modified(&info) > last_modified(existing))
            {
                newest.insert(id, info);
            }
        }
        let mut sessions: Vec<Value> = newest.into_iter().map(|(_, info)| info).collect();
        sessions.sort_by(|a, b| {
            last_modified(b)
                .cmp(&last_modified(a))
                .then_with(|| session_id_of(b).cmp(session_id_of(a)))
        });
        return sessions;
    }
    // `dg`: newest transcripts first, deduplicated, after `offset` sessions.
    found.sort_by(|a, b| {
        b.mtime
            .cmp(&a.mtime)
            .then_with(|| b.session_id.cmp(&a.session_id))
    });
    let limit = options
        .limit
        .filter(|limit| *limit > 0)
        .unwrap_or(usize::MAX);
    let mut sessions = Vec::new();
    let mut skipped = 0;
    let mut seen = HashSet::new();
    for candidate in &found {
        if sessions.len() >= limit {
            break;
        }
        let Some(info) = candidate_info(candidate) else {
            continue;
        };
        if !seen.insert(session_id_of(&info).to_string()) {
            continue;
        }
        if skipped < offset {
            skipped += 1;
            continue;
        }
        sessions.push(info);
    }
    sessions
}

/// `getSessionInfo(sessionId, { dir })` (`_Z`).
pub fn get_session_info(root: &Path, session_id: &str, dir: Option<&str>) -> Option<Value> {
    if !valid_session_id(session_id) {
        return None;
    }
    let file = find_session_file(root, session_id, dir)?;
    let lite = read_lite(&file.file_path)?;
    session_info(session_id, &lite, file.project_path.as_deref())
}

fn truthy_env(key: &str) -> bool {
    std::env::var(key).is_ok_and(|value| {
        matches!(
            value.trim().to_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// The transcript after its last compaction boundary (`AZ`).
fn post_boundary(bytes: &[u8]) -> Vec<u8> {
    let mut start = 0;
    let mut offset = 0;
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        let window = &line[..line
            .len()
            .min(BOUNDARY_WINDOW + "\"compact_boundary\"".len())];
        let near_start = window
            .windows(18)
            .position(|w| w == b"\"compact_boundary\"")
            .is_some_and(|at| at < BOUNDARY_WINDOW);
        if near_start
            && let Ok(entry) = serde_json::from_slice::<Value>(line.trim_ascii_end())
            && entry.get("type").and_then(Value::as_str) == Some("system")
            && entry.get("subtype").and_then(Value::as_str) == Some("compact_boundary")
        {
            let metadata = entry.get("compactMetadata");
            let preserved = metadata.is_some_and(|m| {
                js::truthy_opt(m.get("preservedSegment"))
                    || js::truthy_opt(m.get("preservedMessages"))
            });
            if !preserved {
                start = offset;
            }
        }
        offset += line.len();
    }
    bytes[start..]
        .split_inclusive(|byte| *byte == b'\n')
        .filter(|line| !line.starts_with(b"{\"type\":\"attribution-snapshot\""))
        .flatten()
        .copied()
        .collect()
}

/// `readTranscriptForLoad(filePath, fileSize)` (`xg`).
fn read_transcript(path: &Path, size: u64) -> Option<Vec<u8>> {
    let bytes = std::fs::read(path).ok()?;
    if size > PRECOMPACT_SKIP_BYTES && !truthy_env("CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP") {
        return Some(post_boundary(&bytes[..bytes.len().min(size as usize)]));
    }
    Some(bytes)
}

fn json_lines(bytes: &[u8]) -> impl Iterator<Item = Value> + '_ {
    bytes.split(|byte| *byte == b'\n').filter_map(|line| {
        let start = line.iter().position(|byte| *byte > 32)?;
        serde_json::from_slice::<Value>(&line[start..]).ok()
    })
}

const TRANSCRIPT_TYPES: &[&str] = &["user", "assistant", "progress", "system", "attachment"];

fn transcript_entry(entry: &Value) -> bool {
    entry
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| TRANSCRIPT_TYPES.contains(&kind))
        && entry.get("uuid").is_some_and(Value::is_string)
}

/// `parseTranscriptEntries(bytes)` (`yg`).
fn transcript_entries(bytes: &[u8]) -> Vec<Value> {
    json_lines(bytes).filter(transcript_entry).collect()
}

fn text_field<'a>(entry: &'a Value, key: &str) -> Option<&'a str> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
}

fn uuid_of(entry: &Value) -> String {
    entry["uuid"].as_str().unwrap_or("").to_string()
}

fn with_parent(entry: &Value, parent: &str) -> Value {
    js::with(entry, "parentUuid", parent)
}

/// `buildConversationChain(entries)` (`fg`): the main conversation path to
/// the newest leaf, after relinking compaction-preserved segments.
fn conversation_chain(entries: &[Value]) -> Vec<Value> {
    let mut by_id: Map<String, Value> = Map::new();
    for entry in entries {
        by_id.insert(uuid_of(entry), entry.clone());
    }
    let keys: Vec<String> = by_id.keys().cloned().collect();
    for key in &keys {
        let boundary = by_id[key].clone();
        if boundary.get("type").and_then(Value::as_str) != Some("system")
            || boundary.get("subtype").and_then(Value::as_str) != Some("compact_boundary")
        {
            continue;
        }
        let metadata = boundary.get("compactMetadata");
        let messages = metadata
            .and_then(|m| m.get("preservedMessages"))
            .filter(|m| js::truthy(m));
        let segment = metadata
            .and_then(|m| m.get("preservedSegment"))
            .filter(|m| js::truthy(m));
        if let Some(messages) = messages {
            let uuids: Vec<String> = messages["uuids"]
                .as_array()
                .map(|ids| ids.iter().map(|id| js::to_js_string(Some(id))).collect())
                .unwrap_or_default();
            if uuids.is_empty() || uuids.iter().any(|id| !by_id.contains_key(id)) {
                continue;
            }
            let anchor = js::to_js_string(messages.get("anchorUuid"));
            let mut parent = anchor.clone();
            for id in &uuids {
                let relinked = with_parent(&by_id[id], &parent);
                by_id.insert(id.clone(), relinked);
                parent = id.clone();
            }
            let (first, last) = (uuids[0].clone(), uuids[uuids.len() - 1].clone());
            for key in &keys {
                if by_id[key].get("parentUuid").and_then(Value::as_str) == Some(anchor.as_str())
                    && *key != first
                {
                    let relinked = with_parent(&by_id[key], &last);
                    by_id.insert(key.clone(), relinked);
                }
            }
        } else if let Some(segment) = segment {
            let head = js::to_js_string(segment.get("headUuid"));
            let anchor = js::to_js_string(segment.get("anchorUuid"));
            let tail = js::to_js_string(segment.get("tailUuid"));
            if let Some(entry) = by_id.get(&head).cloned() {
                by_id.insert(head.clone(), with_parent(&entry, &anchor));
            }
            for key in &keys {
                if by_id[key].get("parentUuid").and_then(Value::as_str) == Some(anchor.as_str())
                    && *key != head
                {
                    let relinked = with_parent(&by_id[key], &tail);
                    by_id.insert(key.clone(), relinked);
                }
            }
        }
    }
    let mut positions: HashMap<String, usize> = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        positions.insert(uuid_of(entry), index);
    }
    let parents: HashSet<String> = by_id
        .values()
        .filter_map(|entry| text_field(entry, "parentUuid").map(str::to_string))
        .collect();
    let mut leaves = Vec::new();
    for leaf in by_id
        .values()
        .filter(|entry| !parents.contains(&uuid_of(entry)))
    {
        let mut current = Some(leaf);
        let mut visited = HashSet::new();
        while let Some(entry) = current {
            if !visited.insert(uuid_of(entry)) {
                break;
            }
            if matches!(
                entry.get("type").and_then(Value::as_str),
                Some("user" | "assistant")
            ) {
                leaves.push(entry.clone());
                break;
            }
            current = text_field(entry, "parentUuid").and_then(|parent| by_id.get(parent));
        }
    }
    if leaves.is_empty() {
        return Vec::new();
    }
    let main: Vec<&Value> = leaves
        .iter()
        .filter(|entry| {
            !js::truthy_opt(entry.get("isSidechain"))
                && !js::truthy_opt(entry.get("teamName"))
                && !js::truthy_opt(entry.get("isMeta"))
        })
        .collect();
    let position = |entry: &Value| positions.get(&uuid_of(entry)).map_or(-1, |p| *p as i64);
    let newest = |candidates: Vec<&Value>| -> Value {
        candidates
            .into_iter()
            .reduce(|best, entry| {
                if position(entry) > position(best) {
                    entry
                } else {
                    best
                }
            })
            .cloned()
            .unwrap_or(Value::Null)
    };
    let leaf = if main.is_empty() {
        newest(leaves.iter().collect())
    } else {
        newest(main)
    };
    let mut chain = Vec::new();
    let mut visited = HashSet::new();
    let mut current = by_id.get(&uuid_of(&leaf));
    while let Some(entry) = current {
        if !visited.insert(uuid_of(entry)) {
            break;
        }
        chain.push(entry.clone());
        current = text_field(entry, "parentUuid").and_then(|parent| by_id.get(parent));
    }
    chain.reverse();
    recover_orphaned_parallel_tool_results(&by_id, chain, visited)
}

/// `getAssistantMessageId(entry)` (`IH`).
fn assistant_message_id(entry: &Value) -> Option<String> {
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    entry
        .get("message")
        .filter(|m| m.is_object())
        .and_then(|m| m.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// `isToolResultEntry(entry)` (`gg`).
fn is_tool_result_entry(entry: &Value) -> bool {
    entry.get("type").and_then(Value::as_str) == Some("user")
        && text_field(entry, "parentUuid").is_some()
        && entry
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
            .is_some_and(|content| {
                content
                    .iter()
                    .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
            })
}

/// `recoverOrphanedParallelToolResults(byId, chain, seen)` (`hg`): sibling
/// assistant fragments and their tool results that parallel tool calls
/// split off the main chain.
fn recover_orphaned_parallel_tool_results(
    by_id: &Map<String, Value>,
    chain: Vec<Value>,
    mut seen: HashSet<String>,
) -> Vec<Value> {
    let assistants: Vec<&Value> = chain
        .iter()
        .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("assistant"))
        .collect();
    if assistants.is_empty() {
        return chain;
    }
    let mut chain_by_message: HashMap<String, &Value> = HashMap::new();
    for entry in &assistants {
        if let Some(id) = assistant_message_id(entry) {
            chain_by_message.insert(id, entry);
        }
    }
    let mut fragments: HashMap<String, Vec<&Value>> = HashMap::new();
    let mut results: HashMap<String, Vec<&Value>> = HashMap::new();
    for entry in by_id.values() {
        if let Some(id) = assistant_message_id(entry) {
            fragments.entry(id).or_default().push(entry);
        } else if is_tool_result_entry(entry) {
            let parent = js::to_js_string(entry.get("parentUuid"));
            results.entry(parent).or_default().push(entry);
        }
    }
    let mut handled = HashSet::new();
    let mut inserts: HashMap<String, Vec<Value>> = HashMap::new();
    let mut recovered = 0;
    for entry in &assistants {
        let Some(id) = assistant_message_id(entry) else {
            continue;
        };
        if !handled.insert(id.clone()) {
            continue;
        }
        let siblings = fragments.get(&id).cloned().unwrap_or_else(|| vec![*entry]);
        let mut missing: Vec<&Value> = siblings
            .iter()
            .copied()
            .filter(|sibling| !seen.contains(&uuid_of(sibling)))
            .collect();
        let mut orphaned: Vec<&Value> = Vec::new();
        for sibling in &siblings {
            for result in results.get(&uuid_of(sibling)).into_iter().flatten() {
                if !seen.contains(&uuid_of(result)) {
                    orphaned.push(result);
                }
            }
        }
        if missing.is_empty() && orphaned.is_empty() {
            continue;
        }
        let by_time = |a: &&Value, b: &&Value| {
            js::str_or_empty(a.get("timestamp")).cmp(js::str_or_empty(b.get("timestamp")))
        };
        missing.sort_by(by_time);
        orphaned.sort_by(by_time);
        let anchor = chain_by_message
            .get(&id)
            .map(|entry| uuid_of(entry))
            .unwrap_or_default();
        let recovered_entries: Vec<Value> = missing.into_iter().chain(orphaned).cloned().collect();
        for entry in &recovered_entries {
            seen.insert(uuid_of(entry));
        }
        recovered += recovered_entries.len();
        inserts.insert(anchor, recovered_entries);
    }
    if recovered == 0 {
        return chain;
    }
    let mut output = Vec::new();
    for entry in chain {
        let id = uuid_of(&entry);
        output.push(entry);
        if let Some(extra) = inserts.remove(&id) {
            output.extend(extra);
        }
    }
    output
}

/// `isVisibleMessage(entry, includeSystemMessages)` (`ug`).
fn visible(entry: &Value, include_system: bool) -> bool {
    let visible_type = match entry.get("type").and_then(Value::as_str) {
        Some("user" | "assistant") => true,
        Some("system") => include_system,
        _ => false,
    };
    visible_type
        && !js::truthy_opt(entry.get("isMeta"))
        && !js::truthy_opt(entry.get("isSidechain"))
        && !js::truthy_opt(entry.get("teamName"))
}

/// `toSessionMessage(entry)` (`RH`).
fn session_message(entry: &Value) -> Value {
    Obj::new()
        .opt("type", entry.get("type").cloned())
        .opt("uuid", entry.get("uuid").cloned())
        .opt("session_id", entry.get("sessionId").cloned())
        .opt("message", entry.get("message").cloned())
        .set("parent_tool_use_id", Value::Null)
        .opt("timestamp", entry.get("timestamp").cloned())
        .build()
}

/// `paginate(messages, options)` (`PH`).
fn paginate(messages: Vec<Value>, limit: Option<usize>, offset: Option<usize>) -> Vec<Value> {
    let offset = offset.unwrap_or(0);
    match limit.filter(|limit| *limit > 0) {
        Some(limit) => messages.into_iter().skip(offset).take(limit).collect(),
        None => messages.into_iter().skip(offset).collect(),
    }
}

/// `getSessionMessages(sessionId, options)` (`PZ`).
pub fn get_session_messages(
    root: &Path,
    session_id: &str,
    options: &SessionMessagesOptions,
) -> Vec<Value> {
    if !valid_session_id(session_id) {
        return Vec::new();
    }
    let Some(file) = find_session_file(root, session_id, options.dir.as_deref()) else {
        return Vec::new();
    };
    let Some(bytes) = read_transcript(&file.file_path, file.file_size) else {
        return Vec::new();
    };
    let messages = conversation_chain(&transcript_entries(&bytes))
        .iter()
        .filter(|entry| visible(entry, options.include_system_messages))
        .map(session_message)
        .collect();
    paginate(messages, options.limit, options.offset)
}

/// `readSessionBytes(sessionId, dir)` (`sg`): `(bytes, projectDir)`.
fn read_session_bytes(
    root: &Path,
    session_id: &str,
    dir: Option<&str>,
) -> Option<(Vec<u8>, PathBuf)> {
    let name = format!("{session_id}.jsonl");
    let read = |directory: &Path| {
        let bytes = std::fs::read(directory.join(&name)).ok()?;
        (!bytes.is_empty()).then(|| (bytes, directory.to_path_buf()))
    };
    if let Some(dir) = dir {
        let canonical = canonical_dir(dir);
        for directory in project_dirs(root, &canonical) {
            if let Some(found) = read(&directory) {
                return Some(found);
            }
        }
        for worktree in git_worktrees(&canonical) {
            if worktree == canonical {
                continue;
            }
            for directory in project_dirs(root, &worktree) {
                if let Some(found) = read(&directory) {
                    return Some(found);
                }
            }
        }
        return None;
    }
    let projects = projects_dir(root);
    readdir(&projects)?
        .iter()
        .find_map(|entry| read(&projects.join(entry.file_name())))
}

/// `forkSession(sessionId, options)` (`gZ`): a new transcript copied up to
/// `upToMessageId`, with fresh message ids and a `(fork)` title.
pub fn fork_session(
    root: &Path,
    session_id: &str,
    options: &ForkSessionOptions,
) -> AgentResult<Value> {
    if !valid_session_id(session_id) {
        return Err(AgentError::new(format!("Invalid sessionId: {session_id}")));
    }
    if let Some(up_to) = options
        .up_to_message_id
        .as_deref()
        .filter(|id| !id.is_empty())
        && !valid_session_id(up_to)
    {
        return Err(AgentError::new(format!("Invalid upToMessageId: {up_to}")));
    }
    let Some((bytes, project_dir)) = read_session_bytes(root, session_id, options.dir.as_deref())
    else {
        return Err(AgentError::new(match options.dir.as_deref() {
            Some(dir) => format!("Session {session_id} not found in project directory for {dir}"),
            None => format!("Session {session_id} not found"),
        }));
    };
    let (entries, forked) = fork_entries(&bytes, session_id, options)?;
    let path = project_dir.join(format!("{forked}.jsonl"));
    let mut file_options = std::fs::OpenOptions::new();
    file_options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        file_options.mode(0o600);
    }
    let mut file = file_options.open(&path)?;
    for entry in &entries {
        file.write_all(format!("{}\n", js::stringify(entry)).as_bytes())?;
    }
    file.flush()?;
    Ok(json!({ "sessionId": forked }))
}

/// `buildForkEntries(bytes, sessionId, options)` (`Jh` / `uZ`).
fn fork_entries(
    bytes: &[u8],
    session_id: &str,
    options: &ForkSessionOptions,
) -> AgentResult<(Vec<Value>, String)> {
    let mut transcript = Vec::new();
    let mut replacements = Vec::new();
    for entry in json_lines(bytes) {
        let kind = entry.get("type").and_then(Value::as_str);
        if kind.is_some_and(|kind| TRANSCRIPT_TYPES.contains(&kind))
            && entry.get("uuid").is_some_and(Value::is_string)
        {
            transcript.push(entry);
        } else if kind == Some("content-replacement")
            && entry.get("sessionId").and_then(Value::as_str) == Some(session_id)
            && let Some(items) = entry.get("replacements").and_then(Value::as_array)
        {
            replacements.extend(items.iter().cloned());
        }
    }
    let no_messages = || AgentError::new(format!("Session {session_id} has no messages to fork"));
    let mut main: Vec<Value> = transcript
        .into_iter()
        .filter(|entry| !js::truthy_opt(entry.get("isSidechain")))
        .collect();
    if main.is_empty() {
        return Err(no_messages());
    }
    if let Some(up_to) = options
        .up_to_message_id
        .as_deref()
        .filter(|id| !id.is_empty())
    {
        let Some(index) = main.iter().position(|entry| uuid_of(entry) == up_to) else {
            return Err(AgentError::new(format!(
                "Message {up_to} not found in session {session_id}"
            )));
        };
        main.truncate(index + 1);
    }
    let fresh: HashMap<String, String> = main
        .iter()
        .map(|entry| (uuid_of(entry), uuid::Uuid::new_v4().to_string()))
        .collect();
    let by_id: HashMap<String, &Value> = main.iter().map(|entry| (uuid_of(entry), entry)).collect();
    let kept: Vec<&Value> = main
        .iter()
        .filter(|entry| entry.get("type").and_then(Value::as_str) != Some("progress"))
        .collect();
    if kept.is_empty() {
        return Err(no_messages());
    }
    let forked = uuid::Uuid::new_v4().to_string();
    let now = js::now_iso();
    let mut entries = Vec::new();
    for (index, entry) in kept.iter().enumerate() {
        let mut parent = Value::Null;
        let mut cursor = text_field(entry, "parentUuid").map(str::to_string);
        while let Some(id) = cursor {
            let Some(ancestor) = by_id.get(&id) else {
                break;
            };
            if ancestor.get("type").and_then(Value::as_str) != Some("progress") {
                parent = fresh.get(&id).cloned().map_or(Value::Null, Value::from);
                break;
            }
            cursor = text_field(ancestor, "parentUuid").map(str::to_string);
        }
        let mut copy = entry.as_object().cloned().unwrap_or_default();
        copy.insert("uuid".into(), json!(fresh.get(&uuid_of(entry))));
        copy.insert("parentUuid".into(), parent);
        match entry.get("logicalParentUuid") {
            None => {
                copy.shift_remove("logicalParentUuid");
            }
            Some(Value::Null) => {
                copy.insert("logicalParentUuid".into(), Value::Null);
            }
            Some(logical) => {
                let mapped = fresh
                    .get(&js::to_js_string(Some(logical)))
                    .cloned()
                    .map_or(Value::Null, Value::from);
                copy.insert("logicalParentUuid".into(), mapped);
            }
        }
        copy.insert("sessionId".into(), json!(forked));
        if index == kept.len() - 1 {
            copy.insert("timestamp".into(), json!(now));
        } else if let Some(timestamp) = entry.get("timestamp") {
            copy.insert("timestamp".into(), timestamp.clone());
        } else {
            copy.shift_remove("timestamp");
        }
        copy.insert("isSidechain".into(), json!(false));
        for key in [
            "teamName",
            "agentName",
            "sessionKind",
            "slug",
            "sourceToolAssistantUUID",
        ] {
            copy.shift_remove(key);
        }
        copy.insert(
            "forkedFrom".into(),
            json!({ "sessionId": session_id, "messageUuid": uuid_of(entry) }),
        );
        entries.push(Value::Object(copy));
    }
    if !replacements.is_empty() {
        entries.push(json!({
            "type": "content-replacement",
            "sessionId": forked,
            "replacements": replacements,
            "uuid": uuid::Uuid::new_v4().to_string(),
            "timestamp": now,
        }));
    }
    let title = options
        .title
        .as_deref()
        .map(js::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let head = String::from_utf8_lossy(&bytes[..bytes.len().min(LITE_READ_BYTES as usize)])
                .into_owned();
            let tail = String::from_utf8_lossy(
                &bytes[bytes.len().saturating_sub(LITE_READ_BYTES as usize)..],
            )
            .into_owned();
            let source = non_empty(last_string_field(&tail, "customTitle"))
                .or_else(|| non_empty(last_string_field(&head, "customTitle")))
                .or_else(|| non_empty(last_string_field(&tail, "aiTitle")))
                .or_else(|| non_empty(last_string_field(&head, "aiTitle")))
                .or_else(|| non_empty(Some(first_prompt(&head))))
                .unwrap_or_else(|| "Forked session".into());
            format!("{source} (fork)")
        });
    entries.push(json!({
        "type": "custom-title",
        "sessionId": forked,
        "customTitle": title,
        "uuid": uuid::Uuid::new_v4().to_string(),
        "timestamp": now,
    }));
    Ok((entries, forked))
}
