BEGIN;

INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000039099'::uuid,
    'authenticated', 'authenticated', 'issue039-corrupt@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.organizations (
    id, name, slug, type, plan, seat_limit, created_by
) VALUES (
    'issue039-corrupt-org', 'Issue 039 Corrupt', 'issue039-corrupt',
    'team', 'enterprise', 2,
    '00000000-0000-0000-0000-000000039099'::uuid
);

INSERT INTO public.org_members (id, org_id, user_id, role)
VALUES (
    'issue039-corrupt-membership', 'issue039-corrupt-org',
    '00000000-0000-0000-0000-000000039099'::uuid, 'owner'
);

SELECT * FROM public.create_project_with_admin(
    'issue039-missing-root-project',
    'Missing Root Project',
    NULL,
    'issue039-corrupt-org',
    '00000000-0000-0000-0000-000000039099'::uuid,
    'issue039-corrupt-share-token'
);

COMMIT;
