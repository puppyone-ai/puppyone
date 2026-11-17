//! Record-level and column-level reconciliation (`CS-10`, `DP-02`, `DP-03`):
//! when Source mode returns to the table or storage delivers external text,
//! unchanged rows and columns keep their `u64` identities, untouched `Arc<Row>`
//! and `Arc<str>` allocations are shared, and the transition records as one
//! incremental undo step on `CsvModel`.
use super::rows::{Row, RowVec, empty_cell};
use std::{collections::HashMap, sync::Arc};

pub struct DiffOutcome {
    pub rows: RowVec,
    pub columns: Vec<u64>,
    pub delta_bytes: usize,
    pub changed: bool,
}

pub fn cell_bytes(s: &str) -> usize {
    16 + s.len() * 2
}

pub fn row_full_bytes(row: &Row) -> usize {
    64 + row.cells.iter().map(|c| cell_bytes(c)).sum::<usize>()
}

fn hash_cells<S: AsRef<str>>(cells: &[S]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for cell in cells {
        for &b in cell.as_ref().as_bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        h ^= 0xff;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn row_matches_cells(old: &Row, cells: &[String]) -> bool {
    old.cells.len() == cells.len()
        && old
            .cells
            .iter()
            .zip(cells)
            .all(|(a, b)| a.as_ref() == b.as_str())
}

fn build_cells_from_strings(cells: Vec<String>) -> Arc<Vec<Arc<str>>> {
    Arc::new(
        cells
            .into_iter()
            .map(|s| {
                if s.is_empty() {
                    empty_cell()
                } else {
                    Arc::from(s.as_str())
                }
            })
            .collect(),
    )
}

fn update_row_in_place(
    old: &Arc<Row>,
    cells: Vec<String>,
    raw: Option<Arc<str>>,
) -> (Arc<Row>, usize, bool) {
    if row_matches_cells(old, &cells) {
        if old.raw == raw && !old.canonical {
            return (Arc::clone(old), 0, false);
        }
        return (
            Arc::new(Row::new(old.id, Arc::clone(&old.cells), raw, false)),
            64,
            true,
        );
    }
    let mut delta = 64 + cells.len() * std::mem::size_of::<Arc<str>>();
    let mut next_cells = Vec::with_capacity(cells.len());
    for (c, text) in cells.into_iter().enumerate() {
        if let Some(prev) = old.cells.get(c)
            && prev.as_ref() == text.as_str()
        {
            next_cells.push(Arc::clone(prev));
        } else {
            if let Some(prev) = old.cells.get(c) {
                delta += cell_bytes(prev);
            }
            delta += cell_bytes(&text);
            let arc = if text.is_empty() {
                empty_cell()
            } else {
                Arc::from(text.as_str())
            };
            next_cells.push(arc);
        }
    }
    if old.cells.len() > next_cells.len() {
        for dropped in &old.cells[next_cells.len()..] {
            delta += cell_bytes(dropped);
        }
    }
    (
        Arc::new(Row::new(old.id, Arc::new(next_cells), raw, false)),
        delta,
        true,
    )
}

/// Longest common subsequence on small slices (`<= 64 × 64`).
fn lcs_pairs<F: Fn(usize, usize) -> bool>(
    old_len: usize,
    new_len: usize,
    eq: F,
) -> Vec<(usize, usize)> {
    let w = new_len + 1;
    let mut dp = vec![0u16; (old_len + 1) * w];
    for i in (0..old_len).rev() {
        for j in (0..new_len).rev() {
            dp[i * w + j] = if eq(i, j) {
                dp[(i + 1) * w + (j + 1)] + 1
            } else {
                dp[(i + 1) * w + j].max(dp[i * w + (j + 1)])
            };
        }
    }
    let mut out = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < old_len && j < new_len {
        if eq(i, j) {
            out.push((i, j));
            i += 1;
            j += 1;
        } else if dp[(i + 1) * w + j] >= dp[i * w + (j + 1)] {
            i += 1;
        } else {
            j += 1;
        }
    }
    out
}

/// Patience-style unique-hash LIS anchors with DP refinement in small gaps.
fn align_rows(old: &[&Arc<Row>], new: &[Vec<String>]) -> Vec<(usize, usize)> {
    if old.is_empty() || new.is_empty() {
        return Vec::new();
    }
    let old_hashes: Vec<u64> = old.iter().map(|r| hash_cells(&r.cells)).collect();
    let new_hashes: Vec<u64> = new.iter().map(|r| hash_cells(r)).collect();
    align_slice(
        old,
        &old_hashes,
        0..old.len(),
        new,
        &new_hashes,
        0..new.len(),
    )
}

fn align_slice(
    old: &[&Arc<Row>],
    old_hashes: &[u64],
    o_range: std::ops::Range<usize>,
    new: &[Vec<String>],
    new_hashes: &[u64],
    n_range: std::ops::Range<usize>,
) -> Vec<(usize, usize)> {
    let (mut os, mut oe) = (o_range.start, o_range.end);
    let (mut ns, mut ne) = (n_range.start, n_range.end);
    let mut prefix = Vec::new();
    while os < oe
        && ns < ne
        && old_hashes[os] == new_hashes[ns]
        && row_matches_cells(old[os], &new[ns])
    {
        prefix.push((os, ns));
        os += 1;
        ns += 1;
    }
    let mut suffix = Vec::new();
    while os < oe
        && ns < ne
        && old_hashes[oe - 1] == new_hashes[ne - 1]
        && row_matches_cells(old[oe - 1], &new[ne - 1])
    {
        oe -= 1;
        ne -= 1;
        suffix.push((oe, ne));
    }
    suffix.reverse();

    let olen = oe - os;
    let nlen = ne - ns;
    if olen == 0 || nlen == 0 {
        prefix.extend(suffix);
        return prefix;
    }
    if olen <= 64 && nlen <= 64 {
        let sub = lcs_pairs(olen, nlen, |i, j| {
            old_hashes[os + i] == new_hashes[ns + j] && row_matches_cells(old[os + i], &new[ns + j])
        });
        prefix.extend(sub.into_iter().map(|(i, j)| (os + i, ns + j)));
        prefix.extend(suffix);
        return prefix;
    }

    // Unique-hash Patience anchors + Longest Increasing Subsequence.
    let mut old_unique: HashMap<u64, Option<usize>> = HashMap::new();
    for (i, &h) in old_hashes.iter().enumerate().take(oe).skip(os) {
        old_unique
            .entry(h)
            .and_modify(|v| *v = None)
            .or_insert(Some(i));
    }
    let mut new_unique: HashMap<u64, Option<usize>> = HashMap::new();
    for (j, &h) in new_hashes.iter().enumerate().take(ne).skip(ns) {
        new_unique
            .entry(h)
            .and_modify(|v| *v = None)
            .or_insert(Some(j));
    }
    let mut candidates: Vec<(usize, usize)> = Vec::new();
    for (i, &h) in old_hashes.iter().enumerate().take(oe).skip(os) {
        if let Some(&Some(oi)) = old_unique.get(&h)
            && oi == i
            && let Some(&Some(nj)) = new_unique.get(&h)
            && row_matches_cells(old[oi], &new[nj])
        {
            candidates.push((oi, nj));
        }
    }
    let anchors = lis_by_second(&candidates);
    if anchors.is_empty() {
        prefix.extend(suffix);
        return prefix;
    }

    let mut cur_o = os;
    let mut cur_n = ns;
    for (ao, an) in anchors {
        if cur_o < ao && cur_n < an {
            prefix.extend(align_slice(
                old,
                old_hashes,
                cur_o..ao,
                new,
                new_hashes,
                cur_n..an,
            ));
        }
        prefix.push((ao, an));
        cur_o = ao + 1;
        cur_n = an + 1;
    }
    if cur_o < oe && cur_n < ne {
        prefix.extend(align_slice(
            old,
            old_hashes,
            cur_o..oe,
            new,
            new_hashes,
            cur_n..ne,
        ));
    }
    prefix.extend(suffix);
    prefix
}

fn lis_by_second(pairs: &[(usize, usize)]) -> Vec<(usize, usize)> {
    if pairs.is_empty() {
        return Vec::new();
    }
    let mut tails: Vec<usize> = Vec::new(); // indices into `pairs`
    let mut prev: Vec<Option<usize>> = vec![None; pairs.len()];
    for (idx, &(_, nj)) in pairs.iter().enumerate() {
        let pos = tails.partition_point(|&t| pairs[t].1 < nj);
        if pos > 0 {
            prev[idx] = Some(tails[pos - 1]);
        }
        if pos == tails.len() {
            tails.push(idx);
        } else {
            tails[pos] = idx;
        }
    }
    let mut out = Vec::with_capacity(tails.len());
    let mut cur = tails.last().copied();
    while let Some(i) = cur {
        out.push(pairs[i]);
        cur = prev[i];
    }
    out.reverse();
    out
}

fn reconcile_columns(
    old_rows: &RowVec,
    old_columns: &[u64],
    matrix: &[Vec<String>],
    next_id: &mut u64,
) -> Vec<u64> {
    let new_cols = matrix.first().map_or(1, Vec::len).max(1);
    let old_cols = old_columns.len();
    if old_cols == 0 {
        return (0..new_cols)
            .map(|_| {
                *next_id += 1;
                *next_id
            })
            .collect();
    }

    // Check if row 0 has distinct non-empty header labels we can match across permutations/inserts.
    let old_header: Vec<&str> = (0..old_cols)
        .map(|c| old_rows.get(0).map_or("", |r| r.cell_or_empty(c)))
        .collect();
    let new_header: Vec<&str> = (0..new_cols)
        .map(|c| {
            matrix
                .first()
                .and_then(|r| r.get(c))
                .map_or("", String::as_str)
        })
        .collect();

    if old_cols == new_cols {
        let distinct_old = old_header.iter().all(|h| !h.is_empty())
            && old_header
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                == old_cols;
        if distinct_old {
            let old_map: HashMap<&str, u64> = old_header
                .iter()
                .copied()
                .zip(old_columns.iter().copied())
                .collect();
            if new_header
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                == new_cols
                && new_header.iter().all(|h| old_map.contains_key(h))
            {
                return new_header.iter().map(|h| old_map[h]).collect();
            }
        }
        return old_columns.to_vec();
    }

    // Column count changed: align via LCS on column signatures (header + up to 4 sample cells).
    let sample_n = old_rows.len().min(matrix.len()).min(5);
    let col_eq = |oc: usize, nc: usize| {
        if !old_header[oc].is_empty() || !new_header[nc].is_empty() {
            return old_header[oc] == new_header[nc];
        }
        (0..sample_n).all(|r| old_rows[r].cell_or_empty(oc) == matrix[r][nc])
    };
    let matches = if old_cols <= 64 && new_cols <= 64 {
        lcs_pairs(old_cols, new_cols, col_eq)
    } else {
        let common = old_cols.min(new_cols);
        (0..common)
            .filter(|&c| col_eq(c, c))
            .map(|c| (c, c))
            .collect()
    };

    let mut result = vec![0u64; new_cols];
    let mut cur_o = 0usize;
    let mut cur_n = 0usize;
    for (mo, mn) in matches
        .into_iter()
        .chain(std::iter::once((old_cols, new_cols)))
    {
        let paired = (mo - cur_o).min(mn - cur_n);
        result[cur_n..(cur_n + paired)].copy_from_slice(&old_columns[cur_o..(cur_o + paired)]);
        for slot in &mut result[cur_n + paired..mn] {
            *next_id += 1;
            *slot = *next_id;
        }
        if mo < old_cols && mn < new_cols {
            result[mn] = old_columns[mo];
        }
        cur_o = mo + 1;
        cur_n = mn + 1;
    }
    result
}

/// Reconcile newly parsed normalized `matrix` + `raw_records` against existing
/// `old_rows` and `old_columns` (`CS-10`).
pub fn reconcile(
    old_rows: &RowVec,
    old_columns: &[u64],
    mut matrix: Vec<Vec<String>>,
    mut raw_records: Vec<Option<Arc<str>>>,
    next_id: &mut u64,
) -> DiffOutcome {
    raw_records.resize(matrix.len(), None);
    let columns = reconcile_columns(old_rows, old_columns, &matrix, next_id);
    let cols_changed = columns != old_columns;

    let old_len = old_rows.len();
    let new_len = matrix.len();

    let mut prefix = 0usize;
    while prefix < old_len
        && prefix < new_len
        && row_matches_cells(&old_rows[prefix], &matrix[prefix])
    {
        prefix += 1;
    }

    let mut suffix = 0usize;
    while suffix < (old_len - prefix)
        && suffix < (new_len - prefix)
        && row_matches_cells(
            &old_rows[old_len - 1 - suffix],
            &matrix[new_len - 1 - suffix],
        )
    {
        suffix += 1;
    }

    let old_mid_end = old_len - suffix;
    let new_mid_end = new_len - suffix;

    // Fast path: identical shape and at most a few rows changed in the middle!
    if old_len == new_len && new_mid_end - prefix <= 8 {
        let mut tree = old_rows.clone();
        let mut delta_bytes = 0usize;
        let mut any_row_changed = false;
        // Also check if any prefix/suffix row's `raw` changed (e.g. quote formatting in Source mode).
        for i in 0..new_len {
            let old_arc = old_rows.get_arc(i).unwrap();
            let raw = raw_records[i].take();
            if i >= prefix && i < new_mid_end {
                let cells = std::mem::take(&mut matrix[i]);
                let (updated, d, changed) = update_row_in_place(old_arc, cells, raw);
                if changed {
                    tree = tree.set(i, updated);
                    delta_bytes += d + tree.spine_delta_bytes();
                    any_row_changed = true;
                }
            } else if old_arc.raw != raw || old_arc.canonical {
                let updated =
                    Arc::new(Row::new(old_arc.id, Arc::clone(&old_arc.cells), raw, false));
                tree = tree.set(i, updated);
                delta_bytes += 64 + tree.spine_delta_bytes();
                any_row_changed = true;
            }
        }
        return DiffOutcome {
            rows: tree,
            columns,
            delta_bytes,
            changed: cols_changed || any_row_changed,
        };
    }

    let old_mid: Vec<&Arc<Row>> = old_rows.range(prefix..old_mid_end).collect();
    let new_mid_slice = &matrix[prefix..new_mid_end];
    let anchors = align_rows(&old_mid, new_mid_slice);

    let mut out_rows: Vec<Arc<Row>> = Vec::with_capacity(new_len);
    let mut delta_bytes = 0usize;
    let mut any_row_changed = old_len != new_len;

    // 1. Prefix
    for (i, raw_slot) in raw_records.iter_mut().enumerate().take(prefix) {
        let old_arc = old_rows.get_arc(i).unwrap();
        let raw = raw_slot.take();
        if old_arc.raw == raw && !old_arc.canonical {
            out_rows.push(Arc::clone(old_arc));
        } else {
            out_rows.push(Arc::new(Row::new(
                old_arc.id,
                Arc::clone(&old_arc.cells),
                raw,
                false,
            )));
            delta_bytes += 64;
            any_row_changed = true;
        }
    }

    // 2. Middle with anchors + gap pairing
    let mid_o_len = old_mid.len();
    let mid_n_len = new_mid_end - prefix;
    let mut cur_o = 0usize;
    let mut cur_n = 0usize;
    for (ao, an) in anchors
        .into_iter()
        .chain(std::iter::once((mid_o_len, mid_n_len)))
    {
        let paired = (ao - cur_o).min(an - cur_n);
        for k in 0..paired {
            let old_arc = old_mid[cur_o + k];
            let ni = prefix + cur_n + k;
            let cells = std::mem::take(&mut matrix[ni]);
            let raw = raw_records[ni].take();
            let (updated, d, ch) = update_row_in_place(old_arc, cells, raw);
            out_rows.push(updated);
            delta_bytes += d;
            any_row_changed |= ch;
        }
        // Deleted old rows in this gap
        for deleted in &old_mid[cur_o + paired..ao] {
            delta_bytes += row_full_bytes(deleted);
            any_row_changed = true;
        }
        // Inserted new rows in this gap
        for ni in (prefix + cur_n + paired)..(prefix + an) {
            *next_id += 1;
            let cells = build_cells_from_strings(std::mem::take(&mut matrix[ni]));
            let raw = raw_records[ni].take();
            let row = Arc::new(Row::new(*next_id, cells, raw, false));
            delta_bytes += row_full_bytes(&row);
            out_rows.push(row);
            any_row_changed = true;
        }
        // Matched anchor row
        if ao < mid_o_len && an < mid_n_len {
            let old_arc = old_mid[ao];
            let ni = prefix + an;
            let raw = raw_records[ni].take();
            if cur_o != ao || cur_n != an {
                any_row_changed = true;
            }
            if old_arc.raw == raw && !old_arc.canonical {
                out_rows.push(Arc::clone(old_arc));
            } else {
                out_rows.push(Arc::new(Row::new(
                    old_arc.id,
                    Arc::clone(&old_arc.cells),
                    raw,
                    false,
                )));
                delta_bytes += 64;
                any_row_changed = true;
            }
        }
        cur_o = ao + 1;
        cur_n = an + 1;
    }

    // 3. Suffix
    for k in 0..suffix {
        let oi = old_len - suffix + k;
        let ni = new_len - suffix + k;
        let old_arc = old_rows.get_arc(oi).unwrap();
        let raw = raw_records[ni].take();
        if old_arc.raw == raw && !old_arc.canonical {
            out_rows.push(Arc::clone(old_arc));
        } else {
            out_rows.push(Arc::new(Row::new(
                old_arc.id,
                Arc::clone(&old_arc.cells),
                raw,
                false,
            )));
            delta_bytes += 64;
            any_row_changed = true;
        }
    }

    let rows = RowVec::from_vec(out_rows);
    delta_bytes += rows.spine_delta_bytes();
    DiffOutcome {
        rows,
        columns,
        delta_bytes,
        changed: cols_changed || any_row_changed,
    }
}
