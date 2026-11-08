import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalTemplateStore } from '../../../../electron/main/project-import/local-template-store.mjs';
import { createProjectInitializationService } from '../../../../electron/main/project-initialization-service.mjs';

it('unpacks owner-authorized bytes through normal project creation without executing scripts', async () => {
  const parentPath = await fs.mkdtemp(path.join(os.tmpdir(), 'template-store-'));
  const store = createLocalTemplateStore();
  const files = [{ path: 'README.md', content: Buffer.from('# Entry\n') }, { path: 'assets/raw.bin', content: Buffer.from([0, 255, 1]) }, { path: 'scripts/untrusted.sh', content: Buffer.from('touch SHOULD_NOT_RUN\n') }];
  try {
    const detail = store.register({ name: 'Template', entry: 'README.md', files }, 7);
    const publicSource = { kind: 'template', ref: { sourceId: 'local-package', id: detail.id } };
    expect(() => store.authorize(publicSource, 8)).toThrow(/same window/);
    const source = store.authorize(publicSource, 7);
    const service = createProjectInitializationService({ resolveTemplate: store.resolveTemplate, validateSource: store.validateSource });
    const receipt = await service.initialize({ parentPath, name: 'Unpacked', source, locale: 'en', operationId: randomUUID() });
    expect(receipt.initialOpenPath).toBe('README.md');
    for (const file of files) expect(await fs.readFile(path.join(receipt.path, file.path))).toEqual(file.content);
    await expect(fs.stat(path.join(receipt.path, 'SHOULD_NOT_RUN'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.initialize({ parentPath, name: 'Unpacked', source, locale: 'en', operationId: randomUUID() })).rejects.toThrow();
  } finally { await fs.rm(parentPath, { recursive: true, force: true }); }
});

it('expires package references and releases them when their owning window closes', () => {
  let time = 0;
  const store = createLocalTemplateStore({ now: () => time, lifetimeMs: 10 });
  const value = { name: 'Template', entry: 'README.md', files: [{ path: 'README.md', content: Buffer.from('entry') }] };
  const one = store.register(value, 7);
  const source = store.authorize({ kind: 'template', ref: { sourceId: 'local-package', id: one.id } }, 7);
  const plan = store.resolveTemplate(source);
  time = 11;
  expect(() => store.validateSource(plan)).toThrow(/expired/);
  const two = store.register(value, 8);
  store.releaseOwner(8);
  expect(() => store.authorize({ kind: 'template', ref: { sourceId: 'local-package', id: two.id } }, 8)).toThrow(/expired/);
});
