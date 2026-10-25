//! Column widths (product editor/table/editableTableLayout.ts): stable
//! widths estimated from content without measuring rendered text.

pub const COLUMN_MIN_WIDTH: f32 = 96.;
pub const COLUMN_MAX_WIDTH: f32 = 280.;
pub const COLUMN_INITIAL_MAX_WIDTH: f32 = 220.;
pub const COLUMN_RESIZE_MAX_WIDTH: f32 = 560.;
const SAMPLE_ROWS: usize = 128;

/// `estimateMaxLineVisualUnits`: tabs 4, characters above U+00FF 2.
fn visual_units(text: &str) -> usize {
    text.split('\n')
        .map(|line| {
            line.chars()
                .map(|c| {
                    if c == '\t' {
                        4
                    } else if c as u32 > 0xff {
                        2
                    } else {
                        1
                    }
                })
                .sum()
        })
        .max()
        .unwrap_or(0)
}

/// `sampleTableRows`: at most 128 rows, first and last included.
fn sample<T>(rows: &[T]) -> Vec<&T> {
    if rows.len() <= SAMPLE_ROWS {
        return rows.iter().collect();
    }
    let mut seen = std::collections::BTreeSet::new();
    (0..SAMPLE_ROWS)
        .map(|k| ((k * (rows.len() - 1)) as f64 / (SAMPLE_ROWS - 1) as f64).round() as usize)
        .filter(|i| seen.insert(*i))
        .map(|i| &rows[i])
        .collect()
}

/// `estimateEditableTableColumnWidths`: `28 + 7 × units`, clamped to the
/// readable range, per column of the sampled rows.
pub fn estimate_widths<T>(
    rows: &[T],
    columns: usize,
    cell: impl Fn(&T, usize) -> Option<&str>,
) -> Vec<f32> {
    let sampled = sample(rows);
    (0..columns.max(1))
        .map(|c| {
            let units = sampled
                .iter()
                .map(|r| cell(r, c).map_or(0, visual_units))
                .max()
                .unwrap_or(0);
            (28. + units as f32 * 7.).clamp(COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)
        })
        .collect()
}

/// `clampEditableTableColumnWidth`.
pub fn clamp_width(width: f32, maximum: f32) -> f32 {
    width.round().clamp(COLUMN_MIN_WIDTH, maximum)
}

/// `fitEditableTableColumnWidths`: scale the current widths to fill
/// `available` (floored), clamping to the readable range and distributing the
/// rounding remainder by largest fraction.
pub fn fit_widths(current: &[f32], available: f32, maximum: f32) -> Vec<f32> {
    let n = current.len();
    if n == 0 {
        return Vec::new();
    }
    let widths: Vec<f32> = current.iter().map(|w| clamp_width(*w, maximum)).collect();
    if !available.is_finite() || available <= 0. {
        return widths;
    }
    let target = (COLUMN_MIN_WIDTH * n as f32).max((maximum * n as f32).min(available.floor()));
    let mut unresolved: Vec<usize> = (0..n).collect();
    let mut result = vec![0f64; n];
    let mut remaining_target = target as f64;
    let mut remaining_source: f64 = widths.iter().map(|w| *w as f64).sum();
    loop {
        let mut clamped_any = false;
        for index in unresolved.clone() {
            let proportional = if remaining_source > 0. {
                widths[index] as f64 / remaining_source * remaining_target
            } else {
                remaining_target / unresolved.len() as f64
            };
            let clamped = if proportional < COLUMN_MIN_WIDTH as f64 {
                COLUMN_MIN_WIDTH as f64
            } else if proportional > maximum as f64 {
                maximum as f64
            } else {
                continue;
            };
            result[index] = clamped;
            remaining_target -= clamped;
            remaining_source -= widths[index] as f64;
            unresolved.retain(|i| *i != index);
            clamped_any = true;
        }
        if !clamped_any || unresolved.is_empty() {
            break;
        }
    }
    let count = unresolved.len();
    for &index in &unresolved {
        result[index] = if remaining_source > 0. {
            widths[index] as f64 / remaining_source * remaining_target
        } else {
            remaining_target / count as f64
        };
    }
    let mut rounded: Vec<f64> = result.iter().map(|w| w.floor()).collect();
    let mut remainder = target as f64 - rounded.iter().sum::<f64>();
    let mut by_fraction: Vec<(f64, usize)> = result
        .iter()
        .enumerate()
        .map(|(i, w)| (w - w.floor(), i))
        .collect();
    by_fraction.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.cmp(&b.1))
    });
    for (_, index) in by_fraction {
        if remainder <= 0. {
            break;
        }
        if rounded[index] >= maximum as f64 {
            continue;
        }
        rounded[index] += 1.;
        remainder -= 1.;
    }
    rounded.into_iter().map(|w| w as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fitting_scales_clamps_and_distributes_the_remainder() {
        // Proportional, floored, remainder to the largest fractions.
        assert_eq!(fit_widths(&[100., 200.], 601., 560.), vec![200., 401.]);
        // A column that would fall under the minimum is pinned there first.
        assert_eq!(fit_widths(&[96., 500.], 400., 560.), vec![96., 304.]);
        // Never below n × minimum, never above n × maximum.
        assert_eq!(fit_widths(&[120., 120.], 50., 560.), vec![96., 96.]);
        assert_eq!(fit_widths(&[120., 120.], 5000., 560.), vec![560., 560.]);
    }
}
