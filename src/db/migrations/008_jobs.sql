-- suggested jobs: what each person is looking for, and the public job boards' listings,
-- cached for everyone (the same board serves every person who searches it)
create table job_searches (
  owner       text primary key,
  search      jsonb not null,
  -- boards they added themselves: [{ats, token, name}]
  boards      jsonb not null default '[]',
  -- suggestions they dismissed (job ids)
  hidden      text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

create table job_boards (
  board       text primary key,
  fetched_at  timestamptz not null default now(),
  ok          boolean not null,
  -- the last time it was read; a board that has never been read is the only kind that "failed"
  last_ok_at  timestamptz,
  error       text,
  jobs        jsonb not null default '[]'
);
