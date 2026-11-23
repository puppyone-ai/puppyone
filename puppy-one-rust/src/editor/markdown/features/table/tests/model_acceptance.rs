//! The pinned TS tableModel acceptance inputs and expected rewrites. Models
//! here always originate from the actual Markdown parser's Table range.
use super::super::{
    TableFeature,
    model::{self, Table},
    operation,
};
use crate::editor::{
    markdown::core::{
        features::{CompileCx, MarkdownFeature},
        syntax::Syntax,
    },
    table::operation::{Alignment, Focus, Operation},
    text::buffer::Buffer,
};

fn table(source: &str) -> Table {
    let doc = Buffer::new(source);
    let syntax = Syntax::parse(&doc);
    assert_eq!(syntax.tables.len(), 1, "parser must own {source:?}");
    model::table_block(&doc, &syntax.tables[0]).expect("valid table refinement")
}

#[test]
fn parser_owned_table_ranges_keep_adjacent_prose_and_escaped_pipes_outside() {
    assert!(model::is_table_line("a | b"));
    assert!(!model::is_table_source_line("a | b"));
    assert!(model::is_table_source_line("| a |"));
    let source = "before\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nafter";
    let model = table(source);
    assert!(model.refinement_valid);
    assert_eq!(
        model.range,
        source.find("| A").unwrap()..source.find("\n\nafter").unwrap()
    );
    assert_eq!(model.lines, 2..5);
    assert_eq!(model.rows.len(), 2);
    assert_eq!(&source[model.range.end..], "\n\nafter");

    for (source, suffix, rows, contents) in [
        (
            "| Slot | Desktop | Cloud |\n| --- | --- | --- |\n| Storage | local disk | S3 |\n这里面有几个要素值得注意。\n**第一，正文不能变成空表格行。**",
            "\n这里面有几个要素值得注意。\n**第一，正文不能变成空表格行。**",
            2,
            vec![
                vec!["Slot", "Desktop", "Cloud"],
                vec!["Storage", "local disk", "S3"],
            ],
        ),
        (
            "Name | Runtime | Storage\n--- | --- | ---\nDesktop | macOS | local disk\nCloud native agents assemble context from many sources.",
            "\nCloud native agents assemble context from many sources.",
            2,
            vec![
                vec!["Name", "Runtime", "Storage"],
                vec!["Desktop", "macOS", "local disk"],
            ],
        ),
        (
            "| A | B |\n| --- | --- |\nordinary prose with an escaped \\| character",
            "\nordinary prose with an escaped \\| character",
            1,
            vec![vec!["A", "B"]],
        ),
    ] {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse(&doc);
        assert_eq!(syntax.tables[0], 0..source.len(), "broad GFM parser range");
        let model = table(source);
        assert_eq!(&source[model.range.end..], suffix);
        assert_eq!(model.rows.len(), rows);
        assert_eq!(model.lines.end, rows + 1);
        assert_eq!(
            model
                .rows
                .iter()
                .map(|r| r.cells.iter().map(|c| c.text.as_str()).collect::<Vec<_>>())
                .collect::<Vec<_>>(),
            contents
        );
    }
    // The feature is a refinement of parser ownership, not a text scanner
    // that creates interactive tables in an unconfigured/plain document.
    let doc = Buffer::new("| A | B |\n| - | - |\n| 1 | 2 |");
    let mut plans = Vec::new();
    TableFeature.compile_blocks(
        &CompileCx {
            doc: &doc,
            syntax: &Syntax::default(),
            folds: &Default::default(),
        },
        &mut plans,
    );
    assert!(plans.is_empty());
}

#[test]
fn table_alignment_escape_and_one_hyphen_delimiters_canonicalize_only_on_edit() {
    let source = "| Name | Count | Notes |\n| :--- | ---: | :---: |\n| A\\|B | 3 | x |";
    let model = table(source);
    assert_eq!(
        model.alignments,
        [Alignment::Left, Alignment::Right, Alignment::Center]
    );
    assert_eq!(model.rows[1].cells[0].text, "A|B");
    let rows: Vec<Vec<String>> = model
        .rows
        .iter()
        .map(|row| row.cells.iter().map(|c| c.text.clone()).collect())
        .collect();
    assert_eq!(
        operation::serialize(&rows, &model.alignments).0,
        "| Name | Count | Notes |\n| :--- | ---:  | :---: |\n| A\\|B | 3     | x     |"
    );
    let source = "| A | B |\n| - | - |\n| 1 | 2 |";
    let doc = Buffer::new(source);
    let model = table(source);
    assert!(model.refinement_valid);
    assert_eq!(
        model
            .rows
            .iter()
            .map(|r| r.cells.iter().map(|c| c.text.as_str()).collect::<Vec<_>>())
            .collect::<Vec<_>>(),
        [["A", "B"], ["1", "2"]]
    );
    assert_eq!(doc.as_str(), source);
    let edit = operation::try_apply(&model, Operation::InsertRowBelow, 1, 0).unwrap();
    assert!(edit.replacement.contains("| --- | --- |"));
    assert_eq!(
        doc.as_str(),
        source,
        "generating an edit cannot mutate source"
    );
}

#[test]
fn table_structure_operations_match_pinned_source_and_focus_results() {
    for (source, operation, row, column, focus, expected) in [
        (
            "| A | B |\n| --- | :---: |\n| 1 | 2 |",
            Operation::InsertRowBelow,
            1,
            1,
            (2, 0),
            "| A   | B     |\n| --- | :---: |\n| 1   | 2     |\n|     |       |",
        ),
        (
            "| Name | Count | Notes |\n| :--- | ---: | :---: |\n| A\\|B | 3 | x |",
            Operation::DeleteColumn,
            1,
            1,
            (1, 1),
            "| Name | Notes |\n| :--- | :---: |\n| A\\|B | x     |",
        ),
        (
            "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |",
            Operation::InsertColumnRight,
            1,
            1,
            (1, 2),
            "| A   | B   |     | C   |\n| --- | --- | --- | --- |\n| 1   | 2   |     |     |",
        ),
        (
            "| A |\n| --- |\n| one |\n| two |",
            Operation::MoveRowUp,
            2,
            0,
            (1, 0),
            "| A   |\n| --- |\n| two |\n| one |",
        ),
        (
            "| A |\n| --- |\n| one |\n| two |\n| three |",
            Operation::MoveRowTo(3),
            1,
            0,
            (3, 0),
            "| A     |\n| ---   |\n| two   |\n| three |\n| one   |",
        ),
        (
            "| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |",
            Operation::MoveColumnTo(2),
            0,
            0,
            (0, 2),
            "| B     | C    | A    |\n| :---: | ---: | :--- |\n| 2     | 3    | 1    |",
        ),
        (
            "| A |\n| --- |\n| one |",
            Operation::DeleteColumn,
            1,
            0,
            (1, 0),
            "| A   |\n| --- |\n| one |",
        ),
    ] {
        let model = table(source);
        let edit = operation::try_apply(&model, operation, row, column).unwrap();
        assert_eq!(edit.replacement, expected, "{operation:?}");
        assert_eq!(
            edit.focus,
            Some(Focus {
                row: focus.0,
                column: focus.1
            }),
            "{operation:?}"
        );
        let reparsed = table(&edit.replacement);
        assert!(reparsed.refinement_valid);
        assert_eq!(edit.cells.len(), reparsed.rows.len());
        for (ranges, parsed_row) in edit.cells.iter().zip(&reparsed.rows) {
            assert_eq!(ranges.len(), parsed_row.cells.len());
            for (range, cell) in ranges.iter().zip(&parsed_row.cells) {
                assert_eq!(
                    edit.replacement[range.clone()].replace("\\|", "|"),
                    cell.text
                );
            }
        }
    }
}
