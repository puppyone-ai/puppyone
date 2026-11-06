/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { LocalTemplateImportCard } from '../../../../src/components/TemplateImportCard';
import { withTestLocalization } from '../../../support/react/localization';
import type { WorkspaceCreateProjectResult } from '../../../../src/types/electron';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('unpacks a file template without account access and opens its project in a new window', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  const onSubmit = vi.fn(async (): Promise<WorkspaceCreateProjectResult> => ({
    initialization: { operationId: 'operation', outcome: 'committed', path: '/projects/Notion migration', name: 'Notion migration', createdPaths: ['README.md'], initialOpenPath: 'README.md', template: null },
    opening: { status: 'opened', result: { status: 'opened-new-window', workspaceId: null, path: '/projects/Notion migration', workspace: null } },
  }));
  try {
    await act(async () => root.render(withTestLocalization(<React.StrictMode><LocalTemplateImportCard
      template={{ id: 'private-reference', name: 'Notion migration', fileCount: 8, entry: 'README.md' }}
      openInNewWindow onClose={onClose} onDefaultLocation={async () => ({ grantId: 'grant', path: '/projects' })} onSubmit={onSubmit}
    /></React.StrictMode>)));
    expect(host.textContent).toContain('Notion migration');
    expect(host.textContent).not.toMatch(/connect.*notion/i);
    const button = host.querySelector<HTMLButtonElement>('button[type=submit]');
    expect(button?.textContent).toMatch(/unpack/i);
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Notion migration', openInNewWindow: true, source: { kind: 'template', ref: { sourceId: 'local-package', id: 'private-reference' } } }));
    expect(onClose).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
