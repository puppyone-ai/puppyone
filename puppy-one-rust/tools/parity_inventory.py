"""Case-level review accounting; a file citation never implies all its cases."""


def case_inventory(manifest, collected, runtime, auxiliary):
    if collected['referenceCommit'] != manifest['referenceCommit']:
        raise ValueError('Collected TS cases belong to another reference commit')
    files = {item['path']: item for item in collected['files']}
    if len(files) != len(collected['files']) or set(files) != set(runtime):
        raise ValueError('Collected TS files differ from the actual runtime discovery set')
    def cited(rows, label):
        cases = set()
        for row in rows:
            for citation in row['typescript']:
                for case in citation.get('cases', []):
                    file = files.get(citation['path'])
                    if file is None or file['sha256'] != citation['sha256']:
                        raise ValueError(f"{label} citation source drift: {citation['path']}")
                    index = case['index']
                    if type(index) is not int or index < 0 or index >= len(file['cases']):
                        raise ValueError(f"Invalid case index: {case}")
                    if file['cases'][index]['name'] != case['name']:
                        raise ValueError(f"Case identity drift: {case}")
                    cases.add((citation['path'], index))
        return cases
    reviewed = cited(manifest['contracts'], 'Case')
    # A reviewed case Rust does not meet is a known difference with a reason
    # and an owning document: a `gap` keeps parity incomplete; `out-of-scope`
    # cites the scope decision that excludes it. Neither counts as reviewed.
    differences = manifest.get('knownDifferences', [])
    for item in differences:
        if item.get('kind') not in ('gap', 'out-of-scope'):
            raise ValueError(f"Unknown difference kind: {item.get('id')}")
        if not (item.get('reason') and item.get('owner') and item.get('typescript')):
            raise ValueError(f"Known difference without reason, owner or cases: {item.get('id')}")
    gaps = cited([item for item in differences if item['kind'] == 'gap'], 'Known gap')
    excluded = cited([item for item in differences if item['kind'] == 'out-of-scope'], 'Out-of-scope')
    for overlap in (reviewed & gaps, reviewed & excluded, gaps & excluded):
        if overlap:
            raise ValueError(f"Cases cited twice: {sorted(overlap)}")
    all_cases = [dict(path=path, index=index, **case)
                 for path, file in sorted(files.items())
                 for index, case in enumerate(file['cases'])]
    return {
        'runtimeCaseCount': len(all_cases),
        'reviewedCaseCount': len(reviewed),
        'knownGapCases': [case for case in all_cases if (case['path'], case['index']) in gaps],
        'outOfScopeCases': [case for case in all_cases if (case['path'], case['index']) in excluded],
        'unreviewedCases': [case for case in all_cases
                            if (case['path'], case['index']) not in reviewed | gaps | excluded],
        'skippedCases': [case for case in all_cases if case['skipped']],
        # Auxiliary smoke/bench entries require their own execution contract;
        # ordinary runtime case citations cannot close them.
        'unreviewedAuxiliaryFiles': sorted(auxiliary),
    }
