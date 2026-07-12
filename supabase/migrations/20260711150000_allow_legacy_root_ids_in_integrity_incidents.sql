-- The initial incident table was deployed with a 40-hex-only constraint.
-- Existing projects include legitimate 16-hex pre-Git roots, so preserve the
-- same strict hexadecimal validation while accepting both historical forms.

ALTER TABLE public.version_project_root_integrity_incidents
    DROP CONSTRAINT IF EXISTS version_project_root_integrity_incidents_root_hash_check;

ALTER TABLE public.version_project_root_integrity_incidents
    ADD CONSTRAINT version_project_root_integrity_incidents_root_hash_check
    CHECK (root_hash ~ '^[0-9a-f]{16}([0-9a-f]{24})?$');
