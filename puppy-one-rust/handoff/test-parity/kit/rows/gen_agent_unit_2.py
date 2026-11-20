import json
def r(test, pkg='po-app'):
    d={'package':pkg,'test':test}
    if pkg=='po-app': d['target']='puppy-one-rust'
    return d
ip='agent::application::tests::input_policy::'
br='ui::agent_brands::tests::'
tr='agent::domain::transcript::tests::'
rows=[
 {'id':'agent-file-presence-claims','acceptance':'Agent file claims project only onto their own window and file; a write outranks a read, a cancelled claim goes at once and a finished one lingers before it goes; Editor and Explorer paths share one workspace-relative key and paths outside the workspace, the root itself and parent escapes are refused.',
  'typescript':[{'path':'tests/unit/agent/activity/agentActivityStore.test.ts','cases':[0,1,2,3,4]}],
  'rust':[r('features::agent_presence::tests::claims_project_onto_their_window_and_file'),r('platform::agent_activity::path_policy::tests::only_paths_inside_the_workspace_become_public','po-platform')]},
 {'id':'agent-reference-admission-policy','acceptance':'References are admitted by semantic kind with stable typed failures for unsupported kinds, limits and a missing capability; only authenticated, atomic mention ranges compile into native paths (a resource block keeps the display mention); forged, overlapping, missing and image mentions are refused while SVG and directory mentions pass.',
  'typescript':[{'path':'tests/unit/agent/composer/electron.agent-input-policy.test.mjs','cases':[0,1,2,3,4]}],
  'rust':[r(ip+x,'po-agent') for x in ['admits_references_by_semantic_kind_instead_of_native_transport','returns_stable_typed_failures_for_unsupported_kinds_and_native_kind_limits','compiles_only_authenticated_atomic_mention_ranges_into_native_paths','keeps_the_display_mention_in_prompt_text_when_the_harness_negotiated_a_resource_block','rejects_forged_overlapping_missing_and_image_mention_ranges']]},
 {'id':'js-cyclic-provider-payloads','kind':'out-of-scope','reason':'TS guards provider payloads that are cyclic JavaScript object graphs before IPC delivery. Native provider payloads are parsed JSON (serde_json::Value is a tree) and cannot be cyclic; the size and shape bounds are the agent-normalized-event-boundary contract.',
  'owner':'puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/agent/contract/js-semantics.md',
  'typescript':[{'path':'tests/unit/agent/events/electron.agent-events.test.mjs','cases':[3]}]},
 {'id':'agent-event-path-migration','acceptance':'A restored session\'s saved file-change paths and a live one are both workspace-relative, and nothing reaches a renderer directly.',
  'typescript':[{'path':'tests/unit/agent/references/electron.agent-event-workspace-paths.test.mjs','cases':[3]}],
  'rust':[r('agent::runtimes::display_acceptance_tests::restored_and_live_file_change_paths_become_workspace_relative','po-agent')]},
 {'id':'agent-attachment-semantic-kinds','acceptance':'Attachments classify as image, text (including SVG and extension-only Markdown), audio, video or binary without any Harness transport, and only declared kinds, MIME patterns and extensions are accepted.',
  'typescript':[{'path':'tests/unit/agent/references/electron.agent-reference-capabilities.test.mjs','cases':[0,1]}],
  'rust':[r('agent::contract::reference_input::tests::classifies_semantic_input_kinds_without_knowing_any_harness_transport','po-contracts'),r('agent::contract::reference_input::tests::admits_only_the_declared_semantic_kinds_mime_patterns_and_extensions','po-contracts')]},
 {'id':'native-picker-type-filters','kind':'out-of-scope','reason':'TS derives accept-lists for its HTML file input from the attachment capabilities (and leaves it unrestricted when a path-delivered class accepts everything). GPUI\'s native path prompt takes no file-type filter, so the picker is always unrestricted and unsupported files are refused when staged.',
  'owner':'puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/agent/chat/drafts-and-references.md',
  'typescript':[{'path':'tests/unit/agent/references/electron.agent-reference-capabilities.test.mjs','cases':[2]}]},
 {'id':'agent-brand-catalog','acceptance':'Agent brands are recognized by whole words however a name is written (never from part of a word or a shared word), runtime ids and aliases resolve (Pi is not an ordinary word), every brand has one id, a name, a scale and existing themed assets (a currentColor mark has a dark asset), colour marks follow the theme from their own assets, and ChatGPT, Claude, Codex, Cursor and Pi have monochrome vectors (Codex shares ChatGPT\'s).',
  'typescript':[{'path':'tests/unit/agent/runtimes/discovery/agentBrandCatalog.test.tsx','cases':[0,1,2,3,5,6,7,8,9,10,11,12,13,14]}],
  'rust':[r(br+x,'po-ui') for x in ['recognizes_a_brand_however_an_agent_writes_its_name','claims_no_brand_from_part_of_a_word_or_a_shared_word','resolves_runtime_aliases_without_confusing_pi_with_ordinary_words','every_brand_has_one_id_a_name_a_scale_and_themed_assets','colour_marks_follow_the_theme_from_their_own_assets','monochrome_marks_are_vectors_drawn_in_the_surface_colour']]},
 {'id':'codex-colour-mark','kind':'out-of-scope','reason':'TS draws Codex\'s colour image with the ChatGPT artwork, which is white-only and disappears on light surfaces. The native in-chat launcher draws Codex\'s colour image from the Codex app icon (codex-light/dark.png); the monochrome Codex mark is ChatGPT\'s vector as in TS (agent-brand-catalog).',
  'owner':'puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/agent/chat/theme-and-brand.md',
  'typescript':[{'path':'tests/unit/agent/runtimes/discovery/agentBrandCatalog.test.tsx','cases':[4]}]},
 {'id':'agent-routing-preference-scope','acceptance':'A route change stays with its own runtime and keeps the selection; legacy routes migrate without becoming an explicit choice; the channel-ambiguous legacy WorkBuddy route is cleared.',
  'typescript':[{'path':'tests/unit/agent/runtimes/discovery/agentRoutingPreferences.test.ts','cases':[0,1,2]}],
  'rust':[r('features::settings::agent_routing_preferences::tests::a_route_change_stays_with_its_own_runtime'),r('features::settings::agent_routing_preferences::tests::parses_versions_and_migrates_only_the_legacy_route'),r('features::settings::agent_routing_preferences::tests::the_ambiguous_legacy_workbuddy_route_is_cleared')]},
 {'id':'native-registry-default-selection','kind':'out-of-scope','reason':'The TS registry selects a configured default runtime from a catalog (without readiness fallback) and reports active resources. The native registry only validates its default; a chat always names its runtime (the launcher choice or routing preferences), and cleanup is covered by the registry cleanup contract.',
  'owner':'puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/agent/host/runtime-resolution.md',
  'typescript':[{'path':'tests/unit/agent/runtimes/discovery/electron.agent-runtime-registry.test.mjs','cases':[11]}]},
 {'id':'local-connection-characterization','acceptance':'Local connection characterization preserves every probe, gate and field case of the product snapshots, never reads gates before the probe is ready and never reads the workspace gate after a backend denial.',
  'typescript':[{'path':'tests/unit/agent/runtimes/discovery/localAgentConnectionPolicy.test.mjs','cases':list(range(28))}],
  'rust':[r('agent::connections::tests::preserves_the_local_connection_characterization','po-agent'),r('agent::connections::tests::does_not_read_admission_gates_before_the_probe_is_ready','po-agent'),r('agent::connections::tests::does_not_read_the_workspace_gate_after_backend_denial','po-agent')]},
 {'id':'local-agent-launcher-visibility','acceptance':'Detected Agents show by default; hiding one persists only its id, showing it again removes it, and hidden ids stay sorted so the same choices persist the same list.',
  'typescript':[{'path':'tests/unit/agent/runtimes/discovery/localAgentSelection.test.ts','cases':[0,1]}],
  'rust':[r('features::settings::preference_types::tests::launchers_show_by_default_and_only_sorted_hidden_ids_persist'),r('features::local_agents::settings::tests::detected_agents_list_with_their_hooks_and_only_hidden_ids_persist')]},
 {'id':'local-tools-discovered-on-request','acceptance':'Opening a chat never scans local tools; the local Agents scan runs when its surface asks and scans again only on an explicit refresh.',
  'typescript':[{'path':'tests/unit/agent/sessions/desktop-agent.controller-runtimes.test.ts','cases':[13]}],
  'rust':[r('features::desktop_agent::application::tests::controller::discovers_installed_agents_without_selecting_or_resuming_one'),r('features::local_agents::discovery::tests::only_an_explicit_refresh_scans_again')]},
 {'id':'harness-lifecycle-conformance','acceptance':'The live activity states are queued, running, pending, in-progress and waiting-for-user; for every Harness a completed, failed or interrupted turn settles its reasoning, answer, approval, question, connection state and live parts; rows keep their first sequence across later completion events.',
  'typescript':[{'path':'tests/unit/agent/sessions/desktop-agent.harness-lifecycle-conformance.test.ts','cases':list(range(21))}],
  'rust':[r(tr+x,'po-agent') for x in ['defines_the_complete_shared_set_of_live_activity_states','every_harness_child_settles_on_each_terminal_outcome','every_harness_keeps_its_rows_stable_across_later_completions']]},
]
json.dump(rows,open('/Users/supersayajin/project/rust-test-parity-work/rows/agent-unit-2.json','w'),indent=1,ensure_ascii=False)
