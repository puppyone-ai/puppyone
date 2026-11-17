//! Git's NUL-framed log protocol. File names are fields, never lines or rename
//! expressions; the only stripped newlines are Git's separators before a row.
use super::{CommitChange, CommitSummary, Status};
use std::collections::HashMap;
type Fields<'a> = std::iter::Peekable<std::str::Split<'a, char>>;
fn oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn record<'a>(fields: &mut Fields<'a>) -> Option<&'a str> {
    loop {
        let value = fields.peek()?.trim_start_matches('\n');
        if !value.is_empty() {
            return Some(value);
        }
        fields.next();
    }
}
fn field<'a>(fields: &mut Fields<'a>) -> Result<&'a str, String> {
    fields
        .next()
        .ok_or_else(|| "Truncated Git history field".into())
}
fn path(fields: &mut Fields<'_>) -> Result<String, String> {
    let value = field(fields)?;
    if value.is_empty() {
        return Err("Missing Git history path".into());
    }
    Ok(value.into())
}
fn count(value: &str) -> Result<Option<u32>, String> {
    if value == "-" {
        Ok(None)
    } else {
        value
            .parse()
            .map(Some)
            .map_err(|_| "Invalid Git history line count".into())
    }
}
fn names(code: &str, fields: &mut Fields<'_>) -> Result<CommitChange, String> {
    let kind = code
        .as_bytes()
        .first()
        .ok_or("Missing Git history status")?;
    let status = match kind {
        b'A' => Status::Added,
        b'D' => Status::Deleted,
        b'M' => Status::Modified,
        b'R' => Status::Renamed,
        b'C' => Status::Copied,
        b'T' | b'U' | b'X' | b'B' => Status::Changed,
        _ => return Err("Invalid Git history status".into()),
    };
    let paired = matches!(kind, b'R' | b'C');
    if paired {
        if !code[1..].parse::<u8>().is_ok_and(|score| score <= 100) {
            return Err("Invalid Git history rename score".into());
        }
    } else if code.len() != 1 {
        return Err("Invalid Git history status".into());
    }
    let first = path(fields)?;
    let (path, old_path) = if paired {
        (path(fields)?, Some(first))
    } else {
        (first, None)
    };
    Ok(CommitChange {
        path,
        old_path,
        status,
        additions: None,
        deletions: None,
    })
}
fn stats(row: &str, fields: &mut Fields<'_>) -> Result<CommitChange, String> {
    let mut parts = row.splitn(3, '\t');
    let additions = count(parts.next().ok_or("Missing Git history additions")?)?;
    let deletions = count(parts.next().ok_or("Missing Git history deletions")?)?;
    let name = parts.next().ok_or("Missing Git history numstat path")?;
    // -z represents a rename with an empty third field, followed by two
    // standalone path fields. Literal " => " and braces have no syntax here.
    let (path, old_path) = if name.is_empty() {
        let old = path(fields)?;
        (path(fields)?, Some(old))
    } else {
        (name.into(), None)
    };
    Ok(CommitChange {
        path,
        old_path,
        status: Status::Changed,
        additions,
        deletions,
    })
}
fn read(output: &str, numstat: bool) -> Result<Vec<CommitSummary>, String> {
    if !output.is_empty() && !output.ends_with('\0') {
        return Err("Truncated Git history stream".into());
    }
    let mut fields = output.split('\0').peekable();
    let mut commits = vec![];
    while let Some(id) = record(&mut fields) {
        if !oid(id) {
            return Err("Invalid Git history commit boundary".into());
        }
        fields.next();
        let parents = field(&mut fields)?
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        let author = field(&mut fields)?;
        let email = field(&mut fields)?;
        let date = field(&mut fields)?;
        let message = field(&mut fields)?;
        let mut changes = vec![];
        while let Some(row) = record(&mut fields) {
            if oid(row) {
                break;
            }
            fields.next();
            changes.push(if numstat {
                stats(row, &mut fields)?
            } else {
                names(row, &mut fields)?
            });
        }
        commits.push(CommitSummary {
            id: id.into(),
            parents,
            author_name: if author.is_empty() {
                "Unknown".into()
            } else {
                author.into()
            },
            author_email: email.into(),
            created_at: (!date.is_empty()).then(|| date.into()),
            message: if message.is_empty() {
                "(no message)".into()
            } else {
                message.into()
            },
            changes,
        });
    }
    Ok(commits)
}

pub(super) fn parse(names: &str, numstat: &str) -> Result<Vec<CommitSummary>, String> {
    let mut stats: HashMap<_, _> = read(numstat, true)?
        .into_iter()
        .map(|c| (c.id, c.changes))
        .collect();
    let mut commits = read(names, false)?;
    for commit in &mut commits {
        let rows = stats
            .remove(&commit.id)
            .ok_or("Missing Git history statistics for commit")?;
        let by_path: HashMap<_, _> = rows
            .iter()
            .enumerate()
            .map(|(i, c)| (c.path.as_str(), i))
            .collect();
        if by_path.len() != rows.len() {
            return Err("Duplicate Git history statistics path".into());
        }
        let mut used = vec![false; rows.len()];
        for change in &mut commit.changes {
            if let Some(&index) = by_path.get(change.path.as_str()) {
                change.additions = rows[index].additions;
                change.deletions = rows[index].deletions;
                used[index] = true;
            }
        }
        commit.changes.extend(
            rows.into_iter()
                .enumerate()
                .filter_map(|(i, c)| (!used[i]).then_some(c)),
        );
    }
    if !stats.is_empty() {
        return Err("Git history statistics refer to another snapshot".into());
    }
    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_frames_counts_and_snapshot_mismatches_are_rejected() {
        let head = format!(
            "\0{}\0\0Fixture\0fixture@example.invalid\02026-11-17T00:00:00Z\0Subject\0\0",
            "a".repeat(40)
        );
        let names = format!("{head}\nA\0file.txt\0");
        let stats = format!("{head}\n1\t0\tfile.txt\0");
        assert!(parse(&names, &stats).is_ok());
        for broken in [
            "\0bad-id\0".into(),
            format!("\0{}\0", "a".repeat(40)),
            format!("{head}\nA\0"),
            format!("{head}\nR100\0old.txt\0"),
            format!("{head}\nR255\0old.txt\0new.txt\0"),
            format!("{head}\nZ\0file.txt\0"),
            names.trim_end_matches('\0').into(),
        ] {
            assert!(
                parse(&broken, &stats).is_err(),
                "accepted names: {broken:?}"
            );
        }
        for broken in [
            format!("{head}\nnope\t0\tfile.txt\0"),
            format!("{head}\n4294967296\t0\tfile.txt\0"),
            format!("{head}\n1\t0\t\0old.txt\0"),
            format!("{stats}1\t0\tfile.txt\0"),
            stats.replace(&"a".repeat(40), &"b".repeat(40)),
            String::new(),
        ] {
            assert!(
                parse(&names, &broken).is_err(),
                "accepted stats: {broken:?}"
            );
        }
    }
}
