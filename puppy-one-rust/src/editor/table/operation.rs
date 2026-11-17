//! Structural table edits shared by CSV and Markdown tables
//! (`CsvTableStructureOperation`, `MarkdownTableStructureOperation`): what a
//! menu item, rail or drop asks for, at a target row and column. Each format
//! applies them to its own model.

/// Hard table dimension caps (`CSV_MAX_DATA_ROWS`, `CSV_MAX_COLUMNS`).
pub const MAX_DATA_ROWS: usize = 10_000;
pub const MAX_COLUMNS: usize = 256;

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
    ExpandToShape {
        data_rows: usize,
        columns: usize,
    },
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

/// Canonical table context-menu item identifiers shared between `menu` and
/// format handlers (`TODO-32`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MenuAction {
    InsertRowAbove,
    InsertRowBelow,
    DuplicateRow,
    MoveRowUp,
    MoveRowDown,
    DeleteRow,
    InsertColumnLeft,
    InsertColumnRight,
    MoveColumnLeft,
    MoveColumnRight,
    DeleteColumn,
    AutoFitColumn,
    AlignDefault,
    AlignLeft,
    AlignCenter,
    AlignRight,
    DeleteTable,
}

impl MenuAction {
    pub const ALL: [Self; 17] = [
        Self::InsertRowAbove,
        Self::InsertRowBelow,
        Self::DuplicateRow,
        Self::MoveRowUp,
        Self::MoveRowDown,
        Self::DeleteRow,
        Self::InsertColumnLeft,
        Self::InsertColumnRight,
        Self::MoveColumnLeft,
        Self::MoveColumnRight,
        Self::DeleteColumn,
        Self::AutoFitColumn,
        Self::AlignDefault,
        Self::AlignLeft,
        Self::AlignCenter,
        Self::AlignRight,
        Self::DeleteTable,
    ];

    pub const fn id(self) -> &'static str {
        match self {
            Self::InsertRowAbove => "insert-row-above",
            Self::InsertRowBelow => "insert-row-below",
            Self::DuplicateRow => "duplicate-row",
            Self::MoveRowUp => "move-row-up",
            Self::MoveRowDown => "move-row-down",
            Self::DeleteRow => "delete-row",
            Self::InsertColumnLeft => "insert-column-left",
            Self::InsertColumnRight => "insert-column-right",
            Self::MoveColumnLeft => "move-column-left",
            Self::MoveColumnRight => "move-column-right",
            Self::DeleteColumn => "delete-column",
            Self::AutoFitColumn => "auto-fit-column",
            Self::AlignDefault => "align-default",
            Self::AlignLeft => "align-left",
            Self::AlignCenter => "align-center",
            Self::AlignRight => "align-right",
            Self::DeleteTable => "delete-table",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.id() == id)
    }

    pub const fn into_operation(self) -> Option<Operation> {
        Some(match self {
            Self::InsertRowAbove => Operation::InsertRowAbove,
            Self::InsertRowBelow => Operation::InsertRowBelow,
            Self::DuplicateRow => Operation::DuplicateRow,
            Self::MoveRowUp => Operation::MoveRowUp,
            Self::MoveRowDown => Operation::MoveRowDown,
            Self::DeleteRow => Operation::DeleteRow,
            Self::InsertColumnLeft => Operation::InsertColumnLeft,
            Self::InsertColumnRight => Operation::InsertColumnRight,
            Self::MoveColumnLeft => Operation::MoveColumnLeft,
            Self::MoveColumnRight => Operation::MoveColumnRight,
            Self::DeleteColumn => Operation::DeleteColumn,
            Self::AutoFitColumn => return None,
            Self::AlignDefault => Operation::SetColumnAlignment(Alignment::None),
            Self::AlignLeft => Operation::SetColumnAlignment(Alignment::Left),
            Self::AlignCenter => Operation::SetColumnAlignment(Alignment::Center),
            Self::AlignRight => Operation::SetColumnAlignment(Alignment::Right),
            Self::DeleteTable => Operation::DeleteTable,
        })
    }
}

impl Operation {
    pub fn move_axis(self) -> Option<Axis> {
        match self {
            Self::MoveRowUp | Self::MoveRowDown | Self::MoveRowTo(_) => Some(Axis::Row),
            Self::MoveColumnLeft | Self::MoveColumnRight | Self::MoveColumnTo(_) => {
                Some(Axis::Column)
            }
            _ => None,
        }
    }

    /// The operation a table menu item runs (`operation.type`).
    pub fn from_menu_id(id: &str) -> Option<Self> {
        MenuAction::parse(id).and_then(MenuAction::into_operation)
    }
}
