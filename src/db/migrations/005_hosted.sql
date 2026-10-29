-- the hosted app: every film and profile belongs to someone. A private install is one
-- owner, 'team'; on the public app it's a signed-in user ('u:<id>') or a visitor trying it
-- out ('a:<random id>'), whose work moves to their account when they sign in.
alter table runs add column owner text not null default 'team';
create index runs_owner_idx on runs (owner, id desc) where agent = 'film';

alter table profiles add column owner text not null default 'team';
alter table profiles drop constraint profiles_pkey;
alter table profiles add primary key (owner, id);

create table users (
  id          text primary key,          -- 'gh:<github user id>'
  login       text not null,
  name        text,
  avatar      text,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now()
);

-- daily counters for limits: films per person, per network, overall; résumé drafts
create table usage (
  key   text not null,
  day   date not null default current_date,
  n     integer not null default 0,
  primary key (key, day)
);
