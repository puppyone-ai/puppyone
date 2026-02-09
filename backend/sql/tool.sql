create table public.tool (
  id text not null,
  created_at timestamp with time zone not null default now(),
  user_id uuid null,
  json_path text null,
  type text null,
  name text null,
  alias text null,
  description text null,
  input_schema jsonb null,
  output_schema jsonb null,
  metadata jsonb null,
  node_id text null,
  category text not null default 'builtin'::text,
  script_type text null,
  script_content text null,
  constraint tool_pkey primary key (id),
  constraint tool_user_id_fkey foreign KEY (user_id) references auth.users (id),
  constraint tool_category_check check (
    (
      category = any (array['builtin'::text, 'custom'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_tool_user_node on public.tool using btree (user_id, node_id) TABLESPACE pg_default;

create index IF not exists idx_tool_node_id on public.tool using btree (node_id) TABLESPACE pg_default;

create index IF not exists idx_tool_category on public.tool using btree (category) TABLESPACE pg_default;

create index IF not exists idx_tool_type on public.tool using btree (type) TABLESPACE pg_default;