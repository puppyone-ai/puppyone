//! Snapshot references off the UI thread, enforcing count/type/byte limits before dispatch.
use crate::agent::domain::reference_input::{Reference, ReferenceContent};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{io::Read, path::PathBuf};
pub fn stage(paths: Vec<PathBuf>) -> Result<Vec<Reference>, String> {
    if paths.len() > 32 {
        return Err("Choose at most 32 references".into());
    }
    let mut total = 0;
    let mut out = Vec::new();
    for path in paths {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let content;
        let bytes;
        if path.is_dir() {
            let mut names = std::fs::read_dir(&path)
                .map_err(|e| e.to_string())?
                .take(201)
                .filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            names.sort();
            let truncated = names.len() > 200;
            names.truncate(200);
            let text = format!(
                "Directory {}\n{}{}",
                path.display(),
                names.join("\n"),
                if truncated {
                    "\n[More entries omitted]"
                } else {
                    ""
                }
            );
            bytes = text.len();
            content = ReferenceContent::Text(text);
        } else {
            let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            let metadata = file.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.len() > 8 * 1024 * 1024 {
                return Err(format!("{name}: expected a regular file up to 8 MiB"));
            }
            let mut data = Vec::new();
            file.by_ref()
                .take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut data)
                .map_err(|e| e.to_string())?;
            bytes = data.len();
            if bytes > 8 * 1024 * 1024 {
                return Err(format!("{name}: file grew beyond the size limit"));
            }
            let mime = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                Some("image/png")
            } else if data.starts_with(&[255, 216, 255]) {
                Some("image/jpeg")
            } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
                Some("image/gif")
            } else if data.len() > 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
                Some("image/webp")
            } else {
                None
            };
            content = if let Some(mime) = mime {
                ReferenceContent::Image {
                    mime: mime.into(),
                    data: STANDARD.encode(data),
                }
            } else {
                if bytes > 1024 * 1024 {
                    return Err(format!("{name}: text references are limited to 1 MiB"));
                }
                let text = String::from_utf8(data)
                    .map_err(|_| format!("{name}: this runtime accepts UTF-8 text and images"))?;
                if text.contains('\0') {
                    return Err(format!("{name}: binary files are not accepted"));
                }
                ReferenceContent::Text(text)
            };
        }
        total += bytes;
        if total > 16 * 1024 * 1024 {
            return Err("References exceed 16 MiB in total".into());
        }
        out.push(Reference {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            source: path.to_string_lossy().into_owned(),
            content,
            bytes,
        });
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_are_immutable_and_binary_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "before").unwrap();
        let refs = stage(vec![path.clone()]).unwrap();
        std::fs::write(&path, "after").unwrap();
        assert!(matches!(&refs[0].content,ReferenceContent::Text(s) if s=="before"));
        std::fs::write(&path, [0, 1, 2]).unwrap();
        assert!(stage(vec![path]).is_err());
    }
}
