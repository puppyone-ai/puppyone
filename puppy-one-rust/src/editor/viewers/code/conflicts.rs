//! `conflictMarkers.ts` + `ConflictMarkerBanner`: Git conflict blocks in a
//! text/code document, with keep-current / keep-incoming for all blocks or
//! one block. Resolution is an ordinary local edit (undoable, saved by the
//! document session); a read-only document shows the banner without actions.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub start: usize,
    pub end: usize,
    pub ours: String,
    pub theirs: String,
    pub ours_label: String,
    pub theirs_label: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Ours,
    Theirs,
}

fn open_label(line: &str) -> Option<&str> {
    line.strip_prefix("<<<<<<<").map(str::trim)
}
fn close_label(line: &str) -> Option<&str> {
    line.strip_prefix(">>>>>>>").map(str::trim)
}
fn separator(line: &str) -> bool {
    line.strip_prefix("=======")
        .is_some_and(|rest| rest.trim().is_empty())
}

/// `parseConflictMarkers`.
pub fn parse(content: &str) -> Vec<Block> {
    if !content.contains("<<<<<<<") {
        return vec![];
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let mut blocks = vec![];
    let mut index = 0;
    while index < lines.len() {
        let Some(ours_label) = open_label(lines[index]) else {
            index += 1;
            continue;
        };
        let (mut sep, mut end, mut theirs_label) = (None, None, "");
        for (cursor, line) in lines.iter().enumerate().skip(index + 1) {
            if sep.is_none() && separator(line) {
                sep = Some(cursor);
                continue;
            }
            if sep.is_some()
                && let Some(label) = close_label(line)
            {
                end = Some(cursor);
                theirs_label = label;
                break;
            }
        }
        let (Some(sep), Some(end)) = (sep, end) else {
            index += 1;
            continue;
        };
        blocks.push(Block {
            start: index,
            end,
            ours: lines[index + 1..sep].join("\n"),
            theirs: lines[sep + 1..end].join("\n"),
            ours_label: ours_label.into(),
            theirs_label: theirs_label.into(),
        });
        index = end + 1;
    }
    blocks
}

/// `resolveConflictMarkers`: `pick` returns the replacement of each block.
pub fn resolve(content: &str, pick: impl Fn(usize, &Block) -> String) -> String {
    let blocks = parse(content);
    if blocks.is_empty() {
        return content.into();
    }
    let mut lines: Vec<String> = content.split('\n').map(Into::into).collect();
    for (i, block) in blocks.iter().enumerate().rev() {
        let replacement = pick(i, block);
        let mut replacement: Vec<String> = replacement.split('\n').map(Into::into).collect();
        if replacement.last().is_some_and(String::is_empty) {
            replacement.pop();
        }
        lines.splice(block.start..=block.end, replacement);
    }
    lines.join("\n")
}
pub fn resolve_all(content: &str, side: Side) -> String {
    resolve(content, |_, b| match side {
        Side::Ours => b.ours.clone(),
        Side::Theirs => b.theirs.clone(),
    })
}
/// `pickOne`: the chosen side for `index`, the current side for the others.
pub fn resolve_one(content: &str, index: usize, side: Side) -> String {
    resolve(content, |i, b| {
        if i == index && side == Side::Theirs {
            b.theirs.clone()
        } else {
            b.ours.clone()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const DOC: &str = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb\n<<<<<<<\nx\n=======\ny\n>>>>>>>\nc";

    #[test]
    fn blocks_parse_with_labels_and_incomplete_markers_are_ignored() {
        let blocks = parse(DOC);
        assert_eq!(blocks.len(), 2);
        assert_eq!((blocks[0].start, blocks[0].end), (1, 5));
        assert_eq!(
            (blocks[0].ours.as_str(), blocks[0].theirs.as_str()),
            ("mine", "theirs")
        );
        assert_eq!(
            (
                blocks[0].ours_label.as_str(),
                blocks[0].theirs_label.as_str()
            ),
            ("HEAD", "feature")
        );
        assert_eq!(blocks[1].ours_label, "");
        assert!(parse("<<<<<<< HEAD\nno separator\n").is_empty());
        assert!(parse("plain").is_empty());
    }

    #[test]
    fn resolving_keeps_one_side_for_all_or_one_block() {
        assert_eq!(resolve_all(DOC, Side::Ours), "a\nmine\nb\nx\nc");
        assert_eq!(resolve_all(DOC, Side::Theirs), "a\ntheirs\nb\ny\nc");
        assert_eq!(resolve_one(DOC, 1, Side::Theirs), "a\nmine\nb\ny\nc");
        assert_eq!(
            resolve_all("q\n<<<<<<<\n\n=======\nz\n>>>>>>>", Side::Ours),
            "q"
        );
    }
}
