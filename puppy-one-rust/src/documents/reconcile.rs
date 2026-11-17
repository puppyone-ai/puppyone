//! Line/span-based 3-way text merge and minimal UTF-16 diff hunks (`DP-01`–`DP-05`, `DP-50`).
//!
//! Pure text reconciliation with zero UI or I/O dependencies:
//! - Lossless line tokenization (`split_inclusive('\n')`) so trailing-newline
//!   edits are represented faithfully without ever dropping or inventing `\n`.
//! - Myers $O((N+M)D)$ shortest-edit-script line diff with common prefix/suffix
//!   trimming, 64-bit line hashes, and a bounded `MAX_DIFF_DISTANCE` fallback so
//!   adversarial inputs remain linear and never panic.
//! - Connected-component hunk reconciliation:
//!   - `ours == base` (or `ours == theirs`) -> [`ReconcileResult::CleanTheirs`].
//!   - Non-overlapping (or converged identical) hunks -> [`ReconcileResult::MergedClean`]
//!     preserving all edits from both `ours` and `theirs` on both local and hosted
//!     workspaces (`DP-01`, `DP-05`).
//!   - Overlapping diverging hunks -> [`ReconcileResult::Overlapping`], resolved
//!     by [`reconcile_workspace`] to [`WorkspaceReconcile::MergedLocalOverwritten`]
//!     on local workspaces (`DP-04`: disk wins on overlapping hunks, non-overlapping
//!     `ours` hunks preserved) or [`WorkspaceReconcile::ConflictPending`] on hosted
//!     workspaces (`DP-05`: baseline deferred, 4 conflict exits surfaced).

use std::ops::Range;

/// Maximum Myers edit distance before falling back to a single replacement hunk
/// over the trimmed middle region (prevents $O(N^2)$ work on huge unrelated files).
const MAX_DIFF_DISTANCE: usize = 2048;

/// One diverging overlap region between `base -> ours` and `base -> theirs`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConflictHunk {
    pub base_lines: Range<usize>,
    pub ours: String,
    pub theirs: String,
}

/// Workspace-neutral result of [`merge_three_way`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReconcileResult {
    /// `ours == base` or `ours == theirs`: `theirs` is already authoritative and
    /// no unmerged local edits remain.
    CleanTheirs { text: String },
    /// Every hunk between `base -> ours` and `base -> theirs` was disjoint (or
    /// both sides made the exact same edit). Includes all changes from both sides.
    MergedClean {
        text: String,
        had_local_unmerged: bool,
    },
    /// At least one hunk overlapped with diverging content. `local_merged` holds
    /// the `DP-04` resolution (`theirs` on overlapping clusters, `ours` preserved
    /// on all non-overlapping hunks).
    Overlapping {
        local_merged: String,
        had_local_unmerged: bool,
        conflicts: Vec<ConflictHunk>,
    },
}

/// Workspace-aware reconciliation decision (`DP-01`, `DP-04`, `DP-05`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkspaceReconcile {
    /// Clean adoption of `theirs` (no local edits to write back).
    CleanTheirs { text: String },
    /// Clean 3-way merge of non-overlapping edits from `ours` and `theirs`.
    MergedClean {
        text: String,
        had_local_unmerged: bool,
    },
    /// Local workspace (`DP-04`): overlapping hunks took `theirs` while
    /// non-overlapping `ours` hunks were preserved; undoable in one `⌘Z` step.
    MergedLocalOverwritten {
        text: String,
        had_local_unmerged: bool,
    },
    /// Hosted/Cloud workspace (`DP-05`): overlapping hunks defer the remote
    /// baseline and surface the 4 conflict resolution exits.
    ConflictPending {
        base: String,
        ours: String,
        theirs: String,
        remote_version: Option<String>,
    },
}

/// One row of a read-only unified conflict diff preview (`Compare` exit in `DP-05`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiffRow {
    Context(String),
    Ours(String),
    Theirs(String),
}

#[derive(Clone, Copy)]
struct HashedLine<'a> {
    hash: u64,
    text: &'a str,
}

impl PartialEq for HashedLine<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.hash == other.hash && self.text == other.text
    }
}
impl Eq for HashedLine<'_> {}

#[inline]
fn hash_str(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in s.as_bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Splits `text` into line slices preserving each line's trailing `\n` so
/// concatenating all slices reproduces `text` byte-for-byte for every input.
pub fn split_lines_lossless(text: &str) -> Vec<&str> {
    if text.is_empty() {
        Vec::new()
    } else {
        text.split_inclusive('\n').collect()
    }
}

fn hashed_lines(text: &str) -> Vec<HashedLine<'_>> {
    split_lines_lossless(text)
        .into_iter()
        .map(|line| HashedLine {
            hash: hash_str(line),
            text: line,
        })
        .collect()
}

/// One contiguous edit hunk replacing `base[base_range]` with `replacement`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineHunk<'a> {
    pub base_range: Range<usize>,
    pub replacement: Vec<&'a str>,
}

/// Computes minimal line diff hunks turning `base` into `target` via Myers'
/// $O((N+M)D)$ algorithm.
pub fn diff_line_hunks<'b>(base: &str, target: &'b str) -> Vec<LineHunk<'b>> {
    if base == target {
        return Vec::new();
    }
    let a = hashed_lines(base);
    let b = hashed_lines(target);
    diff_hashed_hunks(&a, &b)
}

fn diff_hashed_hunks<'b>(a: &[HashedLine<'_>], b: &[HashedLine<'b>]) -> Vec<LineHunk<'b>> {
    let mut prefix = 0usize;
    let max_prefix = a.len().min(b.len());
    while prefix < max_prefix && a[prefix] == b[prefix] {
        prefix += 1;
    }
    if prefix == a.len() && prefix == b.len() {
        return Vec::new();
    }

    let mut suffix = 0usize;
    let max_suffix = (a.len() - prefix).min(b.len() - prefix);
    while suffix < max_suffix && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix] {
        suffix += 1;
    }

    let a_mid = &a[prefix..a.len() - suffix];
    let b_mid = &b[prefix..b.len() - suffix];
    if a_mid.is_empty() {
        return vec![LineHunk {
            base_range: prefix..prefix,
            replacement: b_mid.iter().map(|l| l.text).collect(),
        }];
    }
    if b_mid.is_empty() {
        return vec![LineHunk {
            base_range: prefix..prefix + a_mid.len(),
            replacement: Vec::new(),
        }];
    }

    let Some(matches) = myers_matches(a_mid, b_mid) else {
        return vec![LineHunk {
            base_range: prefix..prefix + a_mid.len(),
            replacement: b_mid.iter().map(|l| l.text).collect(),
        }];
    };

    let mut hunks = Vec::new();
    let mut ai = 0usize;
    let mut bi = 0usize;
    for (ma, mb, len) in matches {
        if ai < ma || bi < mb {
            hunks.push(LineHunk {
                base_range: (prefix + ai)..(prefix + ma),
                replacement: b_mid[bi..mb].iter().map(|l| l.text).collect(),
            });
        }
        ai = ma + len;
        bi = mb + len;
    }
    if ai < a_mid.len() || bi < b_mid.len() {
        hunks.push(LineHunk {
            base_range: (prefix + ai)..(prefix + a_mid.len()),
            replacement: b_mid[bi..].iter().map(|l| l.text).collect(),
        });
    }
    hunks
}

/// Returns matching diagonal snakes `(a_idx, b_idx, len)` in ascending order,
/// or `None` when edit distance exceeds [`MAX_DIFF_DISTANCE`].
fn myers_matches(a: &[HashedLine<'_>], b: &[HashedLine<'_>]) -> Option<Vec<(usize, usize, usize)>> {
    let n = a.len();
    let m = b.len();
    let max_d = (n + m).min(MAX_DIFF_DISTANCE);
    let offset = max_d + 1;
    let size = 2 * offset + 2;
    let mut v = vec![0usize; size];
    let mut trace: Vec<Vec<usize>> = Vec::new();
    let mut found_d = None;

    'outer: for d in 0..=max_d {
        trace.push(v.clone());
        let mut k = -(d as isize);
        while k <= d as isize {
            let idx = (k + offset as isize) as usize;
            let mut x = if k == -(d as isize) || (k != d as isize && v[idx - 1] < v[idx + 1]) {
                v[idx + 1]
            } else {
                v[idx - 1] + 1
            };
            let mut y = (x as isize - k) as usize;
            while x < n && y < m && a[x] == b[y] {
                x += 1;
                y += 1;
            }
            v[idx] = x;
            if x >= n && y >= m {
                found_d = Some(d);
                break 'outer;
            }
            k += 2;
        }
    }

    let final_d = found_d?;
    let mut snakes = Vec::new();
    let mut x = n;
    let mut y = m;

    for d in (1..=final_d).rev() {
        let prev_v = &trace[d];
        let k = x as isize - y as isize;
        let idx = (k + offset as isize) as usize;
        let prev_k = if k == -(d as isize) || (k != d as isize && prev_v[idx - 1] < prev_v[idx + 1])
        {
            k + 1
        } else {
            k - 1
        };
        let prev_x = prev_v[(prev_k + offset as isize) as usize];
        let prev_y = (prev_x as isize - prev_k) as usize;

        let mut end_x = x;
        while x > prev_x && y > prev_y && a[x - 1] == b[y - 1] {
            x -= 1;
            y -= 1;
        }
        let diag_len = end_x - x;
        if diag_len > 0 {
            snakes.push((x, y, diag_len));
        }
        end_x = prev_x;
        let _ = end_x;
        x = prev_x;
        y = prev_y;
    }

    if x > 0 && y > 0 {
        snakes.push((0, 0, x));
    }

    snakes.reverse();
    Some(snakes)
}

/// True when hunk `a` and hunk `b` overlap or collide at the exact same pure
/// insertion boundary.
///
/// Adjacent non-empty line replacements (`0..1` and `1..2`) or an insertion
/// immediately before/after a replacement (`1..1` and `1..2`, or `0..1` and
/// `1..1`) do NOT overlap and have a strict total order by `(start, end)`.
#[inline]
pub fn hunks_overlap(a: &Range<usize>, b: &Range<usize>) -> bool {
    match (a.is_empty(), b.is_empty()) {
        (true, true) => a.start == b.start,
        (true, false) => b.start < a.start && a.start < b.end,
        (false, true) => a.start < b.start && b.start < a.end,
        (false, false) => a.start < b.end && b.start < a.end,
    }
}

fn render_hunk_slice(base_lines: &[&str], span: Range<usize>, hunks: &[LineHunk<'_>]) -> String {
    let mut out = String::new();
    let mut cursor = span.start;
    for hunk in hunks {
        for &line in &base_lines[cursor..hunk.base_range.start] {
            out.push_str(line);
        }
        for &line in &hunk.replacement {
            out.push_str(line);
        }
        cursor = hunk.base_range.end;
    }
    for &line in &base_lines[cursor..span.end] {
        out.push_str(line);
    }
    out
}

/// Line/span-based 3-way text merge (`DP-01`, `DP-04`, `DP-05`).
pub fn merge_three_way(base: &str, ours: &str, theirs: &str) -> ReconcileResult {
    if ours == base || ours == theirs {
        return ReconcileResult::CleanTheirs {
            text: theirs.to_owned(),
        };
    }
    if theirs == base {
        return ReconcileResult::MergedClean {
            text: ours.to_owned(),
            had_local_unmerged: true,
        };
    }

    let base_lines = split_lines_lossless(base);
    let ours_hunks = diff_line_hunks(base, ours);
    let theirs_hunks = diff_line_hunks(base, theirs);

    let mut out = String::with_capacity(ours.len().max(theirs.len()));
    let mut conflicts = Vec::new();
    let mut cursor = 0usize;
    let mut oi = 0usize;
    let mut ti = 0usize;

    while oi < ours_hunks.len() || ti < theirs_hunks.len() {
        match (ours_hunks.get(oi), theirs_hunks.get(ti)) {
            (Some(oh), None) => {
                for &line in &base_lines[cursor..oh.base_range.start] {
                    out.push_str(line);
                }
                for &line in &oh.replacement {
                    out.push_str(line);
                }
                cursor = oh.base_range.end;
                oi += 1;
            }
            (None, Some(th)) => {
                for &line in &base_lines[cursor..th.base_range.start] {
                    out.push_str(line);
                }
                for &line in &th.replacement {
                    out.push_str(line);
                }
                cursor = th.base_range.end;
                ti += 1;
            }
            (Some(oh), Some(th)) => {
                if !hunks_overlap(&oh.base_range, &th.base_range) {
                    if (oh.base_range.start, oh.base_range.end)
                        < (th.base_range.start, th.base_range.end)
                    {
                        for &line in &base_lines[cursor..oh.base_range.start] {
                            out.push_str(line);
                        }
                        for &line in &oh.replacement {
                            out.push_str(line);
                        }
                        cursor = oh.base_range.end;
                        oi += 1;
                    } else {
                        for &line in &base_lines[cursor..th.base_range.start] {
                            out.push_str(line);
                        }
                        for &line in &th.replacement {
                            out.push_str(line);
                        }
                        cursor = th.base_range.end;
                        ti += 1;
                    }
                } else {
                    // Expand connected overlap cluster across transitive overlaps.
                    let o_start = oi;
                    let t_start = ti;
                    let mut cluster_start = oh.base_range.start.min(th.base_range.start);
                    let mut cluster_end = oh.base_range.end.max(th.base_range.end);
                    let mut o_end = oi + 1;
                    let mut t_end = ti + 1;

                    loop {
                        let mut grew = false;
                        while let Some(next_o) = ours_hunks.get(o_end) {
                            let overlaps_cluster = theirs_hunks[t_start..t_end]
                                .iter()
                                .any(|t| hunks_overlap(&next_o.base_range, &t.base_range));
                            if overlaps_cluster {
                                cluster_start = cluster_start.min(next_o.base_range.start);
                                cluster_end = cluster_end.max(next_o.base_range.end);
                                o_end += 1;
                                grew = true;
                            } else {
                                break;
                            }
                        }
                        while let Some(next_t) = theirs_hunks.get(t_end) {
                            let overlaps_cluster = ours_hunks[o_start..o_end]
                                .iter()
                                .any(|o| hunks_overlap(&o.base_range, &next_t.base_range));
                            if overlaps_cluster {
                                cluster_start = cluster_start.min(next_t.base_range.start);
                                cluster_end = cluster_end.max(next_t.base_range.end);
                                t_end += 1;
                                grew = true;
                            } else {
                                break;
                            }
                        }
                        if !grew {
                            break;
                        }
                    }

                    for &line in &base_lines[cursor..cluster_start] {
                        out.push_str(line);
                    }

                    let ours_slice = render_hunk_slice(
                        &base_lines,
                        cluster_start..cluster_end,
                        &ours_hunks[o_start..o_end],
                    );
                    let theirs_slice = render_hunk_slice(
                        &base_lines,
                        cluster_start..cluster_end,
                        &theirs_hunks[t_start..t_end],
                    );

                    // `DP-04`: on overlapping hunks, disk (`theirs`) wins; if both
                    // sides made the exact same change, it is a clean convergence!
                    out.push_str(&theirs_slice);
                    if ours_slice != theirs_slice {
                        conflicts.push(ConflictHunk {
                            base_lines: cluster_start..cluster_end,
                            ours: ours_slice,
                            theirs: theirs_slice,
                        });
                    }

                    cursor = cluster_end;
                    oi = o_end;
                    ti = t_end;
                }
            }
            (None, None) => unreachable!(),
        }
    }

    for &line in &base_lines[cursor..] {
        out.push_str(line);
    }

    let had_local_unmerged = out != theirs;
    if conflicts.is_empty() {
        if !had_local_unmerged {
            ReconcileResult::CleanTheirs { text: out }
        } else {
            ReconcileResult::MergedClean {
                text: out,
                had_local_unmerged,
            }
        }
    } else {
        ReconcileResult::Overlapping {
            local_merged: out,
            had_local_unmerged,
            conflicts,
        }
    }
}

/// Applies workspace policy (`DP-04` local disk-wins vs `DP-05` hosted deferred
/// 4-exit conflict) to [`merge_three_way`].
pub fn reconcile_workspace(
    base: &str,
    ours: &str,
    theirs: &str,
    hosted: bool,
    remote_version: Option<String>,
) -> WorkspaceReconcile {
    match merge_three_way(base, ours, theirs) {
        ReconcileResult::CleanTheirs { text } => WorkspaceReconcile::CleanTheirs { text },
        ReconcileResult::MergedClean {
            text,
            had_local_unmerged,
        } => WorkspaceReconcile::MergedClean {
            text,
            had_local_unmerged,
        },
        ReconcileResult::Overlapping {
            local_merged,
            had_local_unmerged,
            ..
        } => {
            if hosted {
                WorkspaceReconcile::ConflictPending {
                    base: base.to_owned(),
                    ours: ours.to_owned(),
                    theirs: theirs.to_owned(),
                    remote_version,
                }
            } else {
                WorkspaceReconcile::MergedLocalOverwritten {
                    text: local_merged,
                    had_local_unmerged,
                }
            }
        }
    }
}

/// Computes ascending, disjoint UTF-16 replacement hunks turning `before` into
/// `after`, trimming intra-hunk common character prefixes and suffixes (`DP-02`).
pub fn minimal_utf16_edits(before: &str, after: &str) -> Vec<(Range<usize>, String)> {
    if before == after {
        return Vec::new();
    }
    let before_lines = split_lines_lossless(before);
    let hunks = diff_line_hunks(before, after);
    if hunks.is_empty() {
        return Vec::new();
    }

    let mut line_utf16_starts = Vec::with_capacity(before_lines.len() + 1);
    let mut acc = 0usize;
    for line in &before_lines {
        line_utf16_starts.push(acc);
        acc += line.encode_utf16().count();
    }
    line_utf16_starts.push(acc);

    let mut edits = Vec::with_capacity(hunks.len());
    for hunk in hunks {
        let old_slice: String = before_lines[hunk.base_range.clone()].concat();
        let new_slice: String = hunk.replacement.concat();
        if old_slice == new_slice {
            continue;
        }

        let base_u16 = line_utf16_starts[hunk.base_range.start];
        // Trim common char prefix and suffix inside the hunk for character-level precision.
        let mut common_prefix_chars = 0usize;
        let mut common_prefix_bytes = 0usize;
        let mut common_prefix_u16 = 0usize;
        for (ca, cb) in old_slice.chars().zip(new_slice.chars()) {
            if ca == cb {
                common_prefix_chars += 1;
                common_prefix_bytes += ca.len_utf8();
                common_prefix_u16 += ca.len_utf16();
            } else {
                break;
            }
        }
        let _ = common_prefix_chars;
        let old_rem = &old_slice[common_prefix_bytes..];
        let new_rem = &new_slice[common_prefix_bytes..];

        let mut common_suffix_bytes = 0usize;
        let mut common_suffix_u16 = 0usize;
        for (ca, cb) in old_rem.chars().rev().zip(new_rem.chars().rev()) {
            if ca == cb {
                common_suffix_bytes += ca.len_utf8();
                common_suffix_u16 += ca.len_utf16();
            } else {
                break;
            }
        }

        let old_total_u16 = line_utf16_starts[hunk.base_range.end] - base_u16;
        let start_u16 = base_u16 + common_prefix_u16;
        let end_u16 = base_u16 + old_total_u16.saturating_sub(common_suffix_u16);
        let replacement = new_rem[..new_rem.len() - common_suffix_bytes].to_owned();
        edits.push((start_u16..end_u16, replacement));
    }
    edits
}

/// Builds a compact read-only unified diff between `ours` and `theirs` for the
/// Cloud conflict `Compare` modal (`DP-05`).
pub fn unified_diff_rows(ours: &str, theirs: &str) -> Vec<DiffRow> {
    let ours_lines = split_lines_lossless(ours);
    let hunks = diff_line_hunks(ours, theirs);
    let mut rows = Vec::new();
    let mut cursor = 0usize;
    let strip_nl = |s: &str| s.strip_suffix('\n').unwrap_or(s).to_owned();

    for hunk in hunks {
        for &line in &ours_lines[cursor..hunk.base_range.start] {
            rows.push(DiffRow::Context(strip_nl(line)));
        }
        for &line in &ours_lines[hunk.base_range.clone()] {
            rows.push(DiffRow::Ours(strip_nl(line)));
        }
        for &line in &hunk.replacement {
            rows.push(DiffRow::Theirs(strip_nl(line)));
        }
        cursor = hunk.base_range.end;
    }
    for &line in &ours_lines[cursor..] {
        rows.push(DiffRow::Context(strip_nl(line)));
    }
    rows
}

/// Computes `<stem> (conflict copy).<ext>` (or `<stem> (conflict copy N).<ext>`
/// when `index > 1`) inside the same directory as `relative` (`DP-05` Exit 4).
pub fn conflict_copy_filename(file_name: &str, index: usize) -> String {
    let suffix = if index <= 1 {
        " (conflict copy)".to_owned()
    } else {
        format!(" (conflict copy {index})")
    };
    let trimmed = file_name.trim();
    if let Some((stem, ext)) = trimmed.rsplit_once('.')
        && !stem.is_empty()
        && !ext.is_empty()
    {
        format!("{stem}{suffix}.{ext}")
    } else {
        format!("{trimmed}{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Lcg(u64);
    impl Lcg {
        fn next_u64(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0
        }
        fn below(&mut self, upper: usize) -> usize {
            if upper == 0 {
                0
            } else {
                (self.next_u64() >> 16) as usize % upper
            }
        }
        fn coin(&mut self) -> bool {
            (self.next_u64() >> 32) & 1 == 1
        }
    }

    fn apply_utf16_edits(text: &str, edits: &[(Range<usize>, String)]) -> String {
        let mut units: Vec<u16> = text.encode_utf16().collect();
        // Verify ascending & disjoint contract first.
        let mut prev_end = 0usize;
        for (range, _) in edits {
            assert!(range.start <= range.end);
            assert!(
                prev_end <= range.start,
                "UTF-16 edits must be ascending and disjoint"
            );
            assert!(range.end <= units.len());
            prev_end = range.end;
        }
        for (range, insert) in edits.iter().rev() {
            let ins: Vec<u16> = insert.encode_utf16().collect();
            units.splice(range.clone(), ins);
        }
        String::from_utf16(&units).expect("valid UTF-16 output")
    }

    #[test]
    fn clean_theirs_when_ours_equals_base_or_converges() {
        assert_eq!(
            merge_three_way("a\nb\n", "a\nb\n", "a\nb_new\n"),
            ReconcileResult::CleanTheirs {
                text: "a\nb_new\n".into()
            }
        );
        assert_eq!(
            merge_three_way("a\nb\n", "same\n", "same\n"),
            ReconcileResult::CleanTheirs {
                text: "same\n".into()
            }
        );
    }

    #[test]
    fn non_overlapping_edits_merge_cleanly_for_local_and_hosted() {
        let base = "# Heading\n\nParagraph 1\n\nParagraph 2\n";
        let ours = "# Heading (Local)\n\nParagraph 1\n\nParagraph 2\n";
        let theirs = "# Heading\n\nParagraph 1\n\nParagraph 2 (Remote)\n";
        let expected = "# Heading (Local)\n\nParagraph 1\n\nParagraph 2 (Remote)\n";

        for hosted in [false, true] {
            assert_eq!(
                reconcile_workspace(base, ours, theirs, hosted, Some("rev-2".into())),
                WorkspaceReconcile::MergedClean {
                    text: expected.into(),
                    had_local_unmerged: true,
                }
            );
        }
    }

    #[test]
    fn overlapping_edits_follow_dp04_locally_and_dp05_on_hosted_while_keeping_disjoint_ours() {
        let base = "L1\nL2\nL3\nL4\n";
        let ours = "L1_ours_disjoint\nL2\nL3_ours_conflict\nL4\n";
        let theirs = "L1\nL2\nL3_theirs_disk\nL4\n";

        // Local (`DP-04`): disk wins on L3, while disjoint L1 edit from `ours` survives!
        assert_eq!(
            reconcile_workspace(base, ours, theirs, false, None),
            WorkspaceReconcile::MergedLocalOverwritten {
                text: "L1_ours_disjoint\nL2\nL3_theirs_disk\nL4\n".into(),
                had_local_unmerged: true,
            }
        );

        // Hosted (`DP-05`): baseline deferred with full conflict context.
        assert_eq!(
            reconcile_workspace(base, ours, theirs, true, Some("etag-9".into())),
            WorkspaceReconcile::ConflictPending {
                base: base.into(),
                ours: ours.into(),
                theirs: theirs.into(),
                remote_version: Some("etag-9".into()),
            }
        );
    }

    #[test]
    fn conflict_copy_naming_handles_extensions_dotfiles_and_indices() {
        assert_eq!(
            conflict_copy_filename("notes.md", 1),
            "notes (conflict copy).md"
        );
        assert_eq!(
            conflict_copy_filename("notes.md", 2),
            "notes (conflict copy 2).md"
        );
        assert_eq!(
            conflict_copy_filename("archive.tar.gz", 1),
            "archive.tar (conflict copy).gz"
        );
        assert_eq!(
            conflict_copy_filename("Makefile", 1),
            "Makefile (conflict copy)"
        );
        assert_eq!(conflict_copy_filename(".env", 1), ".env (conflict copy)");
    }

    /// `DP-50`: deterministic randomized property suite (>= 400 interleaved
    /// `base` / `ours` / `theirs` edit sequences across ASCII, CJK and surrogate
    /// emoji) proving:
    /// 1. `diff_line_hunks` + `minimal_utf16_edits` reconstruct `target` exactly.
    /// 2. Non-overlapping `ours` & `theirs` edits ALWAYS merge cleanly with 100%
    ///    of both sides' edits preserved on both Local and Hosted workspaces.
    /// 3. Overlapping diverging edits NEVER panic, always preserve disjoint `ours`
    ///    hunks while taking `theirs` on overlaps locally (`DP-04`), and always
    ///    yield `ConflictPending` on Hosted (`DP-05`).
    #[test]
    fn dp50_property_random_interleaved_three_way_merge_invariants() {
        let atoms = [
            "alpha",
            "beta 中文",
            "gamma 🐶🚀",
            "delta",
            "",
            "   indented()",
            "| col1 | col2 |",
            "Cafe\u{0301}",
        ];
        let mut rng = Lcg(0x5EED_D050_2026_1117);

        // Part A: 220 strictly disjoint interleaved edit sequences.
        for case in 0..220 {
            let line_count = 4 + rng.below(24);
            let mut base_lines: Vec<String> = (0..line_count)
                .map(|i| format!("base-{case}-{i}:{}\n", atoms[rng.below(atoms.len())]))
                .collect();
            if rng.coin()
                && let Some(last) = base_lines.last_mut()
            {
                // Exercise missing trailing newline too.
                last.pop();
            }

            // Partition base lines into disjoint slots assigned to None, Ours, or Theirs,
            // separated by at least one untouched anchor line when inserting/deleting so
            // Myers cannot align across slots via identical empty lines.
            let mut ours_lines = Vec::new();
            let mut theirs_lines = Vec::new();
            let mut expected_lines = Vec::new();
            let mut i = 0usize;
            while i < base_lines.len() {
                if i % 2 == 1 {
                    // Untouched anchor line keeps hunks unambiguously separated.
                    ours_lines.push(base_lines[i].clone());
                    theirs_lines.push(base_lines[i].clone());
                    expected_lines.push(base_lines[i].clone());
                    i += 1;
                    continue;
                }
                let has_nl = base_lines[i].ends_with('\n');
                let term = if has_nl { "\n" } else { "" };
                match rng.below(4) {
                    0 => {
                        // Unchanged.
                        ours_lines.push(base_lines[i].clone());
                        theirs_lines.push(base_lines[i].clone());
                        expected_lines.push(base_lines[i].clone());
                    }
                    1 => {
                        // Ours modifies (1 or 2 lines, or deletion when trailing newline exists).
                        let rep = if has_nl && rng.below(4) == 0 {
                            String::new()
                        } else if has_nl && rng.coin() {
                            format!(
                                "ours-{case}-{i}-a:{}\nours-{case}-{i}-b:{}\n",
                                atoms[rng.below(atoms.len())],
                                atoms[rng.below(atoms.len())]
                            )
                        } else {
                            format!("ours-{case}-{i}:{}{term}", atoms[rng.below(atoms.len())])
                        };
                        ours_lines.push(rep.clone());
                        theirs_lines.push(base_lines[i].clone());
                        expected_lines.push(rep);
                    }
                    2 => {
                        // Theirs modifies.
                        let rep = if has_nl && rng.below(4) == 0 {
                            String::new()
                        } else if has_nl && rng.coin() {
                            format!(
                                "theirs-{case}-{i}-a:{}\ntheirs-{case}-{i}-b:{}\n",
                                atoms[rng.below(atoms.len())],
                                atoms[rng.below(atoms.len())]
                            )
                        } else {
                            format!("theirs-{case}-{i}:{}{term}", atoms[rng.below(atoms.len())])
                        };
                        ours_lines.push(base_lines[i].clone());
                        theirs_lines.push(rep.clone());
                        expected_lines.push(rep);
                    }
                    _ => {
                        // Both make the exact same converged change!
                        let rep = format!(
                            "converged-{case}-{i}:{}{term}",
                            atoms[rng.below(atoms.len())]
                        );
                        ours_lines.push(rep.clone());
                        theirs_lines.push(rep.clone());
                        expected_lines.push(rep);
                    }
                }
                i += 1;
            }

            let base = base_lines.concat();
            let ours = ours_lines.concat();
            let theirs = theirs_lines.concat();
            let expected = expected_lines.concat();

            let edits = minimal_utf16_edits(&ours, &expected);
            assert_eq!(
                apply_utf16_edits(&ours, &edits),
                expected,
                "UTF-16 diff failed on case {case}"
            );

            let merged = merge_three_way(&base, &ours, &theirs);
            match merged {
                ReconcileResult::CleanTheirs { text } => {
                    assert_eq!(text, expected, "CleanTheirs mismatch on case {case}");
                    assert!(ours == base || ours == theirs || expected == theirs);
                }
                ReconcileResult::MergedClean {
                    text,
                    had_local_unmerged,
                } => {
                    assert_eq!(text, expected, "MergedClean mismatch on case {case}");
                    assert_eq!(had_local_unmerged, expected != theirs);
                }
                ReconcileResult::Overlapping { conflicts, .. } => {
                    panic!(
                        "Disjoint edits produced unexpected conflict on case {case}: {conflicts:?}"
                    );
                }
            }
        }

        // Part B: 220 unrestricted chaotic interleaved sequences (with overlaps,
        // empty documents, multi-line deletions, emoji surrogates, and markers).
        for case in 0..220 {
            let line_count = rng.below(20);
            let base_lines: Vec<String> = (0..line_count)
                .map(|i| format!("L{i}:{}\n", atoms[rng.below(atoms.len())]))
                .collect();
            let base = base_lines.concat();

            let mutate = |rng: &mut Lcg, tag: &str| -> (String, Vec<(usize, String)>) {
                let mut out = Vec::new();
                let mut disjoint_markers = Vec::new();
                for (idx, line) in base_lines.iter().enumerate() {
                    match rng.below(5) {
                        0 => out.push(line.clone()),
                        1 => {
                            let m = format!(
                                "{tag}-unique-{case}-{idx}:{}\n",
                                atoms[rng.below(atoms.len())]
                            );
                            disjoint_markers.push((idx, m.clone()));
                            out.push(m);
                        }
                        2 => {} // delete line
                        3 => {
                            out.push(line.clone());
                            out.push(format!("{tag}-ins-{case}-{idx}:🐶\n"));
                        }
                        _ => out.push(format!("shared-{idx}\n")),
                    }
                }
                if base_lines.is_empty() && rng.coin() {
                    out.push(format!("{tag}-from-empty-{case}\n"));
                }
                (out.concat(), disjoint_markers)
            };

            let (ours, _ours_markers) = mutate(&mut rng, "ours");
            let (theirs, _theirs_markers) = mutate(&mut rng, "theirs");

            // UTF-16 minimal edit roundtrip never panics and always matches `theirs`.
            let u16_edits = minimal_utf16_edits(&ours, &theirs);
            assert_eq!(apply_utf16_edits(&ours, &u16_edits), theirs);

            let local_out = reconcile_workspace(&base, &ours, &theirs, false, None);
            let hosted_out =
                reconcile_workspace(&base, &ours, &theirs, true, Some(format!("v{case}")));

            match (&local_out, &hosted_out) {
                (
                    WorkspaceReconcile::CleanTheirs { text: lt },
                    WorkspaceReconcile::CleanTheirs { text: ht },
                ) => {
                    assert_eq!(lt, &theirs);
                    assert_eq!(ht, &theirs);
                }
                (
                    WorkspaceReconcile::MergedClean {
                        text: lt,
                        had_local_unmerged: lu,
                    },
                    WorkspaceReconcile::MergedClean {
                        text: ht,
                        had_local_unmerged: hu,
                    },
                ) => {
                    assert_eq!(lt, ht);
                    assert_eq!(*lu, lt != &theirs);
                    assert_eq!(*hu, ht != &theirs);
                }
                (
                    WorkspaceReconcile::MergedLocalOverwritten {
                        text: lt,
                        had_local_unmerged,
                    },
                    WorkspaceReconcile::ConflictPending {
                        base: cb,
                        ours: co,
                        theirs: ct,
                        remote_version,
                    },
                ) => {
                    assert_eq!(*had_local_unmerged, lt != &theirs);
                    assert_eq!(cb, &base);
                    assert_eq!(co, &ours);
                    assert_eq!(ct, &theirs);
                    assert_eq!(remote_version.as_deref(), Some(format!("v{case}").as_str()));
                    // Also verify UTF-16 minimal diff from `ours` -> `lt` is exact.
                    let adopt_edits = minimal_utf16_edits(&ours, lt);
                    assert_eq!(&apply_utf16_edits(&ours, &adopt_edits), lt);
                }
                other => panic!("Inconsistent local/hosted outcomes on case {case}: {other:?}"),
            }
        }
    }
}
