"""Case-level review accounting; a file citation never implies all its cases."""


def case_inventory(manifest, collected, runtime, auxiliary):
    if collected['referenceCommit'] != manifest['referenceCommit']:
        raise ValueError('Collected TS cases belong to another reference commit')
    files = {item['path']: item for item in collected['files']}
    if len(files) != len(collected['files']) or set(files) != set(runtime):
        raise ValueError('Collected TS files differ from the actual runtime discovery set')
    reviewed = set()
    for row in manifest['contracts']:
        for citation in row['typescript']:
            for case in citation.get('cases', []):
                file = files.get(citation['path'])
                if file is None or file['sha256'] != citation['sha256']:
                    raise ValueError(f"Case citation source drift: {citation['path']}")
                index = case['index']
                if type(index) is not int or index < 0 or index >= len(file['cases']):
                    raise ValueError(f"Invalid case index: {case}")
                if file['cases'][index]['name'] != case['name']:
                    raise ValueError(f"Case identity drift: {case}")
                reviewed.add((citation['path'], index))
    all_cases = [dict(path=path, index=index, **case)
                 for path, file in sorted(files.items())
                 for index, case in enumerate(file['cases'])]
    return {
        'runtimeCaseCount': len(all_cases),
        'reviewedCaseCount': len(reviewed),
        'unreviewedCases': [case for case in all_cases if (case['path'], case['index']) not in reviewed],
        'skippedCases': [case for case in all_cases if case['skipped']],
        # Auxiliary smoke/bench entries require their own execution contract;
        # ordinary runtime case citations cannot close them.
        'unreviewedAuxiliaryFiles': sorted(auxiliary),
    }
