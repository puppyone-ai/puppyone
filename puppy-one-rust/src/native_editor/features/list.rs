//! List/task commands share the containing document's selection and history.
use crate::native_editor::core::{
    document::{Block, Document, Item, Kind},
    text::Text,
};
pub fn new_task_list() -> Kind {
    Kind::List {
        start: None,
        items: vec![Item {
            checked: Some(false),
            text: Text::plain("Task"),
        }],
    }
}
pub fn toggle_task(document: &mut Document, key: (usize, usize)) {
    if let Some(Block {
        kind: Kind::List { items, .. },
        ..
    }) = document.blocks.get_mut(key.0)
        && let Some(item) = items.get_mut(key.1)
    {
        item.checked = Some(!item.checked.unwrap_or(false));
    }
}
pub fn is_task(document: &Document, key: (usize, usize)) -> bool {
    matches!(&document.blocks[key.0].kind, Kind::List { items, .. } if items[key.1].checked.is_some())
}
pub fn add_item(document: &mut Document, key: (usize, usize)) -> Option<(usize, usize)> {
    let Block {
        kind: Kind::List { items, .. },
        ..
    } = document.blocks.get_mut(key.0)?
    else {
        return None;
    };
    let index = (key.1 + 1).min(items.len());
    items.insert(
        index,
        Item {
            checked: None,
            text: Text::default(),
        },
    );
    Some((key.0, index))
}
