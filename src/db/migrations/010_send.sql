-- who a film went to (name, and email when known), so follow-ups open already addressed
alter table runs add column recipient jsonb;

-- people's keys for their own accounts on other services (Hunter), encrypted; never shown whole
create table owner_keys (
  owner       text not null,
  name        text not null,
  value       text not null,
  last4       text not null,
  updated_at  timestamptz not null default now(),
  primary key (owner, name)
);
