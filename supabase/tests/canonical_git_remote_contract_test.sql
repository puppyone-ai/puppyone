-- Canonical Git locator/credential database contracts.
--
-- This test exercises the real migration functions and trigger boundaries. It
-- intentionally uses opaque fake hashes; raw credentials never belong in SQL.

BEGIN;

SELECT plan(18);

DO $$
DECLARE
    owner_id uuid := '00000000-0000-0000-0000-000000030101';
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000'::uuid,
        owner_id, 'authenticated', 'authenticated',
        'canonical-git-owner@example.test', '', now(), '{}'::jsonb,
        '{}'::jsonb, now(), now()
    );

    INSERT INTO public.organizations (
        id, name, slug, type, plan, seat_limit, created_by
    ) VALUES (
        'canonical-git-org', 'Canonical Git Test Org',
        'canonical-git-test-org', 'team', 'enterprise', 5, owner_id
    );
    INSERT INTO public.org_members (id, org_id, user_id, role)
    VALUES ('canonical-git-owner-member', 'canonical-git-org', owner_id, 'owner');

    PERFORM * FROM public.create_project_with_admin(
        'canonical-git-project', 'Canonical Git Project', NULL,
        'canonical-git-org', owner_id, 'canonical-git-share-token'
    );

    INSERT INTO public.repository_scopes (
        id, project_id, name, path, exclude, max_mode
    ) VALUES (
        'canonical-git-docs', 'canonical-git-project',
        'Docs', 'docs', '[]', 'rw'
    );

    INSERT INTO public.access_surfaces (
        id, org_id, project_id, scope_id, kind, name, status,
        principal_type, principal_id, config, created_by
    ) VALUES
        ('canonical-git-root-surface', 'canonical-git-org',
         'canonical-git-project', NULL, 'git_remote',
         'Root Git', 'active', 'project', 'canonical-git-project',
         '{"mode":"rw"}'::jsonb, owner_id),
        ('canonical-git-docs-surface', 'canonical-git-org',
         'canonical-git-project', 'canonical-git-docs', 'git_remote',
         'Docs Git', 'active', 'scope', 'canonical-git-docs',
         '{"mode":"rw"}'::jsonb, owner_id);

    PERFORM public.rotate_access_surface_git_http_token(
        'canonical-git-root-surface', 'canonical-git-org',
        'canonical-git-project', 'r', 'git', 'r001',
        'canonical-git-hash-r-v1', 'hmac_sha256_v1', owner_id, NULL
    );
    PERFORM public.rotate_access_surface_git_http_token(
        'canonical-git-root-surface', 'canonical-git-org',
        'canonical-git-project', 'rw', 'git', 'rw01',
        'canonical-git-hash-rw-v1', 'hmac_sha256_v1', owner_id, NULL
    );

    INSERT INTO public.access_surface_credentials (
        id, org_id, project_id, access_surface_id, credential_type,
        grant_mode, credential_lifecycle, key_prefix, key_last4, key_hash,
        hash_alg, status, created_by, expires_at
    ) VALUES (
        'canonical-git-session', 'canonical-git-org',
        'canonical-git-project', 'canonical-git-root-surface',
        'git_http_token', 'r', 'session', 'git', 's001',
        'canonical-git-hash-session', 'hmac_sha256_v1', 'active',
        owner_id, now() + interval '10 minutes'
    );

    PERFORM public.rotate_access_surface_git_http_token(
        'canonical-git-root-surface', 'canonical-git-org',
        'canonical-git-project', 'r', 'git', 'r002',
        'canonical-git-hash-r-v2', 'hmac_sha256_v1', owner_id, NULL
    );

    PERFORM * FROM public.create_project_workspace_git_binding(
        'canonical-git-binding', 'canonical-git-org',
        'canonical-git-project', NULL,
        'canonical-git-workspace-0001', owner_id,
        'https://cloud.puppyone.test', 'rw',
        'canonical-git-root-surface', 'canonical-git-binding-credential',
        'pwb', 'b001', 'canonical-git-hash-binding', 'hmac_sha256_v1'
    );
END;
$$;

SELECT has_column(
    'public', 'access_surface_credentials', 'grant_mode',
    'Git credential mode is persisted'
);
SELECT has_column(
    'public', 'access_surface_credentials', 'credential_lifecycle',
    'credential revocation domain is persisted'
);
SELECT ok(
    to_regprocedure(
        'public.rotate_access_surface_git_http_token(text,text,text,text,text,text,text,text,uuid,timestamptz)'
    ) IS NOT NULL,
    'shared Git rotation RPC exists'
);
SELECT ok(
    to_regprocedure('public.resolve_git_runtime_credential(text)') IS NOT NULL,
    'single Git RuntimeGrant resolver exists'
);
SELECT ok(
    NOT has_function_privilege(
        'anon', 'public.resolve_git_runtime_credential(text)', 'EXECUTE'
    ),
    'anonymous clients cannot resolve machine credentials'
);
SELECT ok(
    NOT has_function_privilege(
        'authenticated', 'public.resolve_git_runtime_credential(text)', 'EXECUTE'
    ),
    'human clients cannot resolve machine credentials directly'
);
SELECT throws_ok(
    $$INSERT INTO public.access_surface_credentials (
        id, org_id, project_id, access_surface_id, credential_type,
        grant_mode, credential_lifecycle, key_prefix, key_last4, key_hash,
        hash_alg, status
      ) VALUES (
        'canonical-git-invalid-session', 'canonical-git-org',
        'canonical-git-project', 'canonical-git-root-surface',
        'git_http_token', 'r', 'session', 'git', 'bad1',
        'canonical-git-hash-invalid-session', 'hmac_sha256_v1', 'active'
      )$$,
    'P0001',
    'session credential requires an expiry',
    'a session token cannot become an unbounded shared secret'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE key_hash = 'canonical-git-hash-r-v1'),
    'revoked', 'shared r rotation revokes the previous r slot'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE key_hash = 'canonical-git-hash-r-v2'),
    'active', 'replacement shared r credential is active'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE key_hash = 'canonical-git-hash-rw-v1'),
    'active', 'shared r rotation preserves the rw slot'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE key_hash = 'canonical-git-hash-session'),
    'active', 'shared rotation preserves a same-mode short-lived session'
);
SELECT is(
    (SELECT effective_mode FROM public.resolve_git_runtime_credential(
        'canonical-git-hash-r-v2')),
    'r', 'read-only shared credential resolves read-only'
);
SELECT is(
    (SELECT effective_mode FROM public.resolve_git_runtime_credential(
        'canonical-git-hash-rw-v1')),
    'rw', 'read-write shared credential resolves read-write'
);
SELECT is(
    (SELECT credential_lifecycle FROM public.access_surface_credentials
     WHERE id = 'canonical-git-binding-credential'),
    'binding', 'Workspace Binding issuance writes its lifecycle domain'
);
SELECT is(
    (SELECT workspace_binding_id FROM public.resolve_git_runtime_credential(
        'canonical-git-hash-binding')),
    'canonical-git-binding', 'binding credential resolves the exact binding'
);
SELECT ok(
    public.revoke_project_workspace_binding_git_credential(
        'canonical-git-binding',
        '00000000-0000-0000-0000-000000030101'::uuid
    ),
    'binding credential compensation RPC succeeds'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'canonical-git-binding-credential'),
    'revoked', 'binding compensation revokes only its Git credential'
);
SELECT is(
    (SELECT status FROM public.project_workspace_bindings
     WHERE id = 'canonical-git-binding'),
    'active', 'credential compensation preserves durable binding identity'
);

SELECT * FROM finish();
ROLLBACK;
