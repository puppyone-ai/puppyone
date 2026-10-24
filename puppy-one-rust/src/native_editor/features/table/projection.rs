//! Renderer-neutral cell metadata. Kit objects never enter the feature model.
pub struct Cell {
    pub columns: usize,
    pub column: usize,
    pub alignment: i8,
    pub heading: bool,
    pub after: f32,
}
pub fn cell(align: &[String], row_count: usize, index: usize) -> Cell {
    let column = index % align.len();
    Cell {
        columns: align.len(),
        column,
        alignment: match align[column].as_str() {
            ":---" => -1,
            "---:" => 1,
            ":---:" => 2,
            _ => 0,
        },
        heading: index < align.len(),
        after: if index + 1 == row_count * align.len() {
            18.
        } else {
            0.
        },
    }
}
