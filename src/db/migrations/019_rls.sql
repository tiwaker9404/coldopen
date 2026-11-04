-- Lock every table against Supabase's public Data API (PostgREST).
-- coldopen never uses that API: the app and the render job connect directly as the table
-- owner, which row-level security does not restrict (no FORCE). With RLS on and no policies,
-- the `anon` and `authenticated` roles see nothing, even holding a project URL and anon key.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;

  -- on Supabase, also take away the grants those roles get by default (now and for new tables)
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
  end if;
end $$;
