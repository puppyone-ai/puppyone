import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const layout = await readFile(
  fileURLToPath(new URL('../app/(main)/layout.tsx', import.meta.url)),
  'utf8',
);

assert.match(
  layout,
  /useState<string \| undefined>\(undefined\)/,
  'the environment label must be absent in both SSR and the first hydration render',
);
assert.match(
  layout,
  /useEffect\(\(\) => \{\s*setEnvironmentLabel\(getEnvironmentLabel\(\)\);\s*\}, \[\]\)/s,
  'the browser-only environment label must be populated after hydration',
);
assert.doesNotMatch(
  layout,
  /useMemo\(\(\) => getEnvironmentLabel\(\), \[\]\)/,
  'do not render a window-dependent value during SSR',
);

console.log('Hydration-safe environment label test passed.');
