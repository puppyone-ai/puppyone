import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function makePackage(extra = {}, entries = {}) {
  const text = Buffer.from('# Notion migration\n');
  const manifest = { type: 'puppyone.template', version: 1, name: 'Notion 迁移', workflow: { kind: 'import-source', provider: 'notion' }, files: [{ path: 'README.md', size: text.length, sha256: createHash('sha256').update(text).digest('hex') }], ...extra };
  const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(manifest)); zip.file('content/README.md', text);
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function parser() {
  const module = await import('../../../../electron/main/project-import/local-template.mjs').catch(() => ({}));
  expect(module.parseLocalSourceTemplate, 'A local source template must open a built-in workflow').toBeTypeOf('function');
  return module.parseLocalSourceTemplate;
}

describe('local Notion source template', () => {
  it('validates the payload and selects the native connector without executing commands', async () => {
    const parse = await parser();
    const result = await parse(await makePackage());
    expect(result).toMatchObject({ name: 'Notion 迁移', provider: 'notion' });
    expect(result.files[0].path).toBe('README.md');
    expect(result.files[0].content.toString()).toContain('Notion migration');
  });
  it('rejects unknown workflows, executable entry declarations, extra files and content corruption', async () => {
    const parse = await parser();
    for (const bytes of [
      await makePackage({ workflow: { kind: 'command', command: ['sh', 'evil.sh'] } }),
      await makePackage({ command: ['node', 'evil.mjs'] }),
      await makePackage({ workflow: { kind: 'import-source', provider: 'arbitrary' } }),
      await makePackage({}, { 'content/unlisted.md': 'untrusted' }),
      await makePackage({}, { 'content/README.md': 'changed' }),
      await makePackage({}, { '../outside.md': 'traversal' }),
    ]) await expect(parse(bytes)).rejects.toThrow();
  });
  it('rejects oversized packages before decompression', async () => {
    const parse = await parser();
    await expect(parse(Buffer.alloc(32 * 1024 * 1024 + 1))).rejects.toThrow();
  });
  it('accepts generic templates with no workflow and validates the chosen entry', async () => {
    const parse = await parser();
    const value = await parse(await makePackage({ workflow: undefined, entry: 'README.md' }));
    expect(value).toMatchObject({ entry: 'README.md', workflow: null, provider: null });
    await expect(parse(await makePackage({ entry: 'missing.md' }))).rejects.toThrow();
  });
  it.skipIf(process.platform === 'win32')('rejects a named pipe without blocking the main process', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'template-fifo-'));
    try {
      const filename = path.join(temporary, 'pipe.puppyonetemplate');
      expect(spawnSync('mkfifo', [filename]).status).toBe(0);
      const moduleUrl = new URL('../../../../electron/main/project-import/local-template.mjs', import.meta.url).href;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {readLocalSourceTemplate} from ${JSON.stringify(moduleUrl)}; try { await readLocalSourceTemplate(${JSON.stringify(filename)}); process.exit(2); } catch { process.exit(0); }`], { timeout: 1500 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  });
});
