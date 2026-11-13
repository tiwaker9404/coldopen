-- autopilot: a job seeker's daily film settings, one row a day of what it picked and made
create table autopilot (
  owner       text primary key,
  "on"        boolean not null default false,
  per_day     int not null default 20 check (per_day between 1 and 25),
  -- iso weekdays, monday = 1
  days        int[] not null default '{1,2,3,4,5}',
  profile_id  text,
  format      text not null default 'square',
  webhook     text,
  updated_at  timestamptz default now()
);

create table autopilot_runs (
  id       bigserial primary key,
  owner    text not null,
  -- the pacific date the run was for
  day      date not null,
  picked   jsonb,
  made     jsonb,
  skipped  jsonb,
  at       timestamptz default now(),
  unique (owner, day)
);

-- null for films made by hand, 'autopilot' for the ones autopilot makes
alter table runs add column origin text;

-- locked against Supabase's public Data API, like every other table (see 019_rls.sql)
alter table autopilot enable row level security;
alter table autopilot_runs enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on autopilot, autopilot_runs from anon, authenticated;
    revoke all on sequence autopilot_runs_id_seq from anon, authenticated;
  end if;
end $$;
