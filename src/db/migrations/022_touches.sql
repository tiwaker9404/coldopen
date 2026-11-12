-- warm leads: each touch the sender marked done after a reply (thank-you, proof of work, stay in touch, referral ask and bump), and "Stop reminders"
create table touches (
  id          bigserial primary key,
  owner       text not null,
  run_id      text not null references runs(id) on delete cascade,
  kind        text not null check (kind in ('thankYou', 'proofOfWork', 'stayInTouch', 'referralAsk', 'referralBump', 'stop')),
  -- the role a referral ask or bump was about (a Jobs cache id)
  role_id     text,
  -- "One thing they said" and "Something I'll build from what you said", saved with the thank-you
  said        text,
  build_note  text,
  -- the link to what they built, saved with the proof-of-work note
  build_link  text,
  done_at     timestamptz not null default now(),
  -- "Stop reminders": no more touches for this film
  stopped     boolean not null default false
);
create index touches_run on touches (owner, run_id);
-- one thank-you and one proof-of-work note per film, one ask and one bump per role
create unique index touches_once on touches (run_id, kind) where kind in ('thankYou', 'proofOfWork', 'stop');
create unique index touches_role on touches (run_id, kind, role_id) where kind in ('referralAsk', 'referralBump');

-- locked against Supabase's public Data API, like every other table (see 019_rls.sql)
alter table touches enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on touches from anon, authenticated;
  end if;
end $$;
