# gpui-base 0.8.0, patched for PuppyOne

This is the crates.io release of `gpui-base` 0.8.0 with four additions, used
through `[patch.crates-io]` in `puppy-one-rust/Cargo.toml`. Nothing else
differs from the published source.

## The patch: `GutterMetrics`

The code viewer's gutter must match the product's CodeMirror gutter
(`packages/shared-ui/src/styles/editor/code-editor.css`): a 36 px line-number
column (8 / 9 px paddings, the hint size, numbers right-aligned, 34% text, the
active number in the text colour at weight 500), a 16 px fold column, an 8 px
text inset inside the line, an active-line background that starts at the
gutter's edge and never covers it, and no content padding.

`InputBaseState::set_gutter_metrics(Some(GutterMetrics { .. }))` turns that
on; without it (the default) the editor keeps its own gutter. Only the code
viewer (`src/editor/viewers/code/style.rs::gutter`) sets it.

Verified by `tools/capture-workbench.py --suite editor` against the product
pane (`tools/reference-editor.mjs`).

## The patch: `replay_undo`

The HTML viewer's Edit mode (`src/editor/viewers/html_visual.rs`) edits the
document through the code editor while that editor is not rendered; its
undo and redo must run the same history. `InputBaseState::replay_undo(redo,
window, cx)` is the `Undo` / `Redo` action handlers' body made public, so the
history can be replayed without dispatching an action to a focused element.

```diff
--- registry/gpui-base-0.8.0/src/input/base/state.rs
+++ vendor/gpui-base/src/input/base/state.rs
@@ pub(super) fn redo
     pub(super) fn redo(&mut self, _: &Redo, window: &mut Window, cx: &mut Context<Self>) {
         self.replay_history(false, window, cx);
     }
+
+    /// PuppyOne patch: replay the undo history directly, for an editor that
+    /// another view of the same document drives while it is not in the
+    /// element tree (actions only reach focused, rendered inputs).
+    pub fn replay_undo(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
+        self.replay_history(!redo, window, cx);
+    }
```

## The patch: history retention

The product bounds every document's undo history with
`DOCUMENT_HISTORY_POLICY` (200 entries, 8 MiB of text counted in UTF-16
bytes, newest kept; an entry larger than the whole budget is not kept). The
upstream undo manager keeps 1000 transactions and no byte budget.
`InputBaseState::set_history_retention(transactions, bytes)` sets such a
retention: `UndoManager` tracks each transaction's weight (removed plus
inserted text, UTF-16 bytes) incrementally and drops the oldest undo entries,
then redo entries, after every push. Without it (the default) nothing
changes. The code viewer sets the product policy
(`src/editor/viewers/code/mod.rs`, tests in `code/tests.rs`).

## The patch: owner hover reveals the scrollbar

The product's scrollbar primitive (`src/styles/scrollbars.css` with
`ScrollbarActivity`) shows its thumb while the pointer is anywhere over the
scroll owner, not only over the scrollbar lane, and for 900 ms after it
scrolls. In `ScrollbarMode::Hover` the scrollbar now also tracks a pointer
over its viewport hitbox (`owner_hovered`), which reveals it like lane hover
but without extending the idle hold, so the thumb leaves with the pointer as
CSS `:hover` does. Other modes are unchanged. The app installs the mode and
the product geometry once (`theme::product_scrollbar`).

```diff
155a156,158
>     /// PuppyOne patch: the pointer is over the scrolled viewport (the scroll
>     /// owner), which reveals a [`ScrollbarMode::Hover`] scrollbar.
>     owner_hovered: bool,
175a179
>             owner_hovered: false,
585a590,597
>         state
>     }
> 
>     /// PuppyOne patch: owner hover reveals without extending the idle hold,
>     /// so the thumb leaves with the pointer (CSS `:hover`).
>     fn with_owner_hovered(&self, hovered: bool) -> Self {
>         let mut state = *self;
>         state.owner_hovered = hovered;
1333c1345,1347
<         let is_hovered = inner.hovered_axis.is_some() || inner.hovered_on_thumb.is_some();
---
>         let is_hovered = inner.hovered_axis.is_some()
>             || inner.hovered_on_thumb.is_some()
>             || (mode.is_hover() && inner.owner_hovered);
1595a1610,1626
>         // PuppyOne patch: in hover mode the whole viewport reveals the
>         // scrollbar, as the product's `[data-po-scrollbar]:hover` does.
>         if is_hover_to_show {
>             let viewport = prepaint.hitbox.clone();
>             let state = scrollbar_state.clone();
>             window.on_mouse_event(move |_: &MouseMoveEvent, phase, window, cx| {
>                 if !phase.bubble() {
>                     return;
>                 }
>                 let hovered = viewport.is_hovered(window);
>                 if state.get().owner_hovered != hovered {
>                     state.set(state.get().with_owner_hovered(hovered));
>                     cx.notify(view_id);
>                 }
>             });
>         }
> 
```

## Upgrading

Re-copy the new release into `vendor/gpui-base`, re-apply the diff below, and
re-run the editor pixel suite. Drop the patch once upstream offers gutter
metrics.

```diff
diff -ru registry/gpui-base-0.8.0/src/input/base/element.rs vendor/gpui-base/src/input/base/element.rs
--- registry/gpui-base-0.8.0/src/input/base/element.rs	2006-07-24 09:21:28
+++ vendor/gpui-base/src/input/base/element.rs	2026-10-29 18:27:13
@@ -1170,7 +1170,26 @@
         // line count up to seven digits.
         let line_number_len = line_number_len(total_lines);
 
-        let mut line_number_width = if state.mode.line_number() {
+        let metrics = state.gutter_metrics.filter(|_| state.mode.line_number());
+        let mut line_number_width = if let Some(g) = metrics {
+            // PuppyOne patch: CodeMirror sizes the column for the largest
+            // line number (its spacer), at least `number_width` wide.
+            let digits = total_lines.max(1).ilog10() as usize + 1;
+            let spacer = window.text_system().shape_line(
+                "9".repeat(digits).into(),
+                g.number_font_size,
+                &[TextRun {
+                    len: digits,
+                    font: style.font(),
+                    color: gpui::black(),
+                    background_color: None,
+                    underline: None,
+                    strikethrough: None,
+                }],
+                None,
+            );
+            (spacer.width + g.number_padding_left + g.number_padding_right).max(g.number_width)
+        } else if state.mode.line_number() {
             let empty_line_number = window.text_system().shape_line(
                 "+".repeat(line_number_len).into(),
                 font_size,
@@ -1194,8 +1213,11 @@
 
         if state.mode.is_folding() {
             // Add extra space for fold icons
-            line_number_width += FOLD_ICON_HITBOX_WIDTH
+            line_number_width += metrics.map_or(FOLD_ICON_HITBOX_WIDTH, |g| g.fold_width)
         }
+        if let Some(g) = metrics {
+            line_number_width += g.text_inset;
+        }
 
         (line_number_width, line_number_len)
     }
@@ -1406,10 +1428,17 @@
 
         // Second pass: create and prepaint icons
         let line_height = last_layout.line_height;
-        let line_number_width =
-            last_layout.line_number_width - LINE_NUMBER_RIGHT_MARGIN - FOLD_ICON_HITBOX_WIDTH;
+        let metrics = self.state.read(cx).gutter_metrics;
+        let fold_width = metrics.map_or(FOLD_ICON_HITBOX_WIDTH, |g| g.fold_width);
+        let line_number_width = match metrics {
+            // PuppyOne patch: the fold column ends where the text inset begins.
+            Some(g) => last_layout.line_number_width - g.text_inset - g.fold_width,
+            None => {
+                last_layout.line_number_width - LINE_NUMBER_RIGHT_MARGIN - FOLD_ICON_HITBOX_WIDTH
+            }
+        };
         let icon_relative_pos = point(
-            (FOLD_ICON_HITBOX_WIDTH - FOLD_ICON_WIDTH).half(),
+            (fold_width - FOLD_ICON_WIDTH).half(),
             (line_height - FOLD_ICON_WIDTH).half(),
         );
 
@@ -1421,7 +1450,7 @@
                     origin_x + icon_relative_pos.x + line_number_width,
                     bounds.origin.y + icon_relative_pos.y + info.offset_y,
                 ),
-                size(FOLD_ICON_HITBOX_WIDTH, line_height),
+                size(fold_width, line_height),
             );
 
             // Create and prepaint icon
@@ -3008,20 +3037,31 @@
         );
 
         let state = self.state.read(cx);
+        let metrics = state.gutter_metrics;
         let line_numbers = if state.mode.line_number() {
             let mut line_numbers = Vec::with_capacity(last_layout.visible_buffer_lines.len());
+            // PuppyOne patch: the product gutter's colours, size and the
+            // active number's weight (`.cm-activeLineGutter`).
+            let number_size = metrics.map_or(text_size, |g| g.number_font_size);
+            let active_font = {
+                let mut font = style.font();
+                if let Some(g) = metrics {
+                    font.weight = g.active_number_weight;
+                }
+                font
+            };
             let other_line_runs = vec![TextRun {
                 len: line_number_len,
                 font: style.font(),
-                color: state.editor_style.muted_foreground,
+                color: metrics.map_or(state.editor_style.muted_foreground, |g| g.number_color),
                 background_color: None,
                 underline: None,
                 strikethrough: None,
             }];
             let current_line_runs = vec![TextRun {
                 len: line_number_len,
-                font: style.font(),
-                color: state.editor_style.foreground,
+                font: active_font,
+                color: metrics.map_or(state.editor_style.foreground, |g| g.active_number_color),
                 background_color: None,
                 underline: None,
                 strikethrough: None,
@@ -3050,7 +3090,7 @@
                 sub_lines.push(
                     window
                         .text_system()
-                        .shape_line(line_no, text_size, &runs, None),
+                        .shape_line(line_no, number_size, &runs, None),
                 );
                 for _ in 0..line.wrapped_lines.len().saturating_sub(1) {
                     sub_lines.push(ShapedLine::default());
@@ -3149,6 +3189,12 @@
             editor_style.background
         };
 
+        // PuppyOne patch: the product gutter, when the owner set one.
+        let (metrics, fold_column) = {
+            let state = self.state.read(cx);
+            (state.gutter_metrics, state.mode.is_folding())
+        };
+
         // Paint active line
         let mut offset_y = px(0.);
         if let Some(line_numbers) = prepaint.line_numbers.as_ref() {
@@ -3160,13 +3206,17 @@
                 .zip(prepaint.last_layout.visible_buffer_lines.iter())
             {
                 let is_active = prepaint.current_row == Some(buffer_line);
-                let p = point(input_bounds.origin.x, origin.y + offset_y);
+                // PuppyOne patch: the active line starts at the gutter's edge.
+                let gutter = metrics.map_or(px(0.), |g| {
+                    prepaint.last_layout.line_number_width - g.text_inset
+                });
+                let p = point(input_bounds.origin.x + gutter, origin.y + offset_y);
                 let height = line_height * lines.len() as f32;
                 // Paint the current line background
                 if is_active {
                     if let Some(bg_color) = active_line_color {
                         window.paint_quad(fill(
-                            Bounds::new(p, size(bounds.size.width, height)),
+                            Bounds::new(p, size(bounds.size.width - gutter, height)),
                             bg_color,
                         ));
                     }
@@ -3356,12 +3406,16 @@
             let gutter_bg = editor_style
                 .editor_gutter_background
                 .unwrap_or(editor_background);
-            let gutter_bounds = editor_gutter_bounds(
+            let mut gutter_bounds = editor_gutter_bounds(
                 input_bounds,
                 prepaint.last_layout.line_number_width,
                 prepaint.ghost_lines_height,
                 editor_paddings,
             );
+            // PuppyOne patch: the text inset belongs to the line, not the gutter.
+            if let Some(g) = metrics {
+                gutter_bounds.size.width -= g.text_inset;
+            }
             window.paint_quad(fill(gutter_bounds, gutter_bg));
 
             // Each item is the normal lines.
@@ -3374,7 +3428,7 @@
 
                 let height = line_height * lines.len() as f32;
                 // paint active line number background
-                if is_active {
+                if is_active && metrics.is_none() {
                     if let Some(bg_color) = active_line_color {
                         window.paint_quad(fill(
                             Bounds::new(
@@ -3387,7 +3441,22 @@
                 }
 
                 for line in lines {
-                    _ = line.paint(p, line_height, TextAlign::Left, None, window, cx);
+                    // PuppyOne patch: numbers right-aligned in their column.
+                    let at = match metrics {
+                        Some(g) => {
+                            let column = prepaint.last_layout.line_number_width
+                                - g.text_inset
+                                - if fold_column { g.fold_width } else { px(0.) };
+                            point(
+                                gutter_bounds.origin.x + column
+                                    - g.number_padding_right
+                                    - line.width,
+                                p.y,
+                            )
+                        }
+                        None => p,
+                    };
+                    _ = line.paint(at, line_height, TextAlign::Left, None, window, cx);
                     offset_y += line_height;
                 }
 
diff -ru registry/gpui-base-0.8.0/src/input/base/state.rs vendor/gpui-base/src/input/base/state.rs
--- registry/gpui-base-0.8.0/src/input/base/state.rs	2006-07-24 09:21:28
+++ vendor/gpui-base/src/input/base/state.rs	2026-10-29 18:30:03
@@ -11,6 +11,7 @@
     UTF16Selection, WeakFocusHandle, Window, actions, div, point, prelude::FluentBuilder as _, px,
 };
 use gpui::{Autocapitalize, TextInputAction, TextInputConfiguration};
+use gpui::{FontWeight, Hsla};
 use ropey::{Rope, RopeSlice};
 use serde::Deserialize;
 use std::borrow::Cow;
@@ -405,7 +406,30 @@
 /// public: an alias is only as usable as the type behind it, so hiding this
 /// would leave `InputState` unable to do anything. Prefer naming the aliases
 /// — write `InputState`, not `InputBaseState<InputMode>`.
+/// PuppyOne patch: the code editor's gutter as the product draws it
+/// (CodeMirror `.cm-lineNumbers` / `.cm-foldGutter`). Without it the editor
+/// keeps its own gutter.
+#[derive(Clone, Copy, Debug, PartialEq)]
+pub struct GutterMetrics {
+    /// The line-number column (border box), its paddings and font size;
+    /// numbers are right-aligned inside the paddings.
+    pub number_width: Pixels,
+    pub number_padding_left: Pixels,
+    pub number_padding_right: Pixels,
+    pub number_font_size: Pixels,
+    pub number_color: Hsla,
+    pub active_number_color: Hsla,
+    pub active_number_weight: FontWeight,
+    /// The fold column after the numbers.
+    pub fold_width: Pixels,
+    /// Space between the gutter and the text, inside the line (its active
+    /// line background starts at the gutter's edge; the gutter has none).
+    pub text_inset: Pixels,
+}
+
 pub struct InputBaseState<M: InputModeKind> {
+    /// The product gutter (PuppyOne patch); `None` keeps the default one.
+    pub(super) gutter_metrics: Option<GutterMetrics>,
     /// State only this mode needs. See [`InputModeKind::Extras`].
     pub(crate) extras: M::Extras,
     pub(super) focus_handle: FocusHandle,
@@ -918,6 +942,7 @@
             editor_scrollbar_snapshot: Cell::new(None),
             longest_line_width: Cell::new(None),
             editor_paddings: Edges::default(),
+            gutter_metrics: None,
             deferred_scroll_offset: None,
             placeholder: SharedString::default(),
             mask_pattern: MaskPattern::default(),
@@ -1021,8 +1046,22 @@
 
     /// Set presentation padding for multi-line text and its scrollbar layout.
     #[doc(hidden)]
-    pub fn set_editor_paddings(&mut self, paddings: Edges<Pixels>) {
+    pub fn set_editor_paddings(&mut self, mut paddings: Edges<Pixels>) {
+        // The product code editor has no content padding: its gutter starts
+        // at the edge and the first line at the top (`.cm-content`'s padding
+        // resolves to 0).
+        if self.gutter_metrics.is_some() {
+            paddings = Edges::default();
+        }
         self.editor_paddings = paddings;
+    }
+
+    /// PuppyOne patch: draw the product gutter ([`GutterMetrics`]).
+    pub fn set_gutter_metrics(&mut self, metrics: Option<GutterMetrics>) {
+        self.gutter_metrics = metrics;
+        if metrics.is_some() {
+            self.editor_paddings = Edges::default();
+        }
     }
 
     pub fn apply_highlighter_fold_candidates(
diff -ru registry/gpui-base-0.8.0/src/input/mod.rs vendor/gpui-base/src/input/mod.rs
--- registry/gpui-base-0.8.0/src/input/mod.rs	2006-07-24 09:21:28
+++ vendor/gpui-base/src/input/mod.rs	2026-10-29 18:26:27
@@ -91,6 +91,7 @@
     DiagnosticSummary, DiagnosticTag, RelatedInformation,
 };
 pub use display_map::{BufferPoint, DisplayMap, DisplayPoint, FoldRange, WrappingIndent};
+pub use state::GutterMetrics;
 pub use editor::{Editor, EditorState};
 pub use highlighting::{
     DiagnosticColors, FoldIconRenderer, HighlightStyleResolver, InputEditorStyle, InputHighlighter,
```
