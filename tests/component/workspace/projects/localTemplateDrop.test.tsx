/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { ProjectEntryFlow, useProjectEntryFlow } from '../../../../src/features/app-shell/ProjectEntryFlow';
import { withTestLocalization } from '../../../support/react/localization';
import type { LocalTemplateDetail } from '../../../../src/types/electron';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const controller = useProjectEntryFlow();
  return <ProjectEntryFlow controller={controller} onOpenFolder={() => {}} onDefaultLocation={async () => ({ grantId: 'grant', path: '/projects' })} onCreateProject={vi.fn()} />;
}
function drop(file: File) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
  document.dispatchEvent(event);
  return event;
}

it('routes a dropped template to unpack confirmation instead of the Notion connection dialog', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const original = window.puppyoneDesktop;
  const openLocalTemplateFile = vi.fn(async () => ({ id: 'file', name: 'Dropped package', fileCount: 8, entry: 'README.md' }));
  window.puppyoneDesktop = { openLocalTemplateFile } as unknown as typeof window.puppyoneDesktop;
  try {
    await act(async () => root.render(withTestLocalization(<Harness />)));
    const file = new File(['template'], 'notion.puppyonetemplate');
    let event: Event;
    await act(async () => { event = drop(file); });
    expect(event!.defaultPrevented).toBe(true);
    expect(openLocalTemplateFile).toHaveBeenCalledWith(file);
    expect(host.textContent).toContain('Dropped package');
    expect(host.querySelector('button[type=submit]')?.textContent).toMatch(/unpack/i);
  } finally { await act(async () => root.unmount()); host.remove(); window.puppyoneDesktop = original; }
});

it('keeps the latest drop when older parsing completes later', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const original = window.puppyoneDesktop;
  let finishFirst!: (value: LocalTemplateDetail) => void;
  let finishSecond!: (value: LocalTemplateDetail) => void;
  const openLocalTemplateFile = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
  window.puppyoneDesktop = { openLocalTemplateFile } as unknown as typeof window.puppyoneDesktop;
  try {
    await act(async () => root.render(withTestLocalization(<Harness />)));
    await act(async () => { drop(new File(['a'], 'a.puppyonetemplate')); drop(new File(['b'], 'b.puppyonetemplate')); });
    await act(async () => finishSecond({ id: 'b', name: 'Latest package', fileCount: 1, entry: 'README.md' }));
    await act(async () => finishFirst({ id: 'a', name: 'Old package', fileCount: 1, entry: 'README.md' }));
    expect(host.textContent).toContain('Latest package');
    expect(host.textContent).not.toContain('Old package');
  } finally { await act(async () => root.unmount()); host.remove(); window.puppyoneDesktop = original; }
});
