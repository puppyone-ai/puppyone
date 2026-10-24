//! Structural table edits shared by CSV and Markdown tables
//! (`CsvTableStructureOperation`, `MarkdownTableStructureOperation`): what a
//! menu item, rail or drop asks for, at a target row and column. Each format
//! applies them to its own model.

/// Where an operation leaves the focus.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Focus {
    pub row: usize,
    pub column: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Operation {
    InsertRowAbove,
    InsertRowBelow,
    DuplicateRow,
    MoveRowUp,
    MoveRowDown,
    MoveRowTo(usize),
    DeleteRow,
    InsertColumnLeft,
    InsertColumnRight,
    MoveColumnLeft,
    MoveColumnRight,
    MoveColumnTo(usize),
    DeleteColumn,
    /// Markdown tables: the column's alignment (delimiter row).
    SetColumnAlignment(Alignment),
    /// Markdown tables: remove the whole table.
    DeleteTable,
    /// CSV: grow to a shape (`expand-to-shape`).
    ExpandToShape { data_rows: usize, columns: usize },
}

/// Column alignment (`MarkdownTableAlignment`; `None` is the default).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Alignment {
    #[default]
    None,
    Left,
    Center,
    Right,
}

/// The axis a structure operation moves along (`getEditableTableMoveAxis`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Axis {
    Row,
    Column,
}

impl Operation {
    pub fn move_axis(self) -> Option<Axis> {
        match self {
            Self::MoveRowUp | Self::MoveRowDown | Self::MoveRowTo(_) => Some(Axis::Row),
            Self::MoveColumnLeft | Self::MoveColumnRight | Self::MoveColumnTo(_) => Some(Axis::Column),
            _ => None,
        }
    }

    /// The operation a table menu item runs (`operation.type`).
    pub fn from_menu_id(id: &str) -> Option<Self> {
        Some(match id {
            "insert-row-above" => Self::InsertRowAbove,
            "insert-row-below" => Self::InsertRowBelow,
            "duplicate-row" => Self::DuplicateRow,
            "move-row-up" => Self::MoveRowUp,
            "move-row-down" => Self::MoveRowDown,
            "delete-row" => Self::DeleteRow,
            "insert-column-left" => Self::InsertColumnLeft,
            "insert-column-right" => Self::InsertColumnRight,
            "move-column-left" => Self::MoveColumnLeft,
            "move-column-right" => Self::MoveColumnRight,
            "delete-column" => Self::DeleteColumn,
            "align-default" => Self::SetColumnAlignment(Alignment::None),
            "align-left" => Self::SetColumnAlignment(Alignment::Left),
            "align-center" => Self::SetColumnAlignment(Alignment::Center),
            "align-right" => Self::SetColumnAlignment(Alignment::Right),
            "delete-table" => Self::DeleteTable,
            _ => return None,
        })
    }
}
