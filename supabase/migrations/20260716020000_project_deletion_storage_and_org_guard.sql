-- Close the two remaining destructive-control-plane gaps:
--
-- 1. Organization deletion must never cascade Projects around the durable
--    Project deletion journal.  Organization deletion is therefore allowed
--    only after every Project has been deleted through
--    delete_project_control_plane and its tombstone has been published.
-- 2. A Project deletion job must snapshot every physical object namespace
--    while the Project/Uploads rows still exist.  The cleanup worker accepts
--    only the exact, persisted allowlist assembled here.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Legacy ETL keys put the actor before the Project in the physical path.  An
-- Upload row can be deleted independently of its S3 artifacts, so querying
-- only currently-live Uploads during Project deletion would lose ownership
-- history.  This compact ledger remembers every principal that has ever owned
-- such a key for the life of the Project.
CREATE TABLE public.project_storage_principals (
    project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    principal text NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, principal),
    CONSTRAINT project_storage_principals_segment_check CHECK (
        project_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
        AND principal ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    )
);

ALTER TABLE public.project_storage_principals ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_storage_principals_service_role_read
    ON public.project_storage_principals FOR SELECT TO service_role
    USING (true);
REVOKE ALL ON public.project_storage_principals
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.project_storage_principals TO service_role;

INSERT INTO public.project_storage_principals (project_id, principal)
SELECT DISTINCT upload.project_id, COALESCE(upload.created_by::text, upload.project_id)
FROM public.uploads upload
ON CONFLICT (project_id, principal) DO NOTHING;

CREATE FUNCTION public._remember_upload_storage_principal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    INSERT INTO public.project_storage_principals (project_id, principal)
    VALUES (NEW.project_id, COALESCE(NEW.created_by::text, NEW.project_id))
    ON CONFLICT (project_id, principal) DO NOTHING;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._remember_upload_storage_principal()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER uploads_remember_storage_principal
AFTER INSERT OR UPDATE OF project_id, created_by ON public.uploads
FOR EACH ROW
EXECUTE FUNCTION public._remember_upload_storage_principal();

CREATE FUNCTION public._project_deletion_storage_principals(
    p_project_id text,
    p_requested_by uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT COALESCE(jsonb_agg(source.principal ORDER BY source.principal), '[]'::jsonb)
    FROM (
        SELECT DISTINCT candidate.principal
        FROM (
            SELECT p_requested_by::text AS principal
            UNION ALL
            SELECT project.created_by::text
            FROM public.projects project
            WHERE project.id = p_project_id
            UNION ALL
            SELECT stored.principal
            FROM public.project_storage_principals stored
            WHERE stored.project_id = p_project_id
            UNION ALL
            SELECT COALESCE(upload.created_by::text, p_project_id)
            FROM public.uploads upload
            WHERE upload.project_id = p_project_id
        ) candidate
        WHERE candidate.principal IS NOT NULL
          AND candidate.principal ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    ) source;
$$;

CREATE FUNCTION public._project_deletion_object_prefixes(
    p_project_id text,
    p_storage_principals jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    WITH principals AS (
        SELECT DISTINCT value AS principal
        FROM jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(p_storage_principals) = 'array'
                    THEN p_storage_principals
                ELSE '[]'::jsonb
            END
        )
    ), prefixes AS (
        SELECT fixed.ordinal, ''::text AS principal, fixed.prefix
        FROM (VALUES
            (1, 'version/' || p_project_id || '/'),
            (2, 'mut/' || p_project_id || '/'),
            (3, 'projects/' || p_project_id || '/'),
            (4, 'shadow-snapshots/' || p_project_id || '/')
        ) AS fixed(ordinal, prefix)
        UNION ALL
        SELECT 10 + namespace.ordinal, principal.principal,
               'users/' || principal.principal || '/' || namespace.name ||
               '/' || p_project_id || '/'
        FROM principals principal
        CROSS JOIN (VALUES
            (1, 'etl_artifacts'),
            (2, 'processed'),
            (3, 'raw')
        ) AS namespace(ordinal, name)
    )
    SELECT jsonb_agg(prefix ORDER BY ordinal, principal)
    FROM prefixes;
$$;

CREATE FUNCTION public._project_deletion_principals_valid(
    p_project_id text,
    p_requested_by uuid,
    p_storage_principals jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF p_project_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
       OR jsonb_typeof(p_storage_principals) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_storage_principals) = 0
    THEN
        RETURN false;
    END IF;
    RETURN
        jsonb_array_length(p_storage_principals) = (
            SELECT count(DISTINCT value)
            FROM jsonb_array_elements_text(p_storage_principals)
        )
        AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(p_storage_principals) AS principal(value)
            WHERE principal.value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
        )
        AND p_storage_principals ? p_requested_by::text;
END;
$$;

REVOKE ALL ON FUNCTION public._project_deletion_storage_principals(text, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._project_deletion_object_prefixes(text, jsonb)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._project_deletion_principals_valid(text, uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._project_deletion_storage_principals(text, uuid)
    TO service_role;
GRANT EXECUTE ON FUNCTION public._project_deletion_object_prefixes(text, jsonb)
    TO service_role;
GRANT EXECUTE ON FUNCTION public._project_deletion_principals_valid(text, uuid, jsonb)
    TO service_role;

ALTER TABLE public.project_deletion_jobs
    DROP CONSTRAINT project_deletion_jobs_prefixes_check;
ALTER TABLE public.project_deletion_jobs
    ADD COLUMN storage_principals jsonb;

-- The control-plane migration and this closure migration are deployed in one
-- release.  This backfill is nevertheless safe if a job was admitted between
-- them: surviving Project/Upload rows contribute their principals, while the
-- requester is always retained as a conservative exact prefix.
UPDATE public.project_deletion_jobs job
SET storage_principals = public._project_deletion_storage_principals(
        job.project_id, job.requested_by
    );
UPDATE public.project_deletion_jobs job
SET object_prefixes = public._project_deletion_object_prefixes(
        job.project_id, job.storage_principals
    );

ALTER TABLE public.project_deletion_jobs
    ALTER COLUMN storage_principals SET NOT NULL;
ALTER TABLE public.project_deletion_jobs
    ADD CONSTRAINT project_deletion_jobs_principals_check CHECK (
        public._project_deletion_principals_valid(
            project_id, requested_by, storage_principals
        )
    );
ALTER TABLE public.project_deletion_jobs
    ADD CONSTRAINT project_deletion_jobs_prefixes_check CHECK (
        object_prefixes = public._project_deletion_object_prefixes(
            project_id, storage_principals
        )
    );

CREATE FUNCTION public._prepare_project_deletion_job_storage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    -- This trigger runs before the enclosing destructive transaction removes
    -- uploads/local_shadow_snapshots through FK cascades.  It turns relational
    -- ownership facts into a durable, self-contained cleanup manifest.
    NEW.storage_principals := public._project_deletion_storage_principals(
        NEW.project_id, NEW.requested_by
    );
    NEW.object_prefixes := public._project_deletion_object_prefixes(
        NEW.project_id, NEW.storage_principals
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._prepare_project_deletion_job_storage()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_deletion_jobs_prepare_storage
BEFORE INSERT ON public.project_deletion_jobs
FOR EACH ROW
EXECUTE FUNCTION public._prepare_project_deletion_job_storage();

-- Empty-Organization deletion is intentionally a separate, narrow control
-- plane.  It cannot recursively delete Projects because Project deletion has
-- asynchronous object cleanup semantics and an Organization row does not.
CREATE FUNCTION public.delete_empty_organization_control_plane(
    p_org_id text,
    p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    actor_role text;
    actor_org_count bigint;
BEGIN
    IF p_org_id IS NULL OR btrim(p_org_id) = '' OR p_actor_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    -- Serialize delete decisions across all Organizations owned by this actor,
    -- so two concurrent requests cannot both observe "one other org" and
    -- delete the actor's final two Organizations.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('organization-delete:' || p_actor_user_id::text, 0)
    );

    -- Lock the Organization before authorization facts.  Project creation
    -- also locks this row, while FK inserts take a conflicting key-share lock;
    -- no new Project can appear between the emptiness proof and DELETE.
    PERFORM 1
    FROM public.organizations organization
    WHERE organization.id = p_org_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Lock all of the actor's memberships in a deterministic order before the
    -- final count.  The advisory lock covers concurrent delete RPCs and these
    -- row locks linearize membership removal/transfer.
    PERFORM 1
    FROM public.org_members member
    WHERE member.user_id = p_actor_user_id
    ORDER BY member.org_id
    FOR UPDATE;
    SELECT member.role INTO actor_role
    FROM public.org_members member
    WHERE member.org_id = p_org_id
      AND member.user_id = p_actor_user_id;
    IF actor_role IS DISTINCT FROM 'owner' THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT count(*) INTO actor_org_count
    FROM public.org_members member
    WHERE member.user_id = p_actor_user_id;
    IF actor_org_count <= 1 THEN
        RETURN jsonb_build_object('outcome', 'only_organization');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.projects project
        WHERE project.org_id = p_org_id
    ) THEN
        RETURN jsonb_build_object('outcome', 'organization_not_empty');
    END IF;

    DELETE FROM public.organizations organization
    WHERE organization.id = p_org_id;
    RETURN jsonb_build_object('outcome', 'deleted');
END;
$$;

-- Eliminate the old service-role escape hatch.  SECURITY DEFINER owns the
-- destructive statement; application code can only request the guarded RPC.
REVOKE DELETE ON TABLE public.organizations
    FROM PUBLIC, anon, authenticated, service_role;
-- Project rows have the same single destructive entry point.  Read/update
-- privileges remain for the Version Engine and ordinary Project metadata, but
-- application roles cannot remove a row without first publishing its cleanup
-- tombstone in delete_project_control_plane.
REVOKE DELETE ON TABLE public.projects
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_empty_organization_control_plane(text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_organization_control_plane(text, uuid)
    TO service_role;

COMMIT;
