/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { OnboardingImportDialog } from '../../../../src/components/OnboardingImportDialog';
import { withTestLocalization } from '../../../support/react/localization';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('opens the native Notion picker from a template and passes the chosen subtree scope', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const onImportSource = vi.fn(async () => true);
  const onConnectSource = vi.fn(async () => ({ connectionId: 'main-owned-connection' }));
  try {
    await act(async () => root.render(withTestLocalization(<React.StrictMode><OnboardingImportDialog
      initialSource="notion" visibleSources={[{ id: 'notion', label: 'Notion', mode: 'remote', availability: 'experimental', operational: true, preview: true }]}
      onClose={() => {}} onDefaultLocation={async () => ({ grantId: 'grant', path: '/projects' })}
      onImportSource={onImportSource} onConnectSource={onConnectSource}
      onListResources={async () => ({ items: [{ id: 'page-id', name: 'Research', kind: 'document' }], nextCursor: null })}
      onCancelImport={async () => ({ cancelled: true })} onImportProgress={() => () => {}}
    /></React.StrictMode>)));
    const connect = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => /connect.*notion/i.test(button.textContent ?? ''));
    expect(connect, 'A template should open the Notion authorization step').toBeDefined();
    expect(connect?.disabled, 'Default destination resolution must finish in Strict Mode').toBe(false);
    await act(async () => connect?.click());
    expect(onConnectSource).toHaveBeenCalledWith('notion');
    const resource = document.querySelector<HTMLInputElement>('input[type=radio]');
    const subtree = document.querySelector<HTMLInputElement>('input[type=checkbox]');
    expect(subtree?.checked).toBe(true);
    await act(async () => { resource?.click(); subtree?.click(); });
    const submit = [...document.querySelectorAll<HTMLButtonElement>('footer button')].find(button => button.classList.contains('primary'));
    await act(async () => submit?.click());
    expect(onImportSource).toHaveBeenCalledWith(expect.objectContaining({ provider: 'notion', selection: { connectionId: 'main-owned-connection', resourceId: 'page-id', includeSubpages: false } }));
  } finally { await act(async () => root.unmount()); document.body.replaceChildren(); }
});
