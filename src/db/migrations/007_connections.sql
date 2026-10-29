-- a person's own LinkedIn connections export, to show who they already know at a company.
-- Only name, profile link, company, position and date are kept; never emails.
create table connections (
  owner         text not null,
  name          text not null,
  url           text,
  company       text not null,
  company_key   text not null,
  position      text,
  connected_on  text,
  added_at      timestamptz not null default now()
);
create index connections_owner_key_idx on connections (owner, company_key);
