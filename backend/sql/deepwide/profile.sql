create table public.profiles (
  user_id uuid not null,
  email text not null,
  role text not null default 'user'::text,
  plan text not null default 'free'::text,
  stripe_customer_id text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  -- Onboarding tracking fields
  has_onboarded boolean not null default false,  -- Whether user completed first-time onboarding
  onboarded_at timestamp with time zone null,    -- When onboarding was completed
  demo_project_id bigint null,                   -- Reference to auto-created demo project
  constraint profiles_pkey primary key (user_id),
  constraint profiles_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint profiles_plan_check check (
    (
      plan = any (
        array[
          'free'::text,
          'plus'::text,
          'pro'::text,
          'team'::text
        ]
      )
    )
  ),
  constraint profiles_role_check check ((role = any (array['user'::text, 'admin'::text])))
) TABLESPACE pg_default;

-- Index for quick lookup of non-onboarded users
create index if not exists idx_profiles_has_onboarded 
on public.profiles (has_onboarded) 
where has_onboarded = false;