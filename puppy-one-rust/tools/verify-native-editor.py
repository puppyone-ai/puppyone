#!/usr/bin/env python3
"""Verify the shipping native editor contracts, without opening OS windows.

Replaces the retired native-editor-probe, whose input adapter was removed
when the application adopted src/editor. This executes the production
editor's tests, not a second editor implementation. Real OS IME/visual and
cross-platform acceptance remain separate.
"""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
out = root / 'artifacts/native-editor-verification'
out.mkdir(parents=True, exist_ok=True)
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
# Require named behavior as well as a nonempty suite. A renamed/removed test
# must be reviewed here; a typo in a filter must never produce a green receipt.
suites = {
    'editor::view::ime_tests::': [
        'pinyin_commits_once_and_undoes_in_one_step',
        'a_cancelled_composition_changes_nothing_but_reports_its_end',
        'utf16_ranges_around_emoji_and_cjk',
        'the_candidate_window_anchors_on_the_marked_text',
        'read_only_commits_and_turns_text_input_off',
    ],
    'editor::csv::view::tests::': [
        'typing_replaces_the_selected_value_and_history_belongs_to_the_table',
        'an_ime_composition_in_a_cell_reaches_the_model_once',
        'source_mode_edits_the_raw_text_and_returns_it_to_the_table',
        'column_resize_clamps_cancels_and_auto_fits',
    ],
    'editor::host::tests::': [
        'a_snapshot_waits_for_the_composition_and_resumes_when_it_ends',
        'csv_contributes_view_items_and_find',
        'find_marks_and_selects_matches_in_text_editors',
        'code_snapshot_defers_during_ime_and_freezes_until_thawed',
        'code_search_shortcut_opens_the_product_find_bar',
    ],
    'editor::viewers::code::tests::': [
        'code_ime_is_provisional_until_commit_or_cancel',
        'code_unmark_preserves_single_undo_transaction',
        'code_external_reload_abandons_preedit_and_readonly_blocks_input',
        'code_language_rebind_keeps_entity_selection_and_history',
        'code_platform_typing_autocloses_and_indents_json',
        'code_multicursor_edits_are_one_undo_transaction',
        'code_find_wraps_without_changing_the_document',
        'code_find_starts_at_selection_and_updates_after_edits',
    ],
    'editor::markdown::tests::svg_isolation_acceptance::': [
        'svg_blocks_absolute_local_image_href_while_allowing_embedded_data_png',
        'svg_blocks_relative_image_href_against_cwd_and_parent_traversal',
        'svg_blocks_xlink_href_local_image_while_allowing_xlink_data_png',
        'svg_blocks_nested_svg_file_and_nested_data_svg_local_image_reads',
        'svg_blocks_fe_image_and_css_url_external_references',
        'svg_blocks_external_use_href_while_preserving_local_use_paint_references',
        'svg_ignores_script_foreign_object_animation_event_handlers_remote_paint_and_style_import',
        'image_viewer_svg_decode_blocks_local_file_reads_while_rendering_safe_svg',
        'markdown_document_svg_only_reads_policy_approved_workspace_assets_via_document_assets',
    ],
    'editor::markdown::tests::viewport_stability::': [
        'layout_and_modes::t2_01_width_resize_cycles_hold_across_all_top_kinds',
        'layout_and_modes::t2_02_height_resize_holds_across_all_top_kinds',
        'layout_and_modes::t2_03_bottom_height_growth_clamps_last_line_flush',
        'layout_and_modes::t2_04_font_scale_switches_hold_viewport_top',
        'layout_and_modes::t2_05_theme_switches_hold_viewport_top',
        'layout_and_modes::t2_06_live_preview_source_round_trips_hold_viewport_top',
        'layout_and_modes::t2_15_blur_and_refocus_with_caret_above_viewport_holds_top_text',
        'layout_and_modes::t2_16_scroll_jump_then_immediate_width_resize_holds_jumped_top_text',
        'layout_and_modes::t2_17_page_down_caret_reveal_then_width_resize_holds_revealed_top_text',
        'edits_and_async::t2_07_external_insert_above_viewport_holds_top_text',
        'edits_and_async::t2_08_external_delete_above_viewport_holds_top_text',
        'edits_and_async::t2_09_external_append_below_viewport_holds_top_text',
        'edits_and_async::t2_10_external_delete_of_anchored_paragraph_falls_back_cleanly',
        'edits_and_async::t2_11_typing_inside_viewport_holds_top_text',
        'edits_and_async::t2_12_edit_undo_redo_above_viewport_holds_top_text',
        'edits_and_async::t2_13_async_image_decode_above_viewport_holds_top_text',
        'edits_and_async::t2_14_html_block_measured_height_above_viewport_holds_top_text',
    ],
    'editor::markdown::tests::style_contracts::': [
        'typography_and_theme::t3_math_01_native_frontend_never_injects_font_into_math_render_requests',
    ],
    'editor::view::heights::tests::': [
        'incremental_splice_and_reveal_overlay_avoid_full_plan_rebuilds',
        'width_resize_is_o1_with_zero_rehashes_and_width_keyed_known_cache',
    ],
    'editor::markdown::tests::scale_and_resize_acceptance::': [
        't4_width_resize_on_1600_sections_does_zero_block_rehashes',
        't4_single_list_10k_task_toggle_and_typing_patch_incrementally',
        't4_extreme_documents_edit_and_navigate_cleanly',
        'a_one_item_edit_in_a_long_list_compiles_only_its_lines',
    ],
    'editor::markdown::tests::concurrent_edit_acceptance::': [
        't5_b7_code_block_escape_and_blur_keep_typed_text_and_leave_editing_state',
        't5_b8_ime_composition_inside_code_block_abandoned_cleanly_on_external_edit',
    ],
    'editor::markdown::tests::clipboard_acceptance::': [
        't6_01_live_preview_copy_writes_exact_raw_markdown_including_hidden_markers',
        't6_02_cross_block_selection_copy_across_paragraph_table_and_next_paragraph',
        't6_03_cut_removes_exact_slice_and_single_undo_restores_text_and_selection',
        't6_04_multiline_paste_in_list_item_inserts_verbatim_and_undoes_in_one_step',
        't6_05_multiline_paste_in_table_cell_preserves_table_structure',
        't6_06_read_only_allows_copy_and_blocks_cut_and_paste',
        't6_07_selecting_entire_table_block_copies_exact_table_source',
    ],
    'editor::markdown::tests::pipeline_acceptance::': [
        'random_operations_keep_the_layout_consistent',
    ],
    'editor::markdown::tests::remote_image_proxy_acceptance::': [
        'remote_markdown_image_loads_through_a_proxy_with_fake_ip_dns',
    ],
    'editor::markdown::platform::policy::network::tests::': [
        'a_system_proxy_carries_remote_images_past_fake_ip_dns',
        'a_system_proxy_never_opens_local_or_plain_http_urls',
        'remote_redirects_follow_the_same_routing_rule',
    ],
    'editor::markdown::tests::hosted_asset_acceptance::': [
        'a_hosted_document_loads_absolute_assets_only_inside_its_own_root',
        'a_local_document_never_loads_an_absolute_hosted_url',
    ],
    'editor::markdown::shared::media::tests::': [
        'hosted_absolute_references_resolve_only_inside_the_documents_root',
    ],
    'editor::markdown::tests::render_budget_acceptance::': [
        'a_soft_over_budget_html_block_waits_for_activation',
        'a_large_diagram_waits_and_a_long_fence_stays_source',
    ],
    'editor::markdown::tests::html_fragment_targets_acceptance::': [
        'controlled_inline_html_ids_resolve',
        'literal_incomplete_or_unsupported_html_registers_nothing',
        'fragments_decode_once_and_ids_keep_their_case',
        'explicit_ids_win_over_heading_slugs',
        'targets_are_per_document_and_follow_edits',
        'a_distant_edit_reparses_only_its_block_and_moves_the_target',
        'a_target_turned_into_code_disappears',
        'an_empty_anchor_is_one_hidden_deletion_unit',
        'empty_anchors_hide_without_changing_their_source',
        'incomplete_or_unsupported_anchors_stay_source',
        'an_anchor_reveals_for_editing_and_folds_again',
        'links_reach_an_explicit_target',
        'a_renamed_target_is_unavailable_until_restored',
        'a_legacy_anchor_name_is_its_id_unless_an_id_is_given',
    ],
    'editor::markdown::tests::inline_html_break_acceptance::': [
        'a_bare_br_compiles_into_a_line_break_atom',
        'a_bare_br_draws_a_line_break_and_reveals_its_source',
        'inline_style_font_weight_applies',
    ],
    'editor::markdown::tests::html_presentation_acceptance::': [
        'a_picture_loads_its_matching_candidate_without_the_fallback_first',
        'a_refused_candidate_gives_way_to_the_fallback_image',
        'a_picture_with_no_allowed_candidate_shows_its_alt_text',
        'valid_presentation_values_are_kept',
        'invalid_presentation_values_are_omitted',
        'kept_presentation_values_draw',
        'cell_vertical_alignment_places_the_content',
    ],
    'editor::markdown::tests::html_run_acceptance::': [
        'readme_download_cards_draw_as_linked_theme_pictures',
        'a_picture_follows_the_colour_mode',
        'the_list_continuation_indent_stays_outside_the_run',
        'runs_draw_without_exposing_tags',
        'text_around_a_run_stays_ordinary_text',
        'markdown_inside_a_run_renders_but_escaped_text_stays_text',
        'html_blocks_on_marker_lines_draw_as_block_runs',
        'a_multi_line_run_keeps_one_classification_in_any_slice',
        'a_quoted_multi_line_run_drops_its_quote_prefixes',
        'an_image_inside_a_task_item_draws',
        'a_multi_line_block_after_a_quote_marker_draws_as_one_run',
        'an_image_line_inside_a_paragraph_is_a_run_not_a_block',
        'passive_elements_draw_without_exposing_tags',
        'an_empty_element_hides_and_its_source_stays',
        'a_nested_blocked_element_is_removed',
        'without_an_asset_broker_media_stays_source',
        'a_caret_at_either_edge_or_inside_shows_the_exact_source',
        'the_run_draws_again_when_the_caret_leaves',
        'markdown_nested_in_a_run_does_not_take_the_reveal',
        'a_read_only_surface_never_reveals',
        'a_selection_across_the_run_keeps_it_drawn',
        'deletion_at_the_run_edges_removes_one_character',
        'the_run_is_the_reveal_element_on_either_edge',
        'links_and_disclosures_keep_their_gestures_and_other_clicks_reveal',
        'runs_in_table_cells_draw_through_the_media_path',
        'a_raw_html_image_in_a_paragraph_draws_through_the_broker',
        'a_raw_html_image_edits_through_its_revealed_source',
        'a_single_line_html_video_draws_through_the_media_path',
        'audio_in_a_sentence_resolves_through_the_media_path_as_audio',
    ],
}
paths = [root / p for p in ['Cargo.toml', 'Cargo.lock', 'tools/verify-native-editor.py']]
paths.extend(p for folder in ['src', 'assets', 'crates'] for p in sorted((root / folder).rglob('*')) if p.is_file())
def hashes():
    return {os.path.relpath(p, root): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
before = hashes()
# An old passing receipt must not survive a failed current run.
receipt_path = out / 'result.json'
receipt_path.unlink(missing_ok=True)
build = subprocess.run([cargo, 'test', '--locked', '--features', 'dev-capture',
                        '--no-run', '--message-format=json'], cwd=root, text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
(out / 'build.log').write_text(build.stderr)
if build.returncode:
    raise SystemExit(build.stderr)
artifacts = [json.loads(line) for line in build.stdout.splitlines() if line.startswith('{')]
binary = next(a['executable'] for a in artifacts if a.get('reason') == 'compiler-artifact'
              and a.get('profile', {}).get('test') and a.get('executable')
              and a.get('target', {}).get('name') == 'po_editor')
checks = []
for prefix, required in suites.items():
    name = prefix.removeprefix('editor::').replace('::', '-').rstrip('-')
    run = subprocess.run([binary, prefix, '--test-threads=1', '--color=never'], cwd=root,
                         text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (out / f'{name}.log').write_text(run.stdout)
    passed = re.findall(r'^test (\S+) \.\.\. ok$', run.stdout, re.M)
    missing = [prefix + t for t in required if prefix + t not in passed]
    if run.returncode or missing or not passed:
        print(run.stdout)
        raise SystemExit(f'{name} failed; required contracts not passed: {missing}')
    checks.append({'suite': prefix, 'passed': len(passed), 'tests': passed})
    print(f'{name}: {len(passed)} passed', flush=True)
if hashes() != before:
    raise SystemExit('Editor sources changed during verification; rerun a stable snapshot.')
receipt_path.write_text(json.dumps({
    'passed': True,
    'scope': 'Production native editor synthetic GPUI contracts; not OS IME, visual or cross-platform acceptance',
    'verifiedAt': datetime.now().astimezone().isoformat(),
    'platform': platform.platform(),
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'sourceUnchangedDuringVerification': True,
    'sourceHashes': before,
    'checks': checks,
}, ensure_ascii=False, indent=2) + '\n')
print('Production native editor contracts passed.')
