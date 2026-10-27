-- sender profiles: who is sending films and what they offer
create table profiles (
  id          text primary key,
  name        text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- films are runs of the "film" agent; these make batch and listing queries cheap
create index runs_film_batch_idx on runs ((input->>'batch')) where agent = 'film';
