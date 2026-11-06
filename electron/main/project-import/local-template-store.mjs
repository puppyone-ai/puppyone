import { randomUUID } from 'node:crypto';
import { validateTemplatePlan, requireRelativeTemplatePath } from '../../local-api/templates/materialize.mjs';

const unavailable = () => new Error('Reopen this template file in the same window; its import permission has expired.');

/** Private file plans stay in Main. The renderer receives an owner-bound reference. */
export function createLocalTemplateStore({ now = Date.now, lifetimeMs = 30 * 60 * 1000 } = {}) {
  const records = new Map(); const plans = new WeakMap();
  function requireRecord(id, ownerId) {
    const record = records.get(id);
    if (!record || record.ownerId !== ownerId || record.expiresAt <= now()) { if (record?.expiresAt <= now()) records.delete(id); throw unavailable(); }
    return record;
  }
  return Object.freeze({
    register(value, ownerId) {
      if (!Number.isInteger(ownerId)) throw unavailable();
      const entry = requireRelativeTemplatePath(value.entry ?? 'README.md');
      const validated = validateTemplatePlan({ files: value.files, initialOpenPath: entry });
      const id = randomUUID();
      const plan = { files: validated.files, initialOpenPath: entry, template: { sourceId: 'local-package', id, version: 1, resolvedLocale: 'local' } };
      const record = { id, ownerId, plan, workflow: value.workflow ?? null, expiresAt: now() + lifetimeMs };
      records.set(id, record); plans.set(plan, record);
      for (const [key, old] of records) if (old.expiresAt <= now()) records.delete(key);
      while (records.size > 8) records.delete(records.keys().next().value);
      return { id, name: value.name, fileCount: validated.files.length, entry };
    },
    authorize(source, ownerId) {
      if (source?.kind !== 'template' || source.ref?.sourceId !== 'local-package') return source;
      requireRecord(source.ref.id, ownerId);
      return { kind: 'template', ref: { sourceId: 'local-package', id: source.ref.id, ownerId } };
    },
    resolveTemplate(source) {
      return requireRecord(source?.ref?.id, source?.ref?.ownerId).plan;
    },
    validateSource(plan) {
      if (plan.template?.sourceId !== 'local-package') return;
      const record = plans.get(plan);
      if (!record || requireRecord(record.id, record.ownerId).plan !== plan) throw unavailable();
    },
    workflowFor(source, ownerId) {
      if (source?.ref?.sourceId !== 'local-package') return null;
      return requireRecord(source.ref.id, ownerId).workflow;
    },
    releaseOwner(ownerId) {
      for (const [id, record] of records) if (record.ownerId === ownerId) records.delete(id);
    },
  });
}
