//! Format-sniffed tar validation and extraction. The complete stream, including
//! gzip trailers and later members, must validate before any output is created.
use super::{ErrorCode, MAX_EXPANDED, new_file, private};
use std::{
    io::{BufRead as _, Read, Write as _},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

/// `extractActivationArchive`: validate every member, then write them under
/// `directory` without the archive's root (`strip: 1`).
pub fn extract(archive: &Path, directory: &Path, cancel: &AtomicBool) -> Result<(), ErrorCode> {
    let open = || -> Result<tar::Archive<Box<dyn Read>>, ErrorCode> {
        let file = std::fs::File::open(archive).map_err(|_| ErrorCode::Archive)?;
        let mut reader = std::io::BufReader::new(file);
        let gzip = reader
            .fill_buf()
            .map_err(|_| ErrorCode::Archive)?
            .starts_with(&[0x1f, 0x8b]);
        let reader: Box<dyn Read> = if gzip {
            // Node's gzip stream validates every member, including a damaged
            // member after the tar end marker. A single-member decoder would
            // silently accept the first member and miss that failure.
            Box::new(flate2::read::MultiGzDecoder::new(reader))
        } else {
            Box::new(reader)
        };
        Ok(tar::Archive::new(reader))
    };
    let check = || {
        if cancel.load(Ordering::Relaxed) {
            Err(ErrorCode::Interrupted)
        } else {
            Ok(())
        }
    };
    check()?;
    // Pass one: the whole archive must be acceptable.
    let mut names = std::collections::HashSet::new();
    let (mut count, mut bytes, mut root) = (0usize, 0u64, None::<String>);
    let mut reader = open()?;
    for entry in reader.entries().map_err(|_| ErrorCode::Archive)? {
        check()?;
        let entry = entry.map_err(|_| ErrorCode::Archive)?;
        let kind = entry.header().entry_type();
        if kind == tar::EntryType::XGlobalHeader {
            continue;
        }
        let name =
            String::from_utf8(entry.path_bytes().into_owned()).map_err(|_| ErrorCode::Archive)?;
        let name = name.strip_suffix('/').unwrap_or(&name).to_owned();
        let parts: Vec<&str> = name.split('/').collect();
        let first = parts[0].to_owned();
        let root = root.get_or_insert_with(|| first.clone());
        count += 1;
        bytes += entry.size();
        let directory_entry = kind == tar::EntryType::Directory;
        if count > 20_000
            || bytes > MAX_EXPANDED
            || name.encode_utf16().count() > 4096
            || name.contains(['\\', '\0', '\r', '\n', ':'])
            || parts
                .iter()
                .any(|p| p.is_empty() || *p == "." || *p == "..")
            || !(kind == tar::EntryType::Regular || directory_entry)
            || !names.insert(name.clone())
            || first != *root
            || (parts.len() == 1 && !directory_entry)
        {
            return Err(ErrorCode::Archive);
        }
    }
    if count == 0 {
        return Err(ErrorCode::Archive);
    }
    // tar stops at its zero blocks; the gzip checksum/trailer can still be
    // unread. Validate compression to EOF before writing even the first file.
    let mut compression = reader.into_inner();
    let mut tail = [0u8; 64 * 1024];
    loop {
        check()?;
        if compression
            .read(&mut tail)
            .map_err(|_| ErrorCode::Archive)?
            == 0
        {
            break;
        }
    }
    check()?;
    // Pass two: write what was validated.
    let mut reader = open()?;
    for entry in reader.entries().map_err(|_| ErrorCode::Archive)? {
        check()?;
        let mut entry = entry.map_err(|_| ErrorCode::Archive)?;
        let kind = entry.header().entry_type();
        if kind == tar::EntryType::XGlobalHeader {
            continue;
        }
        let name =
            String::from_utf8(entry.path_bytes().into_owned()).map_err(|_| ErrorCode::Archive)?;
        let relative: Vec<&str> = name
            .strip_suffix('/')
            .unwrap_or(&name)
            .split('/')
            .skip(1)
            .collect();
        if relative.is_empty() {
            continue;
        }
        let path = relative
            .iter()
            .fold(directory.to_path_buf(), |p, part| p.join(part));
        if kind == tar::EntryType::Directory {
            std::fs::create_dir_all(&path).map_err(|_| ErrorCode::Archive)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| ErrorCode::Archive)?;
        }
        // The member's mode under the usual 022 umask.
        let mode = entry.header().mode().unwrap_or(0o644) & 0o755;
        let mut file = new_file(&path, mode).map_err(|_| ErrorCode::Archive)?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            check()?;
            let n = entry.read(&mut buffer).map_err(|_| ErrorCode::Archive)?;
            if n == 0 {
                break;
            }
            file.write_all(&buffer[..n])
                .map_err(|_| ErrorCode::Archive)?;
        }
        private(&path, mode);
    }
    Ok(())
}
