import json,sys
sys.argv=['x']
exec(open('/Users/supersayajin/project/rust-test-parity-work/parity.py').read().split('def cmd_summary')[0])
left=unreviewed(load())
def ts(*paths):
    return [{'path':p,'cases':left[p]} for p in paths if left.get(p)]
prov={'package':'po-app','target':'puppy-one-rust','test':'app::tests::bundled_modules::bundles_ship_the_reviewed_product_modules'}
def ed(t): return {'package':'po-editor','test':t}
def pl(t): return {'package':'po-platform','test':t}
rows=[
 {'id':'office-preview-product-modules','acceptance':'The Office preview runs the product\'s own Word, spreadsheet, presentation and text-fallback viewers, package preflight, decompression validation and DOCX sanitizer, shipped byte-identical to the reviewed sources this suite exercises (worker lifetimes, cell kinds and formulas, hidden sheets, rows and columns, merged cells, payload and cell caps, keyboard selection, ZIP central-directory and OOXML checks, sanitized DOCX DOM, slide and layout geometry, font compatibility); the native page boots that bundle, serves the file through the private protocol and reads only typed messages.',
  'typescript':ts('tests/unit/editor/formats/office/docxDomSanitizer.test.ts','tests/unit/editor/formats/office/officePackageValidation.test.ts','tests/unit/editor/formats/office/officeResourceLoader.test.ts','tests/unit/editor/formats/office/officeTextFallback.test.ts','tests/unit/editor/formats/office/presentationPreview.test.ts','tests/unit/editor/formats/office/spreadsheetPreview.test.ts','tests/unit/editor/formats/office/wordPreviewLayout.test.ts','tests/unit/editor/formats/office/zipCentralDirectoryPreflight.test.ts','tests/component/editor/formats/office/officeFontCompatibility.test.ts'),
  'rust':[prov,ed('editor::viewers::office::tests::the_page_boots_the_product_bundle_and_reads_only_typed_messages'),ed('editor::viewers::office::admission_tests::office_private_protocol_serves_exact_bytes_ranges_and_retires_all_resources_with_the_lease')]},
 {'id':'context-map-product-modules','acceptance':'The Context Map runs the product\'s own document, filter, graph, layout, routing and wheel navigation modules, shipped byte-identical to the reviewed sources this suite exercises; the native page carries the document, lists the workspace and drives the pane menu.',
  'typescript':ts('tests/unit/editor/formats/context-map/contextMapDocument.test.ts','tests/unit/editor/formats/context-map/contextMapFilters.test.ts','tests/unit/editor/formats/context-map/contextMapGraph.test.ts','tests/unit/editor/formats/context-map/contextMapLayout.test.ts','tests/unit/editor/formats/context-map/contextMapRouting.test.ts','tests/unit/editor/formats/context-map/contextMapWheelNavigation.test.ts'),
  'rust':[prov,ed('editor::viewers::structured::tests::the_page_carries_the_document_and_serves_the_agent_marks'),ed('editor::viewers::structured::tests::the_context_map_lists_the_workspace_and_drives_the_pane_menu')]},
 {'id':'app-preview-product-modules','acceptance':'The App Preview viewer runs the product\'s own setup, state, frame and session views and creation and manifest modules, shipped byte-identical to the reviewed sources this suite exercises; natively the manifest follows the product contract, the frame admits only the running app and the runtime trusts, runs and replaces apps as the product does.',
  'typescript':ts('tests/unit/editor/formats/app-preview/appPreviewCreation.test.ts','tests/unit/editor/formats/app-preview/appPreviewManifest.test.mjs','tests/component/editor/formats/app-preview/appPreviewIframe.test.tsx','tests/component/editor/formats/app-preview/appPreviewOnboarding.test.tsx','tests/component/editor/formats/app-preview/appPreviewRuntimeLifecycle.test.tsx','tests/unit/editor/runtime/ipcErrorMessage.test.ts'),
  'rust':[prov,pl('platform::app_preview::manifest::tests::manifests_follow_the_product_contract'),ed('editor::viewers::app_preview::tests::requests_are_typed_and_the_frame_admits_only_the_running_app'),pl('platform::app_preview::runtime::tests::static_files_and_local_servers_run_once_trusted')]},
 {'id':'render-service-performance-modules','acceptance':'The diagram render service measures its work with the product\'s own renderer performance tracker, shipped byte-identical to the reviewed sources this suite exercises.',
  'typescript':ts('tests/unit/editor/runtime/rendererPerformanceCompletion.test.ts','tests/unit/editor/runtime/rendererPerformanceTracker.test.ts'),
  'rust':[prov,ed('render_service::tests::what_is_drawn_names_the_cache_entry')]},
]
json.dump(rows,open('/Users/supersayajin/project/rust-test-parity-work/rows/editor-unit-3.json','w'),indent=1,ensure_ascii=False)
print(sum(len(t['cases']) for r in rows for t in r['typescript']))
