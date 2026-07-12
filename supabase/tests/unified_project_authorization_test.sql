-- ISSUE-029: database-level authorization and workspace-binding contracts.
--
-- These tests intentionally exercise the real RPCs, constraints, triggers,
-- and transaction ledger.  Application mocks cannot prove tenant integrity,
-- TOCTOU re-authorization, or credential revocation after a role downgrade.

BEGIN;

SELECT plan(53);

DO $$
DECLARE
    owner_id    uuid := '00000000-0000-0000-0000-000000029101';
    editor_id   uuid := '00000000-0000-0000-0000-000000029102';
    viewer_id   uuid := '00000000-0000-0000-0000-000000029103';
    baseline_id uuid := '00000000-0000-0000-0000-000000029104';
    outsider_id uuid := '00000000-0000-0000-0000-000000029105';
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
    )
    SELECT
        '00000000-0000-0000-0000-000000000000'::uuid,
        fixture.id,
        'authenticated',
        'authenticated',
        fixture.email,
        '',
        now(),
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    FROM (VALUES
        (owner_id,    'issue029-owner@example.test'),
        (editor_id,   'issue029-editor@example.test'),
        (viewer_id,   'issue029-viewer@example.test'),
        (baseline_id, 'issue029-baseline@example.test'),
        (outsider_id, 'issue029-outsider@example.test')
    ) AS fixture(id, email);

    INSERT INTO public.organizations (
        id, name, slug, type, plan, seat_limit, created_by
    ) VALUES (
        'issue029-org', 'ISSUE-029 Test Org', 'issue029-test-org',
        'team', 'enterprise', 20, owner_id
    );

    INSERT INTO public.org_members (id, org_id, user_id, role)
    VALUES
        ('issue029-om-owner', 'issue029-org', owner_id, 'owner'),
        ('issue029-om-editor', 'issue029-org', editor_id, 'member'),
        ('issue029-om-viewer', 'issue029-org', viewer_id, 'viewer'),
        ('issue029-om-baseline', 'issue029-org', baseline_id, 'member');

    PERFORM * FROM public.create_project_with_admin(
        'issue029-private', 'Private Project', NULL, 'issue029-org',
        owner_id, 'issue029-private-share-token'
    );
    UPDATE public.projects SET visibility = 'private'
    WHERE id = 'issue029-private';

    PERFORM * FROM public.add_project_member_authorized(
        'issue029-private', editor_id, 'editor', owner_id
    );
    PERFORM * FROM public.add_project_member_authorized(
        'issue029-private', viewer_id, 'viewer', owner_id
    );

    PERFORM * FROM public.create_project_with_admin(
        'issue029-org-visible', 'Org Visible Project', NULL, 'issue029-org',
        owner_id, 'issue029-org-share-token'
    );
    UPDATE public.projects SET visibility = 'org'
    WHERE id = 'issue029-org-visible';

    INSERT INTO public.repo_scopes (
        id, project_id, name, path, exclude, mode, is_root
    ) VALUES
        ('issue029-root', 'issue029-private', 'Root', '', '[]', 'rw', true),
        ('issue029-child', 'issue029-private', 'Docs', 'docs', '[]', 'rw', false),
        ('issue029-org-root', 'issue029-org-visible', 'Root', '', '[]', 'rw', true);

    INSERT INTO public.access_surfaces (
        id, org_id, project_id, scope_id, kind, name, status,
        principal_type, principal_id, config, created_by
    ) VALUES
        ('issue029-surface-root', 'issue029-org', 'issue029-private',
         'issue029-root', 'cli', 'Root CLI', 'active', 'scope',
         'issue029-root', '{}'::jsonb, owner_id),
        ('issue029-surface-child', 'issue029-org', 'issue029-private',
         'issue029-child', 'cli', 'Docs CLI', 'active', 'scope',
         'issue029-child', '{}'::jsonb, owner_id),
        ('issue029-org-surface-root', 'issue029-org', 'issue029-org-visible',
         'issue029-org-root', 'cli', 'Root CLI', 'active', 'scope',
         'issue029-org-root', '{}'::jsonb, owner_id);

    PERFORM * FROM public.create_project_workspace_binding(
        'issue029-binding-editor', 'issue029-org', 'issue029-private',
        'issue029-root', 'issue029-workspace-editor-0001', editor_id,
        'https://cloud.puppyone.test', 'full', 'rw',
        'issue029-surface-root', 'issue029-credential-editor-v1',
        'pwb', 'e001', 'issue029-hash-editor-v1', 'hmac_sha256_v1'
    );
    PERFORM * FROM public.create_project_workspace_binding(
        'issue029-binding-viewer', 'issue029-org', 'issue029-private',
        'issue029-root', 'issue029-workspace-viewer-0001', viewer_id,
        'https://cloud.puppyone.test', 'full', 'r',
        'issue029-surface-root', 'issue029-credential-viewer-v1',
        'pwb', 'v001', 'issue029-hash-viewer-v1', 'hmac_sha256_v1'
    );
    PERFORM * FROM public.create_project_workspace_binding(
        'issue029-binding-removal', 'issue029-org', 'issue029-private',
        'issue029-root', 'issue029-workspace-removal-0001', viewer_id,
        'https://cloud.puppyone.test', 'full', 'r',
        'issue029-surface-root', 'issue029-credential-removal-v1',
        'pwb', 'r001', 'issue029-hash-removal-v1', 'hmac_sha256_v1'
    );
    PERFORM * FROM public.create_project_workspace_binding(
        'issue029-binding-org-baseline', 'issue029-org', 'issue029-org-visible',
        'issue029-org-root', 'issue029-workspace-org-baseline-0001', baseline_id,
        'https://cloud.puppyone.test', 'full', 'r',
        'issue029-org-surface-root', 'issue029-credential-org-baseline-v1',
        'pwb', 'o001', 'issue029-hash-org-baseline-v1', 'hmac_sha256_v1'
    );

    INSERT INTO public.access_surface_credentials (
        id, org_id, project_id, access_surface_id, credential_type,
        key_prefix, key_last4, key_hash, hash_alg, status, created_by
    ) VALUES (
        'issue029-shared-v1', 'issue029-org', 'issue029-private',
        'issue029-surface-root', 'bearer_token', 'cli', 's001',
        'issue029-hash-shared-v1', 'hmac_sha256_v1', 'active', owner_id
    );

    INSERT INTO public.tools (
        id, created_by, project_id, json_path, type, name, category, org_id
    ) VALUES
        ('issue029-tool-private', owner_id, 'issue029-private', '',
         'search', 'Private Tool', 'builtin', 'issue029-org'),
        ('issue029-tool-sibling', owner_id, 'issue029-org-visible', '',
         'search', 'Sibling Tool', 'builtin', 'issue029-org'),
        ('issue029-tool-org', owner_id, NULL, '',
         'search', 'Organization Tool', 'builtin', 'issue029-org');
    INSERT INTO public.access_tools (
        id, access_point_id, tool_id, enabled, mcp_exposed
    ) VALUES (
        'issue029-access-tool-valid', 'issue029-surface-root',
        'issue029-tool-private', true, true
    );
END;
$$;

SELECT has_table('public', 'project_workspace_bindings',
    'workspace bindings are a first-class Project identity fact');
SELECT hasnt_table('public', 'repo_user_permissions',
    'legacy human permission table is retired');
SELECT is(
    (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY (ARRAY[
         'organizations', 'org_members', 'projects', 'project_members',
         'project_workspace_bindings', 'repo_scopes', 'access_surfaces',
         'access_surface_credentials', 'access_surface_policies'
       ])),
    9::bigint,
    'all nine authorization and runtime boundary tables exist'
);
SELECT is(
    (SELECT role FROM public.project_members
     WHERE project_id = 'issue029-private'
       AND user_id = '00000000-0000-0000-0000-000000029101'),
    'admin',
    'Project creation publishes creator Admin membership atomically'
);

SELECT throws_ok(
    $$SELECT * FROM public.create_project_with_admin(
        'issue029-rejected', 'Rejected', NULL, 'issue029-org',
        '00000000-0000-0000-0000-000000029105'::uuid, 'rejected-token'
    )$$,
    '42501',
    'project creator must be an organization member',
    'a non-tenant creator cannot publish a partial Project fact'
);
SELECT is(
    (SELECT count(*) FROM public.projects WHERE id = 'issue029-rejected'),
    0::bigint,
    'failed Project creation leaves no Project row'
);

SELECT is(
    (SELECT effective_role FROM public.resolve_project_role(
        'issue029-private', '00000000-0000-0000-0000-000000029101')),
    'admin', 'Organization owner inherits Project Admin'
);
SELECT is(
    (SELECT grant_source FROM public.resolve_project_role(
        'issue029-private', '00000000-0000-0000-0000-000000029101')),
    'org_owner', 'owner inheritance has an explicit grant source'
);
SELECT is(
    (SELECT effective_role FROM public.resolve_project_role(
        'issue029-private', '00000000-0000-0000-0000-000000029102')),
    'editor', 'explicit Project Editor is resolved'
);
SELECT is(
    (SELECT effective_role FROM public.resolve_project_role(
        'issue029-private', '00000000-0000-0000-0000-000000029103')),
    'viewer', 'explicit Project Viewer is resolved'
);
SELECT is(
    (SELECT effective_role FROM public.resolve_project_role(
        'issue029-org-visible', '00000000-0000-0000-0000-000000029104')),
    'viewer', 'org-visible baseline is Viewer, never Editor'
);
SELECT is(
    (SELECT grant_source FROM public.resolve_project_role(
        'issue029-org-visible', '00000000-0000-0000-0000-000000029104')),
    'org_visibility', 'org-visible Viewer records its baseline source'
);
SELECT is_empty(
    $$SELECT * FROM public.resolve_project_role(
        'issue029-private', '00000000-0000-0000-0000-000000029104')$$,
    'private Project denies an org member without explicit membership'
);
SELECT is_empty(
    $$SELECT * FROM public.resolve_project_role(
        'issue029-org-visible', '00000000-0000-0000-0000-000000029105')$$,
    'Organization membership remains the tenant boundary'
);

SELECT is(
    (SELECT binding_kind FROM public.project_workspace_bindings
     WHERE id = 'issue029-binding-editor'),
    'full', 'full binding is attached only to the canonical root scope'
);
SELECT is(
    (SELECT mode FROM public.project_workspace_bindings
     WHERE id = 'issue029-binding-viewer'),
    'r', 'Viewer binding is capped to read-only'
);
SELECT is(
    (SELECT count(*) FROM public.access_tools
     WHERE id = 'issue029-access-tool-valid'),
    1::bigint, 'same-Project Agent/tool binding is accepted'
);
SELECT throws_ok(
    $$INSERT INTO public.access_tools (
        id, access_point_id, tool_id, enabled, mcp_exposed
      ) VALUES (
        'issue029-access-tool-cross-project', 'issue029-surface-root',
        'issue029-tool-sibling', true, true
      )$$,
    'P0001',
    'access tool crosses Project or Organization boundary',
    'Agent child permissions cannot import a sibling Project tool'
);
SELECT lives_ok(
    $$INSERT INTO public.access_tools (
        id, access_point_id, tool_id, enabled, mcp_exposed
      ) VALUES (
        'issue029-access-tool-org', 'issue029-surface-root',
        'issue029-tool-org', true, true
      )$$,
    'same-tenant Organization tool may be attached to a Project surface'
);
SELECT throws_ok(
    $$SELECT * FROM public.create_project_workspace_binding(
        'issue029-invalid-full', 'issue029-org', 'issue029-private',
        'issue029-child', 'issue029-workspace-invalid-full',
        '00000000-0000-0000-0000-000000029102'::uuid,
        'https://cloud.puppyone.test', 'full', 'rw',
        'issue029-surface-child', 'issue029-invalid-full-credential',
        'pwb', 'if01', 'issue029-hash-invalid-full', 'hmac_sha256_v1'
    )$$,
    'P0001',
    'full workspace binding requires canonical root scope',
    'a non-root scope cannot impersonate a full Project binding'
);
SELECT throws_ok(
    $$SELECT * FROM public.create_project_workspace_binding(
        'issue029-invalid-scoped', 'issue029-org', 'issue029-private',
        'issue029-root', 'issue029-workspace-invalid-scoped',
        '00000000-0000-0000-0000-000000029102'::uuid,
        'https://cloud.puppyone.test', 'scoped', 'rw',
        'issue029-surface-root', 'issue029-invalid-scoped-credential',
        'pwb', 'is01', 'issue029-hash-invalid-scoped', 'hmac_sha256_v1'
    )$$,
    'P0001',
    'scoped workspace binding requires a non-root scope',
    'the root scope cannot be mislabeled as a scoped checkout'
);
SELECT throws_ok(
    $$SELECT * FROM public.create_project_workspace_binding(
        'issue029-invalid-viewer-rw', 'issue029-org', 'issue029-private',
        'issue029-root', 'issue029-workspace-invalid-viewer-rw',
        '00000000-0000-0000-0000-000000029103'::uuid,
        'https://cloud.puppyone.test', 'full', 'rw',
        'issue029-surface-root', 'issue029-invalid-viewer-rw-credential',
        'pwb', 'iv01', 'issue029-hash-invalid-viewer-rw', 'hmac_sha256_v1'
    )$$,
    '42501',
    'project binding capability denied',
    'Viewer cannot mint a read-write binding credential'
);
SELECT is(
    (SELECT key_hash FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v1'),
    'issue029-hash-editor-v1', 'binding credential stores only its hash'
);
SELECT hasnt_column('public', 'access_surface_credentials', 'access_key',
    'credential storage has no plaintext access-key column');

SELECT lives_ok(
    $$SELECT public.rotate_access_surface_bearer_token(
        'issue029-surface-root', 'issue029-org', 'issue029-private',
        'cli', 's002', 'issue029-hash-shared-v2', 'hmac_sha256_v1',
        '00000000-0000-0000-0000-000000029101'::uuid, NULL
    )$$,
    'shared surface credential rotates atomically'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v1'),
    'active', 'shared-key rotation does not revoke a binding credential'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-shared-v1'),
    'revoked', 'shared-key rotation revokes the previous shared key'
);
SELECT is(
    (SELECT count(*) FROM public.access_surface_credentials
     WHERE workspace_binding_id IS NULL
       AND access_surface_id = 'issue029-surface-root'
       AND status = 'active'),
    1::bigint, 'shared-key rotation leaves exactly one active shared key'
);

SELECT lives_ok(
    $$SELECT public.rotate_project_workspace_binding_credential(
        'issue029-binding-editor',
        '00000000-0000-0000-0000-000000029102'::uuid,
        'issue029-credential-editor-v2', 'pwb', 'e002',
        'issue029-hash-editor-v2', 'hmac_sha256_v1'
    )$$,
    'one workspace credential rotates independently'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v1'),
    'revoked', 'binding rotation revokes its previous credential'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-viewer-v1'),
    'active', 'binding rotation does not disconnect another workspace'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v2'),
    'active', 'binding rotation publishes one replacement credential'
);

SELECT lives_ok(
    $$UPDATE public.repo_scopes SET mode = 'r'
      WHERE id = 'issue029-root'$$,
    'scope mode can be tightened independently of Human role'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v2'),
    'revoked', 'scope rw to r downgrade revokes an rw binding credential'
);
SELECT throws_ok(
    $$UPDATE public.repo_scopes SET is_root = false
      WHERE id = 'issue029-root'$$,
    'P0001',
    'cannot change root identity of a bound scope',
    'an active binding prevents root/non-root identity drift'
);
SELECT lives_ok(
    $$UPDATE public.repo_scopes SET mode = 'rw'
      WHERE id = 'issue029-root'$$,
    'scope may be restored to rw without resurrecting old credentials'
);
SELECT lives_ok(
    $$SELECT public.rotate_project_workspace_binding_credential(
        'issue029-binding-editor',
        '00000000-0000-0000-0000-000000029102'::uuid,
        'issue029-credential-editor-v3', 'pwb', 'e003',
        'issue029-hash-editor-v3', 'hmac_sha256_v1'
    )$$,
    'restored scope requires an explicit fresh binding credential'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v3'),
    'active', 'fresh binding credential is active after explicit rotation'
);

SELECT lives_ok(
    $$SELECT public.revoke_project_workspace_binding(
        'issue029-binding-viewer',
        '00000000-0000-0000-0000-000000029103'::uuid
    )$$,
    'one workspace binding can be revoked independently'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-viewer-v1'),
    'revoked', 'binding revocation immediately revokes its credential'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v3'),
    'active', 'revoking another binding leaves this device connected'
);

SELECT lives_ok(
    $$SELECT * FROM public.update_project_member_role_authorized(
        'issue029-private',
        '00000000-0000-0000-0000-000000029102'::uuid,
        'viewer',
        '00000000-0000-0000-0000-000000029101'::uuid
    )$$,
    'Project role downgrade is committed through the authorized RPC'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-editor-v3'),
    'revoked', 'Editor to Viewer downgrade revokes the active rw credential'
);
SELECT throws_ok(
    $$SELECT * FROM public.update_project_member_role_authorized(
        'issue029-private',
        '00000000-0000-0000-0000-000000029103'::uuid,
        'editor',
        '00000000-0000-0000-0000-000000029102'::uuid
    )$$,
    '42501',
    'project member management denied',
    'a Viewer cannot promote another Project member'
);
SELECT is(
    (SELECT count(*) FROM public.audit_logs
     WHERE project_id = 'issue029-private'
       AND action = 'project_member.role.update'),
    1::bigint, 'member role mutation and audit fact commit together'
);
SELECT lives_ok(
    $$SELECT public.remove_project_member_authorized(
        'issue029-private',
        '00000000-0000-0000-0000-000000029103'::uuid,
        '00000000-0000-0000-0000-000000029101'::uuid
    )$$,
    'Project membership can be revoked through the authorized RPC'
);
SELECT is(
    (SELECT status FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-removal-v1'),
    'revoked', 'Project membership revoke invalidates the binding credential'
);
SELECT is_empty(
    $$SELECT * FROM public.resolve_project_role(
        'issue029-private', '00000000-0000-0000-0000-000000029103')$$,
    'revoked private-Project member has no residual Human grant'
);
SELECT lives_ok(
    $$DELETE FROM public.org_members
      WHERE org_id = 'issue029-org'
        AND user_id = '00000000-0000-0000-0000-000000029104'::uuid$$,
    'Organization membership revoke removes the tenant-bound device identity'
);
SELECT is(
    (SELECT count(*) FROM public.project_workspace_bindings
     WHERE id = 'issue029-binding-org-baseline'),
    0::bigint, 'tenant revocation cascades the org-visible workspace binding'
);
SELECT is(
    (SELECT count(*) FROM public.access_surface_credentials
     WHERE id = 'issue029-credential-org-baseline-v1'),
    0::bigint, 'tenant revocation cascades its binding-specific credential'
);
SELECT is(
    (public.unified_authorization_preflight()->>'invalid_project_members')::bigint
      + (public.unified_authorization_preflight()->>'creator_admin_unresolved')::bigint
      + (public.unified_authorization_preflight()->>'duplicate_or_missing_root_scopes')::bigint
      + (public.unified_authorization_preflight()->>'orphan_access_surfaces')::bigint
      + (public.unified_authorization_preflight()->>'orphan_access_credentials')::bigint
      + (public.unified_authorization_preflight()->>'invalid_access_tool_bindings')::bigint,
    0::bigint,
    'post-cutover preflight reports no authorization integrity defects'
);
SELECT is(
    public.unified_authorization_preflight()->>'legacy_table_present',
    'false', 'preflight proves the duplicate permission source is absent'
);

SELECT * FROM finish();
ROLLBACK;
