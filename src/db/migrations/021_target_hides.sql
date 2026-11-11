-- companies a person said "Not for me" to in Network this week, so they stay off the list
create table target_hides (
  owner       text not null,
  host        text not null,
  created_at  timestamptz not null default now(),
  primary key (owner, host)
);

-- locked against Supabase's public Data API, like every other table (see 019_rls.sql)
alter table target_hides enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on target_hides from anon, authenticated;
  end if;
end $$;
