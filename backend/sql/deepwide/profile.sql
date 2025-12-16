create table public.profiles (
  user_id uuid not null,
  email text not null,
  role text not null default 'user'::text,
  plan text not null default 'free'::text,
  stripe_customer_id text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
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